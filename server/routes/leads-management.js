const router = require('express').Router();
const { getCollection } = require('../mongodb');
const { authorize, verify } = require('../middleware/auth');
const { ObjectId } = require('mongodb');
const { consolidateCallbacks, cleanupAllCallbacks } = require('../utils/callbackUtils');

// Enhanced workflow management with proper disposition handling
router.post('/workflow/dispose', verify, authorize(['agent']), async (req, res) => {
  try {
    const { contactId, disposition, remarks, appointmentDt, leadAmount, callBackDt } = req.body;
    const validDisps = ['Lead', 'Appointment', 'CallNotAnswered', 'Invalid', 'DoNotCall', 'CallBack', 'HungUp'];
    
    if (!validDisps.includes(disposition)) {
      return res.status(400).json({ error: 'Invalid disposition' });
    }

    const contactsCollection = getCollection('contacts');
    const contact = await contactsCollection.findOne({ 
      _id: new ObjectId(contactId), 
      assignedTo: new ObjectId(req.user._id) 
    });
    
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found or not assigned to you' });
    }

    const update = {
      disposition,
      remarks: remarks || '',
      lastModified: new Date(),
      disposedBy: new ObjectId(req.user._id),
      disposedAt: new Date()
    };

    // Handle Lead disposition - require lead amount
    if (disposition === 'Lead') {
      if (leadAmount === undefined || leadAmount === '' || leadAmount < 0) {
        return res.status(400).json({ error: 'Valid lead amount is required for Lead disposition' });
      }
      update.leadAmount = parseFloat(leadAmount);
      update.conversionDate = new Date();
      update.queueOrder = 999999;

      // Sync with Permanent Leads
      try {
        const leadsCollection = getCollection('leads');
        await leadsCollection.insertOne({
          contactId: new ObjectId(contactId),
          fields: contact.fields,
          batchId: contact.batchId,
          assignedTo: new ObjectId(req.user._id),
          agentName: req.user.name,
          leadAmount: parseFloat(leadAmount),
          status: 'Lead',
          createdAt: new Date(),
          lastModified: new Date()
        });
      } catch (leadErr) {
        console.error('Failed to sync to leads collection:', leadErr);
      }
    } else {
      update.leadAmount = null;
    }

    // Handle Appointment disposition - require appointment date/time
    if (disposition === 'Appointment') {
      if (!appointmentDt) {
        return res.status(400).json({ error: 'Appointment date and time is required' });
      }
      const appointmentDate = new Date(appointmentDt);
      if (appointmentDate <= new Date()) {
        return res.status(400).json({ error: 'Appointment must be in the future' });
      }
      update.appointmentDt = appointmentDate;
      update.appointmentStatus = 'scheduled';
      update.queueOrder = 999999; // Remove from active queue
    } else {
      update.appointmentDt = null;
      update.appointmentStatus = null;
    }

    // Handle CallNotAnswered & HungUp - move to end of queue
    if (disposition === 'CallNotAnswered' || disposition === 'HungUp') {
      const maxOrderContact = await contactsCollection.find({ 
        assignedTo: new ObjectId(req.user._id),
        queueOrder: { $lt: 999999 }
      }).sort({ queueOrder: -1 }).limit(1).toArray();
      
      const newOrder = maxOrderContact.length > 0 ? (maxOrderContact[0].queueOrder + 1) : 0;
      update.queueOrder = newOrder;
      update.callAttempts = (contact.callAttempts || 0) + 1;
      update.rechurnCount = (contact.rechurnCount || 0) + 1;
      update.lastCallAttempt = new Date();
    }

    // Handle CallBack - require callback date/time
    if (disposition === 'CallBack') {
      if (!callBackDt) {
        return res.status(400).json({ error: 'Callback date and time is required' });
      }
      const callBackDate = new Date(callBackDt);
      if (callBackDate <= new Date()) {
        return res.status(400).json({ error: 'Callback must be in the future' });
      }
      update.callBackDt = callBackDate;
      update.queueOrder = 999999; // Remove from active queue until callback time
    } else {
      update.callBackDt = null;
    }

    // Handle Invalid and DoNotCall - remove from queue
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

    // If CallBack, also insert into callbacks collection
    if (disposition === 'CallBack') {
      const callbacksCollection = getCollection('callbacks');
      await callbacksCollection.insertOne({
        contactId: new ObjectId(contactId),
        fields: contact.fields,
        batchId: contact.batchId,
        assignedTo: new ObjectId(req.user._id),
        agentName: req.user.name,
        callBackDt: new Date(callBackDt),
        remarks: remarks || '',
        createdAt: new Date(),
        lastModified: new Date()
      });
    }

    // Consolidate or cleanup callbacks
    const phoneNum = contact.fields?.Phone || contact.fields?.phone || contact.fields?.Mobile;
    if (disposition === 'CallBack') {
      await consolidateCallbacks(phoneNum);
    } else {
      await cleanupAllCallbacks(phoneNum);
    }

    // Emit real-time updates
    const io = req.app.get('io');
    if (io) {
      io.emit('lead_disposed', {
        contactId,
        disposition,
        agentId: req.user._id,
        agentName: req.user.name,
        leadAmount: update.leadAmount,
        timestamp: new Date()
      });
      
      // Update dashboard stats
      io.emit('dashboard_update');
      io.emit('contacts_updated');
    }

    res.json({ 
      success: true, 
      message: `${disposition} recorded successfully`,
      nextContactAvailable: disposition !== 'CallNotAnswered'
    });

  } catch (err) {
    console.error('Disposition error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get next contact in workflow with enhanced logic
router.get('/workflow/next', verify, authorize(['agent']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    const now = new Date();
    
    // First check for callbacks that are due
    const dueCallbacks = await contactsCollection.find({
      assignedTo: new ObjectId(req.user._id),
      disposition: 'CallBack',
      callBackDt: { $lte: now },
      queueOrder: 999999
    }).sort({ callBackDt: 1 }).limit(1).toArray();

    if (dueCallbacks.length > 0) {
      // Reset callback to queue for recall
      await contactsCollection.updateOne(
        { _id: dueCallbacks[0]._id },
        { $set: { queueOrder: 0, callBackDt: null } }
      );
      
      return res.json({
        contact: dueCallbacks[0],
        type: 'callback_due',
        message: 'Callback due - recalling now'
      });
    }

    // Check for appointments that need reminders (within 30 minutes)
    const upcomingAppointments = await contactsCollection.find({
      assignedTo: new ObjectId(req.user._id),
      disposition: 'Appointment',
      appointmentDt: { 
        $gte: now,
        $lte: new Date(now.getTime() + 30 * 60 * 1000) // 30 minutes from now
      }
    }).sort({ appointmentDt: 1 }).toArray();

    // Get next regular contact
    const nextContact = await contactsCollection.findOne({
      assignedTo: new ObjectId(req.user._id),
      queueOrder: { $lt: 999999 },
      $or: [
        { disposition: null },
        { disposition: 'CallNotAnswered' }
      ]
    }).sort({ queueOrder: 1, createdAt: 1 });

    res.json({
      contact: nextContact || null,
      upcomingAppointments,
      queueStats: await getQueueStats(req.user._id)
    });

  } catch (err) {
    console.error('Next contact error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get comprehensive lead statistics
router.get('/stats/comprehensive', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    const { dateRange, agentId, tlId } = req.query;
    
    let matchQuery = {};
    
    // Role-based filtering
    if (req.user.role === 'agent') {
      matchQuery.assignedTo = new ObjectId(req.user._id);
    } else if (req.user.role === 'tl') {
      const usersCollection = getCollection('users');
      const agents = await usersCollection.find({ tlId: new ObjectId(req.user._id) }).toArray();
      const agentIds = agents.map(a => a._id);
      matchQuery.assignedTo = { $in: agentIds };
      if (agentId) matchQuery.assignedTo = new ObjectId(agentId);
    } else if (req.user.role === 'admin') {
      if (tlId) {
        const usersCollection = getCollection('users');
        const agents = await usersCollection.find({ tlId: new ObjectId(tlId) }).toArray();
        const agentIds = agents.map(a => a._id);
        matchQuery.assignedTo = { $in: agentIds };
      } else if (agentId) {
        matchQuery.assignedTo = new ObjectId(agentId);
      }
    }

    // Date range filtering
    if (dateRange) {
      const startDate = new Date(dateRange.split(',')[0]);
      const endDate = new Date(dateRange.split(',')[1]);
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

    res.json(result);

  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get leads with detailed information
router.get('/detailed', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    const { page = 1, limit = 20, disposition, agentId, search } = req.query;
    
    let query = {};
    
    // Role-based filtering
    if (req.user.role === 'agent') {
      query.assignedTo = new ObjectId(req.user._id);
    } else if (req.user.role === 'tl') {
      const usersCollection = getCollection('users');
      const agents = await usersCollection.find({ tlId: new ObjectId(req.user._id) }).toArray();
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

    res.json({
      leads: enriched,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        count: total
      }
    });

  } catch (err) {
    console.error('Detailed leads error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Appointment reminder system
router.get('/appointments/reminders', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    const now = new Date();
    const reminderWindow = 30 * 60 * 1000; // 30 minutes
    
    let query = {
      disposition: 'Appointment',
      appointmentDt: { 
        $gte: now,
        $lte: new Date(now.getTime() + reminderWindow)
      }
    };

    // Role-based filtering
    if (req.user.role === 'agent') {
      query.assignedTo = new ObjectId(req.user._id);
    } else if (req.user.role === 'tl') {
      const usersCollection = getCollection('users');
      const agents = await usersCollection.find({ tlId: new ObjectId(req.user._id) }).toArray();
      const agentIds = agents.map(a => a._id);
      query.assignedTo = { $in: agentIds };
    }

    const appointments = await contactsCollection.find(query)
      .sort({ appointmentDt: 1 })
      .toArray();

    // Enrich with agent names
    const usersCollection = getCollection('users');
    const enriched = await Promise.all(appointments.map(async apt => {
      const agent = await usersCollection.findOne({ _id: apt.assignedTo }, { projection: { name: 1 } });
      return {
        ...apt,
        agentName: agent?.name || 'Unknown Agent',
        timeUntilAppointment: Math.floor((new Date(apt.appointmentDt) - now) / (1000 * 60)) // minutes
      };
    }));

    res.json(enriched);

  } catch (err) {
    console.error('Appointment reminders error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Helper function to get queue statistics
async function getQueueStats(agentId) {
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
}

module.exports = router;
