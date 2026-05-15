const router = require('express').Router();
const { getCollection } = require('../../shared/mongodb');
const { authorize, verify } = require('../../shared/authMiddleware');
const { ObjectId } = require('mongodb');
const { consolidateCallbacks, cleanupAllCallbacks, normalizePhone } = require('../../shared/callbackUtils');
const { broadcast } = require('../../shared/notificationClient');

// Helper: get contacts based on role (Modified to use shared getCollection)
async function getAccessibleContacts(user, filters = {}, includeDeleted = false) {
  let query = { ...filters };
  if (!includeDeleted) query.isDeleted = { $ne: true };

  try {
    if (!user || !user.role) {
      query._id = new ObjectId();
      return [];
    }

    if (user.role === 'agent') {
      query.assignedTo = new ObjectId(user._id);
    } else if (user.role === 'tl') {
      const usersCollection = getCollection('users');
      const tlIdValue = /^[0-9a-fA-F]{24}$/.test(user._id.toString()) ? new ObjectId(user._id) : user._id;
      const agents = await usersCollection.find({
        role: 'agent',
        tlId: tlIdValue
      }, { projection: { _id: 1 } }).toArray();
      const agentIds = agents.map(a => a._id);
      query.assignedTo = { $in: agentIds };
    } else if (user.role === 'admin') {
      if (filters.tlId) {
        try {
          const usersCollection = getCollection('users');
          const tlQuery = /^[0-9a-fA-F]{24}$/.test(filters.tlId) ? new ObjectId(filters.tlId) : filters.tlId;
          const agents = await usersCollection.find({ role: 'agent', tlId: tlQuery }, { projection: { _id: 1 } }).toArray();
          const agentIds = agents.map(a => a._id);
          query.assignedTo = { $in: agentIds };
        } catch (err) {}
        delete query.tlId;
      }
    }
  } catch (err) {
    if (user.role !== 'admin') query._id = new ObjectId();
  }

  const contactsCollection = getCollection('contacts');
  return await contactsCollection.find(query).sort({ createdAt: -1 }).toArray();
}

// GET /contacts
router.get('/', verify, authorize(['admin', 'tl', 'agent']), async (req, res) => {
  try {
    const { disposition, agentId, tlId, search, batchId } = req.query;
    const filters = {};
    if (disposition === 'pending') filters.disposition = null;
    else if (disposition) filters.disposition = disposition;
    if (batchId) filters.batchId = batchId;

    if (req.user.role !== 'agent' && agentId) {
      if (/^[0-9a-fA-F]{24}$/.test(agentId)) filters.assignedTo = new ObjectId(agentId);
    }
    if (req.user.role === 'admin' && tlId) filters.tlId = tlId;
    if (search && typeof search === 'string' && search.trim()) filters.$text = { $search: search.trim() };

    let contacts = await getAccessibleContacts(req.user, filters);

    // Enrichment (Agent Names)
    try {
      const validAssignedToIds = contacts
        .map(c => c.assignedTo)
        .filter(id => id && /^[0-9a-fA-F]{24}$/.test(id.toString()))
        .map(id => new ObjectId(id.toString()));

      if (validAssignedToIds.length > 0) {
        const uniqueIds = [...new Set(validAssignedToIds.map(id => id.toString()))].map(s => new ObjectId(s));
        const usersCollection = getCollection('users');
        const agents = await usersCollection.find({ _id: { $in: uniqueIds } }, { projection: { _id: 1, name: 1 } }).toArray();
        const userMap = agents.reduce((acc, a) => { acc[a._id.toString()] = a.name; return acc; }, {});
        contacts = contacts.map(c => ({
          ...c,
          agentName: c.assignedTo ? (userMap[c.assignedTo.toString()] || 'Unknown Agent') : 'Unassigned'
        }));
      } else {
        contacts = contacts.map(c => ({ ...c, agentName: 'Unassigned' }));
      }
    } catch (err) {
      contacts = contacts.map(c => ({ ...c, agentName: 'Unknown' }));
    }
    return res.json(contacts);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /contacts/:id/dispose
router.post('/:id/dispose', verify, authorize(['agent']), async (req, res) => {
  try {
    const { disposition, remarks, appointmentDt, leadAmount, callBackDt, status, statusDetails, transactionId } = req.body;
    const contactsCollection = getCollection('contacts');
    const contact = await contactsCollection.findOne({
      _id: new ObjectId(req.params.id),
      assignedTo: new ObjectId(req.user._id),
      isDeleted: { $ne: true }
    });

    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const update = {
      disposition,
      remarks: remarks || '',
      lastModified: new Date(),
      disposedBy: new ObjectId(req.user._id),
      disposedAt: new Date(),
      agentName: req.user.name,
      agentId: new ObjectId(req.user._id)
    };

    if (disposition === 'Lead') {
      update.leadAmount = parseFloat(leadAmount) || 0;
      update.conversionDate = new Date();
      update.queueOrder = 999999;
      if (status) update.status = status;
      if (statusDetails) update.statusDetails = statusDetails;
      if (transactionId) update.transactionId = transactionId;
      if (callBackDt) { update.callBackDt = new Date(callBackDt); update.cbReminderSent = false; }
      if (appointmentDt) { update.appointmentDt = new Date(appointmentDt); update.reminderSent = false; update.lateNotified = false; }
    } else if (disposition === 'Appointment') {
      update.appointmentDt = appointmentDt ? new Date(appointmentDt) : null;
      update.reminderSent = false; update.lateNotified = false; update.queueOrder = 999999;
    } else if (disposition === 'CallBack') {
      update.callBackDt = callBackDt ? new Date(callBackDt) : null;
      update.cbReminderSent = false; update.queueOrder = 999999; update.status = 'Call Back';
    } else if (disposition === 'CallNotAnswered' || disposition === 'HungUp') {
      update.rechurnCount = (contact.rechurnCount || 0) + 1;
      update.queueOrder = update.rechurnCount >= 3 ? 999999 : 0;
      update.lastCallAttempt = new Date();
    } else {
      update.queueOrder = 999999;
    }

    await contactsCollection.updateOne({ _id: new ObjectId(req.params.id) }, { $set: update });

    // Cleanup: Remove any existing appointment/callback records
    const contactId = new ObjectId(req.params.id);
    await Promise.all([
      getCollection('appointments').deleteMany({ contactId }),
      getCollection('callbacks').deleteMany({ contactId })
    ]);

    const phoneNum = contact.fields?.Phone || contact.fields?.phone || contact.fields?.Mobile;
    if (disposition !== 'CallBack' && phoneNum) await cleanupAllCallbacks(phoneNum);

    // Save Lead record
    if (disposition === 'Lead') {
      const leadsCollection = getCollection('leads');
      await leadsCollection.insertOne({
        contactId, fields: contact.fields, batchId: contact.batchId,
        assignedTo: new ObjectId(req.user._id), agentName: req.user.name,
        leadAmount: parseFloat(leadAmount) || 0, status: status || 'Pending',
        statusDetails: statusDetails || '', transactionId: transactionId || '',
        remarks: remarks || '', callBackDt: callBackDt ? new Date(callBackDt) : null,
        appointmentDt: appointmentDt ? new Date(appointmentDt) : null,
        createdAt: new Date(), lastModified: new Date()
      });
    } else if (disposition === 'Appointment') {
      const appointmentsCollection = getCollection('appointments');
      await appointmentsCollection.insertOne({
        contactId, fields: contact.fields, batchId: contact.batchId,
        assignedTo: new ObjectId(req.user._id), agentName: req.user.name,
        appointmentDt: appointmentDt ? new Date(appointmentDt) : null,
        remarks: remarks || '', createdAt: new Date(), lastModified: new Date()
      });
    } else if (disposition === 'CallBack') {
      const callbacksCollection = getCollection('callbacks');
      await callbacksCollection.insertOne({
        contactId, fields: contact.fields, batchId: contact.batchId,
        assignedTo: new ObjectId(req.user._id), agentName: req.user.name,
        callBackDt: callBackDt ? new Date(callBackDt) : null,
        remarks: remarks || '', status: 'Call Back',
        createdAt: new Date(), lastModified: new Date()
      });
      if (phoneNum) await consolidateCallbacks(phoneNum);
    }

    broadcast('contact_disposed', { contactId: req.params.id, disposition, agentName: req.user.name });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /contacts/notifications - Fetch past-due callbacks and appointments
router.get('/notifications', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    const now = new Date();
    const query = { assignedTo: new ObjectId(req.user._id), isDeleted: { $ne: true } };
    const notifications = [];

    const pastDueCallbacks = await contactsCollection.find({ ...query, disposition: 'CallBack', callBackDt: { $lt: now } }).sort({ callBackDt: -1 }).limit(10).toArray();
    pastDueCallbacks.forEach(c => {
      notifications.push({
        type: 'callback',
        title: 'Callback Past Due',
        message: `Callback for ${c.fields?.Name || c.fields?.name || 'Unknown'} was due at ${new Date(c.callBackDt).toLocaleString()}`,
        path: `/workflow/${c._id}`
      });
    });

    const pastDueAppointments = await contactsCollection.find({ ...query, disposition: 'Appointment', appointmentDt: { $lt: now } }).sort({ appointmentDt: -1 }).limit(10).toArray();
    pastDueAppointments.forEach(c => {
      notifications.push({
        type: 'appointment',
        title: 'Appointment Past Due',
        message: `Appointment for ${c.fields?.Name || c.fields?.name || 'Unknown'} was due at ${new Date(c.appointmentDt).toLocaleString()}`,
        path: `/workflow/${c._id}`
      });
    });

    res.json(notifications);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// GET /contacts/stats - Fetch dashboard metrics
router.get('/stats', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    const query = { isDeleted: { $ne: true } };
    
    if (req.user.role === 'agent') {
      query.assignedTo = new ObjectId(req.user._id);
    } else if (req.user.role === 'tl') {
      const usersCollection = getCollection('users');
      const agents = await usersCollection.find({ tlId: new ObjectId(req.user._id) }).toArray();
      query.assignedTo = { $in: agents.map(a => a._id) };
    }

    const stats = await contactsCollection.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalContacts: { $sum: 1 },
          leads: { $sum: { $cond: [{ $eq: ['$disposition', 'Lead'] }, 1, 0] } },
          appointments: { $sum: { $cond: [{ $eq: ['$disposition', 'Appointment'] }, 1, 0] } },
          totalAmount: { $sum: { $ifNull: ['$leadAmount', 0] } }
        }
      }
    ]).toArray();

    const result = stats[0] || { totalContacts: 0, leads: 0, appointments: 0, totalAmount: 0 };
    res.json(result);
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /contacts/agent-queues - Fetch queue counts per agent
router.get('/agent-queues', verify, authorize(['admin', 'tl']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    const usersCollection = getCollection('users');
    
    // 1. Get relevant agents
    const userQuery = { role: 'agent', isDeleted: { $ne: true } };
    if (req.user.role === 'tl') {
      userQuery.tlId = new ObjectId(req.user._id);
    }
    const agents = await usersCollection.find(userQuery).toArray();
    const agentIds = agents.map(a => a._id);

    // 2. Map TL IDs for enrichment
    const tlIds = [...new Set(agents.map(a => a.tlId).filter(id => id))];
    const tls = await usersCollection.find({ _id: { $in: tlIds.map(id => new ObjectId(id)) } }, { projection: { _id: 1, name: 1 } }).toArray();
    const tlMap = tls.reduce((acc, t) => { acc[t._id.toString()] = t.name; return acc; }, {});

    // 3. Aggregate performance metrics
    const metrics = await contactsCollection.aggregate([
      { $match: { assignedTo: { $in: agentIds }, isDeleted: { $ne: true } } },
      { 
        $group: { 
          _id: '$assignedTo', 
          total: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ['$disposition', null] }, 1, 0] } },
          disposed: { $sum: { $cond: [{ $ne: ['$disposition', null] }, 1, 0] } },
          lead: { $sum: { $cond: [{ $eq: ['$disposition', 'Lead'] }, 1, 0] } },
          appointment: { $sum: { $cond: [{ $eq: ['$disposition', 'Appointment'] }, 1, 0] } },
          totalLeadAmount: { $sum: { $ifNull: ['$leadAmount', 0] } }
        } 
      }
    ]).toArray();

    const metricMap = metrics.reduce((acc, m) => {
      acc[m._id.toString()] = m;
      return acc;
    }, {});

    // 4. Combine data for frontend
    const result = agents.map(a => {
      const m = metricMap[a._id.toString()] || { total: 0, pending: 0, disposed: 0, lead: 0, appointment: 0, totalLeadAmount: 0 };
      return {
        agent: { _id: a._id, name: a.name },
        tlName: a.tlId ? (tlMap[a.tlId.toString()] || 'Unknown TL') : '—',
        active: a.active,
        ...m
      };
    });

    res.json(result);
  } catch (err) {
    console.error('Queue error:', err);
    res.status(500).json({ error: 'Failed to fetch queues' });
  }
});

// DELETE /contacts/batch/:batchId - Delete entire batch
router.delete('/batch/:batchId', verify, authorize(['admin']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    await contactsCollection.deleteMany({ batchId: req.params.batchId });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// POST /contacts/bulk-delete - Delete multiple contacts
router.post('/bulk-delete', verify, authorize(['admin']), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !ids.length) return res.status(400).json({ error: 'No IDs provided' });
    const contactsCollection = getCollection('contacts');
    await contactsCollection.deleteMany({ _id: { $in: ids.map(id => new ObjectId(id)) } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /contacts/:id - Delete individual contact
router.delete('/:id', verify, authorize(['admin']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    await contactsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// POST /contacts/bulk-delete-batches - Delete multiple batches
router.post('/bulk-delete-batches', verify, authorize(['admin']), async (req, res) => {
  try {
    const { batchIds } = req.body;
    if (!batchIds || !batchIds.length) return res.status(400).json({ error: 'No batch IDs provided' });
    
    const contactsCollection = getCollection('contacts');
    const batchesCollection = getCollection('batches');
    
    await Promise.all([
      contactsCollection.deleteMany({ batchId: { $in: batchIds } }),
      batchesCollection.deleteMany({ _id: { $in: batchIds } })
    ]);
    
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
