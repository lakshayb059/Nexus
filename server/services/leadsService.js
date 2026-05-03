const { getCollection } = require('../mongodb');
const { ObjectId } = require('mongodb');

class LeadsService {
  constructor(io) {
    this.io = io;
  }

  // Enhanced queue management
  async getNextContact(agentId) {
    try {
      const contactsCollection = getCollection('contacts');
      const now = new Date();
      
      // First check for callbacks that are due
      const dueCallbacks = await contactsCollection.find({
        assignedTo: new ObjectId(agentId),
        disposition: 'CallBack',
        callBackDt: { $lte: now },
        queueOrder: { $lt: 999999 }
      }).sort({ callBackDt: 1 }).limit(1).toArray();

      if (dueCallbacks.length > 0) {
        // Reset callback to queue for recall
        await contactsCollection.updateOne(
          { _id: dueCallbacks[0]._id },
          { $set: { queueOrder: 0, callBackDt: null } }
        );
        
        return {
          contact: dueCallbacks[0],
          type: 'callback_due',
          message: 'Callback due - recalling now'
        };
      }

      // Get next regular contact
      const nextContact = await contactsCollection.findOne({
        assignedTo: new ObjectId(agentId),
        queueOrder: { $lt: 999999 },
        $or: [
          { disposition: null },
          { disposition: 'CallNotAnswered' }
        ]
      }).sort({ queueOrder: 1, createdAt: 1 });

      // Check for upcoming appointments
      const upcomingAppointments = await contactsCollection.find({
        assignedTo: new ObjectId(agentId),
        disposition: 'Appointment',
        appointmentDt: { 
          $gte: now,
          $lte: new Date(now.getTime() + 30 * 60 * 1000) // 30 minutes from now
        }
      }).sort({ appointmentDt: 1 }).limit(3).toArray();

      return {
        contact: nextContact || null,
        upcomingAppointments,
        queueStats: await this.getQueueStats(agentId)
      };

    } catch (error) {
      console.error('Get next contact error:', error);
      throw error;
    }
  }

  // Process disposition with enhanced logic
  async processDisposition(contactId, agentId, dispositionData) {
    try {
      const contactsCollection = getCollection('contacts');
      const { disposition, remarks, appointmentDt, leadAmount, callBackDt } = dispositionData;
      
      const contact = await contactsCollection.findOne({ 
        _id: new ObjectId(contactId), 
        assignedTo: new ObjectId(agentId) 
      });
      
      if (!contact) {
        throw new Error('Contact not found or not assigned to you');
      }

      const update = {
        disposition,
        remarks: remarks || '',
        lastModified: new Date(),
        disposedBy: new ObjectId(agentId),
        disposedAt: new Date()
      };

      // Handle Lead disposition
      if (disposition === 'Lead') {
        if (leadAmount === undefined || leadAmount === '' || leadAmount <= 0) {
          throw new Error('Valid lead amount is required for Lead disposition');
        }
        update.leadAmount = parseFloat(leadAmount);
        update.conversionDate = new Date();
        update.queueOrder = 999999;
      } else {
        update.leadAmount = null;
      }

      // Handle Appointment disposition
      if (disposition === 'Appointment') {
        if (!appointmentDt) {
          throw new Error('Appointment date/time is required');
        }
        const appointmentDate = new Date(appointmentDt);
        if (appointmentDate <= new Date()) {
          throw new Error('Appointment must be in the future');
        }
        update.appointmentDt = appointmentDate;
        update.appointmentStatus = 'scheduled';
        update.queueOrder = 999999;
      } else {
        update.appointmentDt = null;
        update.appointmentStatus = null;
      }

      // Handle CallNotAnswered & HungUp
      if (disposition === 'CallNotAnswered' || disposition === 'HungUp') {
        const maxOrderContact = await contactsCollection.find({ 
          assignedTo: new ObjectId(agentId),
          queueOrder: { $lt: 999999 }
        }).sort({ queueOrder: -1 }).limit(1).toArray();
        
        const newOrder = maxOrderContact.length > 0 ? (maxOrderContact[0].queueOrder + 1) : 0;
        update.queueOrder = newOrder;
        update.callAttempts = (contact.callAttempts || 0) + 1;
        update.rechurnCount = (contact.rechurnCount || 0) + 1;
        update.lastCallAttempt = new Date();
      }

      // Handle CallBack
      if (disposition === 'CallBack') {
        if (!callBackDt) {
          throw new Error('Callback date/time is required');
        }
        const callBackDate = new Date(callBackDt);
        if (callBackDate <= new Date()) {
          throw new Error('Callback must be in the future');
        }
        update.callBackDt = callBackDate;
        update.queueOrder = 999999;
      } else {
        update.callBackDt = null;
      }

      // Handle Invalid and DoNotCall
      if (disposition === 'Invalid' || disposition === 'DoNotCall') {
        update.queueOrder = 999999;
        if (disposition === 'DoNotCall') {
          update.doNotCallFlag = true;
          update.doNotCallDate = new Date();
        }
      }

      await contactsCollection.updateOne(
        { _id: new ObjectId(contactId) },
        { $set: update }
      );

      // Emit real-time updates
      if (this.io) {
        this.io.emit('contact_disposed', {
          contactId,
          disposition,
          agentId,
          leadAmount: update.leadAmount,
          timestamp: new Date()
        });
        
        this.io.emit('dashboard_update', { type: 'disposition', data: update });
      }

      return { 
        success: true, 
        message: `${disposition} recorded successfully`,
        nextContactAvailable: disposition !== 'CallNotAnswered'
      };

    } catch (error) {
      console.error('Process disposition error:', error);
      throw error;
    }
  }

  // Get comprehensive statistics
  async getComprehensiveStats(user, filters = {}) {
    try {
      const contactsCollection = getCollection('contacts');
      let matchQuery = {};
      
      // Role-based filtering
      if (user.role === 'agent') {
        matchQuery.assignedTo = new ObjectId(user._id);
      } else if (user.role === 'tl') {
        const usersCollection = getCollection('users');
        const agents = await usersCollection.find({ tlId: new ObjectId(user._id) }).toArray();
        const agentIds = agents.map(a => a._id);
        matchQuery.assignedTo = { $in: agentIds };
        if (filters.agentId) matchQuery.assignedTo = new ObjectId(filters.agentId);
      } else if (user.role === 'admin') {
        if (filters.tlId) {
          const usersCollection = getCollection('users');
          const agents = await usersCollection.find({ tlId: new ObjectId(filters.tlId) }).toArray();
          const agentIds = agents.map(a => a._id);
          matchQuery.assignedTo = { $in: agentIds };
        } else if (filters.agentId) {
          matchQuery.assignedTo = new ObjectId(filters.agentId);
        }
      }

      // Date range filtering
      if (filters.dateRange) {
        const startDate = new Date(filters.dateRange.split(',')[0]);
        const endDate = new Date(filters.dateRange.split(',')[1]);
        matchQuery.disposedAt = { $gte: startDate, $lte: endDate };
      }

      const stats = await contactsCollection.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: null,
            totalContacts: { $sum: 1 },
            leads: { 
              $sum: { 
                $cond: [{ $eq: ['$disposition', 'Lead'] }, 1, 0] 
              } 
            },
            appointments: { 
              $sum: { 
                $cond: [{ $eq: ['$disposition', 'Appointment'] }, 1, 0] 
              } 
            },
            callNotAnswered: { 
              $sum: { 
                $cond: [{ $eq: ['$disposition', 'CallNotAnswered'] }, 1, 0] 
              } 
            },
            invalid: { 
              $sum: { 
                $cond: [{ $eq: ['$disposition', 'Invalid'] }, 1, 0] 
              } 
            },
            doNotCall: { 
              $sum: { 
                $cond: [{ $eq: ['$disposition', 'DoNotCall'] }, 1, 0] 
              } 
            },
            callBack: { 
              $sum: { 
                $cond: [{ $eq: ['$disposition', 'CallBack'] }, 1, 0] 
              } 
            },
            totalLeadAmount: { $sum: '$leadAmount' },
            avgLeadAmount: { $avg: '$leadAmount' }
          }
        }
      ]).toArray();

      // Get conversion rate
      const totalProcessed = await contactsCollection.countDocuments({
        ...matchQuery,
        disposition: { $in: ['Lead', 'Appointment', 'Invalid', 'DoNotCall'] }
      });

      const result = stats[0] || {
        totalContacts: 0,
        leads: 0,
        appointments: 0,
        callNotAnswered: 0,
        invalid: 0,
        doNotCall: 0,
        callBack: 0,
        totalLeadAmount: 0,
        avgLeadAmount: 0
      };

      result.conversionRate = totalProcessed > 0 ? (result.leads / totalProcessed * 100).toFixed(2) : 0;
      result.totalProcessed = totalProcessed;

      return result;

    } catch (error) {
      console.error('Get comprehensive stats error:', error);
      throw error;
    }
  }

  // Get detailed leads with pagination
  async getDetailedLeads(user, filters = {}) {
    try {
      const contactsCollection = getCollection('contacts');
      const { page = 1, limit = 20, disposition, agentId, search } = filters;
      
      let query = {};
      
      // Role-based filtering
      if (user.role === 'agent') {
        query.assignedTo = new ObjectId(user._id);
      } else if (user.role === 'tl') {
        const usersCollection = getCollection('users');
        const agents = await usersCollection.find({ tlId: new ObjectId(user._id) }).toArray();
        const agentIds = agents.map(a => a._id);
        query.assignedTo = { $in: agentIds };
        if (agentId) query.assignedTo = new ObjectId(agentId);
      }

      // Disposition filter
      if (disposition) {
        query.disposition = disposition;
      }

      // Search filter
      if (search) {
        query.$or = [
          { 'fields.Name': { $regex: search, $options: 'i' } },
          { 'fields.Phone': { $regex: search, $options: 'i' } },
          { 'fields.Mobile': { $regex: search, $options: 'i' } },
          { 'fields.Email': { $regex: search, $options: 'i' } }
        ];
      }

      const skip = (page - 1) * limit;
      
      const leads = await contactsCollection.find(query)
        .sort({ disposedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .toArray();

      // Enrich with agent names
      const usersCollection = getCollection('users');
      const enriched = await Promise.all(leads.map(async lead => {
        const agent = await usersCollection.findOne({ _id: lead.assignedTo }, { projection: { name: 1 } });
        return {
          ...lead,
          agentName: agent?.name || 'Unknown Agent'
        };
      }));

      const total = await contactsCollection.countDocuments(query);

      return {
        leads: enriched,
        pagination: {
          current: parseInt(page),
          total: Math.ceil(total / limit),
          count: total
        }
      };

    } catch (error) {
      console.error('Get detailed leads error:', error);
      throw error;
    }
  }

  // Helper function to get queue statistics
  async getQueueStats(agentId) {
    try {
      const contactsCollection = getCollection('contacts');
      
      const stats = await contactsCollection.aggregate([
        { $match: { assignedTo: new ObjectId(agentId) } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            pending: {
              $sum: {
                $cond: [
                  { $or: [{ $eq: ['$disposition', null] }, { $eq: ['$disposition', 'CallNotAnswered'] }] },
                  1, 0
                ]
              }
            },
            disposed: {
              $sum: {
                $cond: [
                  { $and: [{ $ne: ['$disposition', null] }, { $ne: ['$disposition', 'CallNotAnswered'] }] },
                  1, 0
                ]
              }
            }
          }
        }
      ]).toArray();

      return stats[0] || { total: 0, pending: 0, disposed: 0 };
    } catch (error) {
      console.error('Get queue stats error:', error);
      return { total: 0, pending: 0, disposed: 0 };
    }
  }

  // Get performance metrics
  async getPerformanceMetrics(user, period = 'today') {
    try {
      const contactsCollection = getCollection('contacts');
      let dateFilter = {};
      
      const now = new Date();
      if (period === 'today') {
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        dateFilter = { disposedAt: { $gte: startOfDay } };
      } else if (period === 'week') {
        const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        dateFilter = { disposedAt: { $gte: startOfWeek } };
      } else if (period === 'month') {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        dateFilter = { disposedAt: { $gte: startOfMonth } };
      }

      let matchQuery = { ...dateFilter };
      
      // Role-based filtering
      if (user.role === 'agent') {
        matchQuery.assignedTo = new ObjectId(user._id);
      } else if (user.role === 'tl') {
        const usersCollection = getCollection('users');
        const agents = await usersCollection.find({ tlId: new ObjectId(user._id) }).toArray();
        const agentIds = agents.map(a => a._id);
        matchQuery.assignedTo = { $in: agentIds };
      }

      const metrics = await contactsCollection.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: null,
            totalDispositions: { $sum: 1 },
            leads: { $sum: { $cond: [{ $eq: ['$disposition', 'Lead'] }, 1, 0] } },
            totalLeadAmount: { $sum: '$leadAmount' },
            avgCallAttempts: { $avg: '$callAttempts' }
          }
        }
      ]).toArray();

      return metrics[0] || {
        totalDispositions: 0,
        leads: 0,
        totalLeadAmount: 0,
        avgCallAttempts: 0
      };

    } catch (error) {
      console.error('Get performance metrics error:', error);
      throw error;
    }
  }
}

module.exports = LeadsService;
