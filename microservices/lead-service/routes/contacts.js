const router = require('express').Router();
const { getCollection } = require('../../shared/mongodb');
const { authorize, verify } = require('../../shared/authMiddleware');
const { ObjectId } = require('mongodb');
const { consolidateCallbacks, cleanupAllCallbacks, normalizePhone } = require('../../shared/callbackUtils');
const { broadcast } = require('../../shared/notificationClient');

// Helper: get contacts based on role (Modified to use shared getCollection)
// Helper: build contacts query based on role (Modified to use shared getCollection)
async function getAccessibleContactsQuery(user, filters = {}, includeDeleted = false) {
  let query = { ...filters };
  if (!includeDeleted && user?.role !== 'admin') query.isDeleted = { $ne: true };

  try {
    if (!user || !user.role) {
      query._id = new ObjectId();
      return query;
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
  return query;
}

// Helper: get contacts based on role (Backward compatible)
async function getAccessibleContacts(user, filters = {}, includeDeleted = false) {
  const query = await getAccessibleContactsQuery(user, filters, includeDeleted);
  const contactsCollection = getCollection('contacts');
  return await contactsCollection.find(query).sort({ createdAt: -1 }).toArray();
}

// GET /contacts
router.get('/', verify, authorize(['admin', 'tl', 'agent']), async (req, res) => {
  try {
    const { disposition, agentId, tlId, search, batchId, page, limit } = req.query;
    const filters = {};
    if (disposition === 'pending') filters.disposition = null;
    else if (disposition) filters.disposition = disposition;
    if (batchId) filters.batchId = batchId;

    if (req.user.role !== 'agent' && agentId) {
      if (/^[0-9a-fA-F]{24}$/.test(agentId)) filters.assignedTo = new ObjectId(agentId);
    }
    if (req.user.role === 'admin' && tlId) filters.tlId = tlId;
    
    // Server-side regex search for phone, name, mobile, agent name, remarks
    if (search && typeof search === 'string' && search.trim()) {
      const cleanSearch = search.trim();
      const searchRegex = new RegExp(cleanSearch, 'i');
      filters.$or = [
        { 'fields.Name': searchRegex },
        { 'fields.name': searchRegex },
        { 'fields.Phone': searchRegex },
        { 'fields.phone': searchRegex },
        { 'fields.Mobile': searchRegex },
        { 'fields.mobile': searchRegex },
        { remarks: searchRegex }
      ];
    }

    const query = await getAccessibleContactsQuery(req.user, filters);
    const contactsCollection = getCollection('contacts');

    if (page) {
      // Pagination Mode
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 50;
      const skipNum = (pageNum - 1) * limitNum;

      const total = await contactsCollection.countDocuments(query);
      
      let contacts = await contactsCollection.find(query)
        .sort({ createdAt: -1 })
        .skip(skipNum)
        .limit(limitNum)
        .toArray();

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

      // Calculate total lead amount if disposition is Lead for lead stats panel
      let totalLeadValue = 0;
      if (disposition === 'Lead') {
        const leadStats = await contactsCollection.aggregate([
          { $match: query },
          { $group: { _id: null, totalAmount: { $sum: { $ifNull: ['$leadAmount', 0] } } } }
        ]).toArray();
        totalLeadValue = leadStats[0]?.totalAmount || 0;
      }

      return res.json({
        contacts,
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
        totalLeadValue
      });
    } else {
      // Backward Compatible Mode (Fetch all at once)
      let contacts = await contactsCollection.find(query).sort({ createdAt: -1 }).toArray();

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
    }
  } catch (err) {
    console.error('Fetch contacts error:', err);
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

    const DISP_LABELS = {
      'Lead': 'Lead',
      'Appointment': 'Appointment',
      'CallNotAnswered': 'Call Not Answered',
      'HungUp': 'Hung Up',
      'Invalid': 'Invalid / Wrong No.',
      'DoNotCall': 'Do Not Call',
      'CallBack': 'Call Back'
    };
    const dispositionLabel = DISP_LABELS[disposition] || disposition;
    const dateStr = new Date().toLocaleString('en-US', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: true
    });
    const agentName = req.user.name || req.user.username || 'Agent';
    const newRemarkEntry = `[${dispositionLabel} by ${agentName} on ${dateStr}]: ${remarks || ''}`;
    const updatedRemarks = contact.remarks 
      ? `${contact.remarks} | ${newRemarkEntry}` 
      : newRemarkEntry;

    const update = {
      disposition,
      remarks: updatedRemarks,
      lastModified: new Date(),
      disposedBy: new ObjectId(req.user._id),
      disposedAt: new Date(),
      agentName: agentName,
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
      update.lastCallAttempt = new Date();
      if (update.rechurnCount >= 3) {
        update.queueOrder = 999999;
      } else {
        const maxOrderContact = await contactsCollection.find({
          assignedTo: new ObjectId(req.user._id),
          queueOrder: { $lt: 999999 }
        }).sort({ queueOrder: -1 }).limit(1).toArray();
        update.queueOrder = maxOrderContact.length > 0 ? (maxOrderContact[0].queueOrder + 1) : 1;
      }
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
    const query = {};
    if (req.user.role !== 'admin') {
      query.isDeleted = { $ne: true };
    }
    
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
          total: { $sum: 1 },
          pending: { $sum: { $cond: [{ $or: [{ $eq: ['$disposition', null] }, { $eq: ['$disposition', ''] }] }, 1, 0] } },
          lead: { $sum: { $cond: [{ $eq: ['$disposition', 'Lead'] }, 1, 0] } },
          appointment: { $sum: { $cond: [{ $eq: ['$disposition', 'Appointment'] }, 1, 0] } },
          callBack: { $sum: { $cond: [{ $eq: ['$disposition', 'CallBack'] }, 1, 0] } },
          invalid: { $sum: { $cond: [{ $eq: ['$disposition', 'Invalid'] }, 1, 0] } },
          hungUp: { $sum: { $cond: [{ $in: ['$disposition', ['HungUp', 'CallNotAnswered']] }, 1, 0] } },
          doNotCall: { $sum: { $cond: [{ $eq: ['$disposition', 'DoNotCall'] }, 1, 0] } },
          totalLeadAmount: { $sum: { $ifNull: ['$leadAmount', 0] } }
        }
      }
    ]).toArray();

    const result = stats[0] || {
      total: 0,
      pending: 0,
      lead: 0,
      appointment: 0,
      callBack: 0,
      invalid: 0,
      hungUp: 0,
      doNotCall: 0,
      totalLeadAmount: 0
    };
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
    const matchQuery = { assignedTo: { $in: agentIds } };
    if (req.user.role !== 'admin') {
      matchQuery.isDeleted = { $ne: true };
    }

    const metrics = await contactsCollection.aggregate([
      { $match: matchQuery },
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

// GET /contacts/queue - Fetch next contact in queue or specific contact
router.get('/queue', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    
    // Safely cast agentId to ObjectId if it's a valid 24-character hex string
    const agentIdStr = req.user._id.toString();
    const agentIdObj = /^[0-9a-fA-F]{24}$/.test(agentIdStr) ? new ObjectId(agentIdStr) : req.user._id;
    const now = new Date();
    
    // 1. Calculate queue statistics safely using countDocuments
    const total = await contactsCollection.countDocuments({
      assignedTo: agentIdObj,
      isDeleted: { $ne: true }
    });

    const pending = await contactsCollection.countDocuments({
      assignedTo: agentIdObj,
      isDeleted: { $ne: true },
      $or: [
        { disposition: null },
        { disposition: '' },
        {
          $and: [
            { disposition: { $in: ['CallNotAnswered', 'HungUp'] } },
            { queueOrder: { $lt: 999999 } }
          ]
        }
      ]
    });

    const disposed = total - pending;
    
    let contact = null;
    let type = 'regular';
    let rechurnNum = 1;
    
    // 2. Fetch specific contact if contactId is provided
    if (req.query.contactId) {
      const cidStr = req.query.contactId.toString();
      if (/^[0-9a-fA-F]{24}$/.test(cidStr)) {
        contact = await contactsCollection.findOne({
          _id: new ObjectId(cidStr),
          assignedTo: agentIdObj,
          isDeleted: { $ne: true }
        });
      }
    }
    
    // 3. Otherwise, fetch next based on callback or queue priority
    if (!contact) {
      // A. Check for due callbacks
      const dueCallbacks = await contactsCollection.find({
        assignedTo: agentIdObj,
        disposition: 'CallBack',
        callBackDt: { $lte: now },
        queueOrder: { $lt: 999999 },
        isDeleted: { $ne: true }
      }).sort({ callBackDt: 1 }).limit(1).toArray();
      
      if (dueCallbacks.length > 0) {
        contact = dueCallbacks[0];
        // Move due callback to active queue by clearing callback date and resetting queueOrder
        await contactsCollection.updateOne(
          { _id: contact._id },
          { $set: { queueOrder: 0, callBackDt: null } }
        );
        type = 'callback_due';
      } else {
        // B. Fetch next standard pending contact
        const standardPending = await contactsCollection.find({
          assignedTo: agentIdObj,
          isDeleted: { $ne: true },
          $or: [
            // Untouched pending contacts (high priority, no actions taken)
            { disposition: null },
            { disposition: '' },
            // Rechurn contacts (with attempts under limit)
            {
              $and: [
                { disposition: { $in: ['CallNotAnswered', 'HungUp'] } },
                { queueOrder: { $lt: 999999 } }
              ]
            }
          ]
        }).sort({ queueOrder: 1, createdAt: 1 }).limit(1).toArray();
        
        contact = standardPending[0] || null;
      }
    }
    
    // 4. Enrich/identify type of contact
    if (contact) {
      if (type !== 'callback_due') {
        if (contact.disposition === 'CallNotAnswered' || contact.disposition === 'HungUp') {
          type = 'rechurn';
          rechurnNum = (contact.rechurnCount || 0) + 1;
        }
      }
    }
    
    res.json({
      contact: contact || null,
      total,
      pending,
      disposed,
      remaining: pending,
      type,
      rechurnNum
    });
  } catch (err) {
    console.error('Queue route error:', err);
    res.status(500).json({ error: 'Server error' });
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

// GET /contacts/:id - Fetch single contact details
router.get('/:id', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    const contact = await contactsCollection.findOne({ _id: new ObjectId(req.params.id), isDeleted: { $ne: true } });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    res.json(contact);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// GET /contacts/:id/check-callback - Check if a callback exists for a contact
router.get('/:id/check-callback', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const contactIdStr = req.params.id;
    if (!/^[0-9a-fA-F]{24}$/.test(contactIdStr)) {
      return res.status(400).json({ error: 'Invalid contact ID format' });
    }
    const contactId = new ObjectId(contactIdStr);
    
    // Check in callbacks collection first
    const callbacksCollection = getCollection('callbacks');
    const existingCallback = await callbacksCollection.findOne({ contactId });
    if (existingCallback) {
      return res.json({
        exists: true,
        callback: existingCallback
      });
    }

    // Check in contacts collection
    const contactsCollection = getCollection('contacts');
    const contact = await contactsCollection.findOne({ _id: contactId });
    if (contact && contact.disposition === 'CallBack' && contact.callBackDt) {
      return res.json({
        exists: true,
        callback: {
          _id: contact._id,
          contactId: contact._id,
          callBackDt: contact.callBackDt,
          remarks: contact.remarks || ''
        }
      });
    }

    res.json({ exists: false });
  } catch (err) {
    console.error('Check callback error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /contacts/:id/status - Update contact status and associated details
router.put('/:id/status', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    const contact = await contactsCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    if (contact.status === 'Converted' && req.body.status && req.body.status !== 'Converted') {
      return res.status(400).json({ error: 'Cannot change status of a successfully converted lead' });
    }

    const { status, statusDetails, transactionId, callBackDt, appointmentDt, remarks, leadAmount } = req.body;

    const update = {
      status: status || contact.status,
      lastModified: new Date()
    };

    if (statusDetails !== undefined) update.statusDetails = statusDetails;
    if (transactionId !== undefined) update.transactionId = transactionId;
    if (remarks !== undefined) {
      const dateStr = new Date().toLocaleString('en-US', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: true
      });
      const updaterName = req.user.name || req.user.username || 'Staff';
      const actionLabel = status ? `Status: ${status}` : 'Status Update';
      const newRemarkEntry = `[${actionLabel} by ${updaterName} on ${dateStr}]: ${remarks}`;
      update.remarks = contact.remarks ? `${contact.remarks} | ${newRemarkEntry}` : newRemarkEntry;
    }

    // Handle transitions if status is Call Back, Appointment, or Lead
    if (status === 'Call Back') {
      update.disposition = 'CallBack';
      update.callBackDt = callBackDt ? new Date(callBackDt) : contact.callBackDt || new Date();
      update.cbReminderSent = false;
      
      const leadsCollection = getCollection('leads');
      await leadsCollection.deleteMany({ contactId: contact._id });

      const callbacksCollection = getCollection('callbacks');
      await callbacksCollection.deleteMany({ contactId: contact._id });
      await callbacksCollection.insertOne({
        contactId: contact._id,
        fields: contact.fields,
        batchId: contact.batchId,
        assignedTo: contact.assignedTo,
        agentName: contact.agentName || req.user.name,
        callBackDt: update.callBackDt,
        remarks: remarks || 'Status updated to Call Back',
        status: 'Call Back',
        source: 'lead',
        createdAt: new Date(),
        lastModified: new Date()
      });

      const phoneNum = contact.fields?.Phone || contact.fields?.phone || contact.fields?.Mobile;
      if (phoneNum) await consolidateCallbacks(phoneNum);

    } else if (status === 'Appointment') {
      update.disposition = 'Appointment';
      update.appointmentDt = appointmentDt ? new Date(appointmentDt) : contact.appointmentDt || new Date();
      update.reminderSent = false;
      update.lateNotified = false;

      const appointmentsCollection = getCollection('appointments');
      await appointmentsCollection.deleteMany({ contactId: contact._id });
      await appointmentsCollection.insertOne({
        contactId: contact._id,
        fields: contact.fields,
        batchId: contact.batchId,
        assignedTo: contact.assignedTo,
        agentName: contact.agentName || req.user.name,
        appointmentDt: update.appointmentDt,
        remarks: remarks || 'Status updated to Appointment',
        createdAt: new Date(),
        lastModified: new Date()
      });

    } else if (status === 'Lead') {
      update.disposition = 'Lead';
      update.leadAmount = parseFloat(leadAmount) || contact.leadAmount || 0;
      update.conversionDate = new Date();

      const leadsCollection = getCollection('leads');
      await leadsCollection.deleteMany({ contactId: contact._id });
      await leadsCollection.insertOne({
        contactId: contact._id,
        fields: contact.fields,
        batchId: contact.batchId,
        assignedTo: contact.assignedTo,
        agentName: contact.agentName || req.user.name,
        leadAmount: update.leadAmount,
        status: 'Lead',
        createdAt: new Date(),
        lastModified: new Date()
      });
    }

    await contactsCollection.updateOne({ _id: contact._id }, { $set: update });

    broadcast('dashboard_update');
    broadcast('contacts_updated');

    res.json({ success: true, contact: { ...contact, ...update } });
  } catch (err) {
    console.error('Update contact status error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /contacts/:id/requeue - Requeue a contact (resets disposition and schedules back to active workflow)
router.post('/:id/requeue', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    const contactId = new ObjectId(req.params.id);
    const contact = await contactsCollection.findOne({ _id: contactId });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const dateStr = new Date().toLocaleString('en-US', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: true
    });
    const adminName = req.user.name || req.user.username || 'Staff';
    const requeueEntry = `[Requeued by ${adminName} on ${dateStr}]`;
    const updatedRemarks = contact.remarks ? `${contact.remarks} | ${requeueEntry}` : requeueEntry;

    // Set queueOrder to 0 (top of queue) and clear disposition/appointment/callback details
    const update = {
      disposition: null,
      callBackDt: null,
      appointmentDt: null,
      queueOrder: 0,
      remarks: updatedRemarks,
      lastModified: new Date()
    };

    await contactsCollection.updateOne({ _id: contactId }, { $set: update });

    // Delete associated callback/appointment records
    await Promise.all([
      getCollection('callbacks').deleteMany({ contactId }),
      getCollection('appointments').deleteMany({ contactId })
    ]);

    const phoneNum = contact.fields?.Phone || contact.fields?.phone || contact.fields?.Mobile;
    if (phoneNum) await cleanupAllCallbacks(phoneNum);

    // Notify agents via websockets
    broadcast('requeue_notification', {
      contactId: req.params.id,
      contactName: contact.fields?.Name || contact.fields?.name || 'Unknown',
      agentId: contact.assignedTo ? contact.assignedTo.toString() : null,
      adminName: req.user.name
    });
    
    broadcast('dashboard_update');
    broadcast('contacts_updated');

    res.json({ success: true });
  } catch (err) {
    console.error('Requeue contact error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /contacts/bulk-requeue - Bulk requeue contacts
router.post('/bulk-requeue', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !ids.length) return res.status(400).json({ error: 'No IDs provided' });

    const contactsCollection = getCollection('contacts');
    const objectIds = ids.map(id => new ObjectId(id));

    // Update contacts: reset disposition, queueOrder = 0, clear dates
    await contactsCollection.updateMany(
      { _id: { $in: objectIds } },
      {
        $set: {
          disposition: null,
          callBackDt: null,
          appointmentDt: null,
          queueOrder: 0,
          lastModified: new Date()
        }
      }
    );

    // Delete associated callback/appointment records in bulk
    await Promise.all([
      getCollection('callbacks').deleteMany({ contactId: { $in: objectIds } }),
      getCollection('appointments').deleteMany({ contactId: { $in: objectIds } })
    ]);

    broadcast('dashboard_update');
    broadcast('contacts_updated');

    res.json({ success: true });
  } catch (err) {
    console.error('Bulk requeue error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /contacts/batch/:batchId/handover - Handover batch assignment to another agent
router.put('/batch/:batchId/handover', verify, authorize(['admin', 'tl']), async (req, res) => {
  try {
    const { agentId } = req.body;
    if (!agentId) return res.status(400).json({ error: 'Agent ID is required' });

    const batchId = req.params.batchId;
    const targetAgentId = new ObjectId(agentId);

    const usersCollection = getCollection('users');
    const targetAgent = await usersCollection.findOne({ _id: targetAgentId, role: 'agent' });
    if (!targetAgent) return res.status(404).json({ error: 'Target agent not found' });
    if (!targetAgent.active) return res.status(400).json({ error: `Cannot assign to inactive agent: ${targetAgent.name}` });

    const contactsCollection = getCollection('contacts');
    const batchesCollection = getCollection('batches');

    // 1. Update all contacts in that batch
    await contactsCollection.updateMany(
      { batchId },
      { $set: { assignedTo: targetAgentId, lastModified: new Date() } }
    );

    // 2. Update the batch document itself if it exists
    await batchesCollection.updateOne(
      { _id: batchId },
      { $set: { assignedTo: targetAgentId, lastModified: new Date() } }
    );

    // 3. Update any callbacks/appointments that belong to these contacts
    const contactsInBatch = await contactsCollection.find({ batchId }).toArray();
    const contactIds = contactsInBatch.map(c => c._id);
    
    await Promise.all([
      getCollection('callbacks').updateMany({ contactId: { $in: contactIds } }, { $set: { assignedTo: targetAgentId, agentName: targetAgent.name, lastModified: new Date() } }),
      getCollection('appointments').updateMany({ contactId: { $in: contactIds } }, { $set: { assignedTo: targetAgentId, agentName: targetAgent.name, lastModified: new Date() } }),
      getCollection('leads').updateMany({ contactId: { $in: contactIds } }, { $set: { assignedTo: targetAgentId, agentName: targetAgent.name, lastModified: new Date() } })
    ]);

    // Broadcast new assignments via websockets
    broadcast('batch_uploaded', {
      batchId,
      agentId: targetAgentId.toString(),
      totalUploaded: contactsInBatch.length
    });

    broadcast('dashboard_update');
    broadcast('contacts_updated');

    res.json({ success: true, message: `Batch successfully handed over to ${targetAgent.name}` });
  } catch (err) {
    console.error('Batch handover error:', err);
    res.status(500).json({ error: 'Server error during handover' });
  }
});

module.exports = router;
