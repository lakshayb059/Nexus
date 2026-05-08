const router = require('express').Router();
const { getCollection } = require('../mongodb');
const { authorize, verify } = require('../middleware/auth');
const { ObjectId } = require('mongodb');
const { consolidateCallbacks, cleanupAllCallbacks } = require('../utils/callbackUtils');

// Helper: get contacts based on role
async function getAccessibleContacts(user, filters = {}, includeDeleted = false) {
  let query = { ...filters };
  if (!includeDeleted) query.isDeleted = { $ne: true };
  
  if (user.role === 'agent') {
    query.assignedTo = new ObjectId(user._id);
  } else if (user.role === 'tl') {
    const usersCollection = getCollection('users');
    const agents = await usersCollection.find({ role: 'agent', tlId: new ObjectId(user._id) }, { projection: { _id: 1 } }).toArray();
    const agentIds = agents.map(a => a._id);
    query.assignedTo = { $in: agentIds };
  } else if (user.role === 'admin') {
    if (filters.tlId) {
      try {
        const tlObjectId = new ObjectId(filters.tlId);
        const usersCollection = getCollection('users');
        const agents = await usersCollection.find({ role: 'agent', tlId: tlObjectId }, { projection: { _id: 1 } }).toArray();
        const agentIds = agents.map(a => a._id);
        query.assignedTo = { $in: agentIds };
      } catch (err) {
        console.warn('Invalid tlId in filter:', filters.tlId);
      }
      delete query.tlId;
    }
    // Handle agentId if it's already in filters as assignedTo
    if (query.assignedTo && typeof query.assignedTo === 'string') {
      try { query.assignedTo = new ObjectId(query.assignedTo); } catch(e) {}
    }
  }
  
  const contactsCollection = getCollection('contacts');
  console.log(`[DB FETCH] User: ${user.name} (${user.role}) | Query: ${JSON.stringify(query)}`);
  return contactsCollection.find(query).sort({ queueOrder: 1, createdAt: 1 }).toArray();
}

// GET /contacts - list
router.get('/', verify, authorize(['admin', 'tl', 'agent']), async (req, res) => {
  try {
    const { disposition, agentId, tlId, search, batchId } = req.query;
    const filters = {};
    if (disposition === 'pending') filters.disposition = null;
    else if (disposition) filters.disposition = disposition;
    if (batchId) filters.batchId = batchId;
    
    if (agentId && req.user.role !== 'agent') {
      try { filters.assignedTo = new ObjectId(agentId); } catch(e) {}
    }
    if (tlId && req.user.role === 'admin') filters.tlId = tlId;
    
    if (search && search.trim()) {
      filters.$text = { $search: search };
    }

    let contacts = await getAccessibleContacts(req.user, filters);
    
    try {
      const usersCollection = getCollection('users');
      
      // Extremely safe ID extraction
      const validIds = contacts
        .map(c => c.assignedTo)
        .filter(id => id && (typeof id === 'string' || typeof id === 'object'))
        .map(id => id.toString())
        .filter(id => /^[0-9a-fA-F]{24}$/.test(id)); // Only keep valid 24-char hex strings

      const uniqueIds = [...new Set(validIds)].map(id => new ObjectId(id));
      
      let userMap = {};
      if (uniqueIds.length > 0) {
        const agents = await usersCollection.find(
          { _id: { $in: uniqueIds } },
          { projection: { _id: 1, name: 1 } }
        ).toArray();
        userMap = agents.reduce((acc, a) => { 
          if (a._id) acc[a._id.toString()] = a.name; 
          return acc; 
        }, {});
      }

      const enriched = contacts.map(c => {
        const aId = c.assignedTo ? c.assignedTo.toString() : null;
        return {
          ...c,
          agentName: aId ? (userMap[aId] || 'Unknown Agent') : 'Unassigned'
        };
      });
      return res.json(enriched);
    } catch (enrichErr) {
      console.error('Enrichment failed:', enrichErr);
      return res.json(contacts);
    }
  } catch (err) { 
    console.error('Fetch contacts error:', err);
    res.status(500).json({ error: 'Server error' }); 
  }
});

// GET /contacts/queue
router.get('/queue', verify, authorize(['agent']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    const now = new Date();
    const commonQuery = { assignedTo: new ObjectId(req.user._id), isDeleted: { $ne: true } };

    const dueCallbacks = await contactsCollection.find({
      ...commonQuery,
      disposition: 'CallBack',
      callBackDt: { $lte: now },
      queueOrder: 999999
    }).sort({ callBackDt: 1 }).limit(1).toArray();

    if (dueCallbacks.length > 0) {
      await contactsCollection.updateOne({ _id: dueCallbacks[0]._id }, { $set: { queueOrder: 0, callBackDt: null } });
      const total = await contactsCollection.countDocuments(commonQuery);
      const disposed = await contactsCollection.countDocuments({ ...commonQuery, disposition: { $nin: [null, 'CallNotAnswered'] } });
      return res.json({ contact: dueCallbacks[0], remaining: 1, total, disposed, type: 'callback_due' });
    }

    let query = { ...commonQuery, queueOrder: { $lt: 999999 } };
    if (req.query.contactId) query._id = new ObjectId(req.query.contactId);

    const allPending = await contactsCollection.find(query).sort({ queueOrder: 1, createdAt: 1 }).toArray();
    const fresh = allPending.filter(c => c.disposition === null);
    const rechurn = allPending.filter(c => (c.disposition === 'CallNotAnswered' || c.disposition === 'HungUp') && (c.rechurnCount || 0) < 3);

    let contact = null;
    let type = 'fresh';
    if (req.query.contactId) contact = allPending[0];
    else if (fresh.length > 0) contact = fresh[0];
    else if (rechurn.length > 0) { contact = rechurn[0]; type = 'rechurn'; }

    const total = await contactsCollection.countDocuments(commonQuery);
    const finalized = await contactsCollection.countDocuments({ 
      ...commonQuery, 
      disposition: { $in: ['Lead', 'Invalid', 'DoNotCall', 'Appointment', 'CallBack'] } 
    });
    const pendingCount = total - finalized;
    const disposed = finalized;
    
    const upcomingAppointments = await contactsCollection.find({
      ...commonQuery,
      disposition: 'Appointment',
      appointmentDt: { $gte: now, $lte: new Date(now.getTime() + 30 * 60 * 1000) }
    }).sort({ appointmentDt: 1 }).limit(3).toArray();

    res.json({ 
      contact, 
      remaining: fresh.length + rechurn.length, 
      total, 
      pending: pendingCount, 
      disposed, 
      upcomingAppointments, 
      type: contact ? type : null, 
      rechurnNum: contact?.rechurnCount || 0 
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /contacts/:id/check-callback - Check if a callback already exists for this contact (by phone)
router.get('/:id/check-callback', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    const contact = await contactsCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const phoneNum = contact.fields?.Phone || contact.fields?.phone || contact.fields?.Mobile;
    if (!phoneNum) return res.json({ exists: false });

    const { normalizePhone } = require('../utils/callbackUtils');
    const normalized = normalizePhone(phoneNum);
    if (!normalized) return res.json({ exists: false });

    const callbacksCollection = getCollection('callbacks');
    const phoneRegex = new RegExp(normalized + '$');
    
    const existingCb = await callbacksCollection.findOne({
      $or: [
        { "fields.Phone": { $regex: phoneRegex } },
        { "fields.phone": { $regex: phoneRegex } },
        { "fields.Mobile": { $regex: phoneRegex } }
      ]
    });

    if (existingCb) {
      return res.json({ exists: true, callback: existingCb });
    }
    res.json({ exists: false });
  } catch (err) {
    console.error('Check callback error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /contacts/:id/dispose - MULTI-LEAD ALLOWED, NO DUPLICATE CHECKS
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

    console.log(`[DISPOSE] ID: ${req.params.id} | Disp: ${disposition} | Agent: ${req.user.name}`);

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
      if (callBackDt) {
        update.callBackDt = new Date(callBackDt);
        update.cbReminderSent = false;
      }
      if (appointmentDt) {
        update.appointmentDt = new Date(appointmentDt);
        update.reminderSent = false;
        update.lateNotified = false;
      }
    } else if (disposition === 'Appointment') {
      update.appointmentDt = appointmentDt ? new Date(appointmentDt) : null;
      update.reminderSent = false;
      update.lateNotified = false;
      update.queueOrder = 999999;
    } else if (disposition === 'CallBack') {
      update.callBackDt = callBackDt ? new Date(callBackDt) : null;
      update.cbReminderSent = false;
      update.queueOrder = 999999;
      update.status = 'Call Back';
    } else if (disposition === 'CallNotAnswered' || disposition === 'HungUp') {
      update.rechurnCount = (contact.rechurnCount || 0) + 1;
      update.queueOrder = update.rechurnCount >= 3 ? 999999 : 0;
      update.lastCallAttempt = new Date();
    } else {
      update.queueOrder = 999999;
    }

    await contactsCollection.updateOne({ _id: new ObjectId(req.params.id) }, { $set: update });

    // Cleanup: Remove any existing appointment/callback records for this contact before potentially adding new ones
    const contactId = new ObjectId(req.params.id);
    await Promise.all([
      getCollection('appointments').deleteMany({ contactId }),
      getCollection('callbacks').deleteMany({ contactId })
    ]);

    // Cleanup: Remove all callbacks for this phone number if NOT a CallBack disposition
    const phoneNum = contact.fields?.Phone || contact.fields?.phone || contact.fields?.Mobile;
    if (disposition !== 'CallBack') {
      await cleanupAllCallbacks(phoneNum);
    }

    // Permanent Lead Storage Logic
    if (disposition === 'Lead') {
      const leadsCollection = getCollection('leads');
      
      try {
        const leadRecord = {
          contactId: new ObjectId(req.params.id),
          fields: contact.fields,
          batchId: contact.batchId,
          assignedTo: new ObjectId(req.user._id),
          agentName: req.user.name,
          leadAmount: parseFloat(leadAmount) || 0,
          status: status || 'Pending',
          statusDetails: statusDetails || '',
          transactionId: transactionId || '',
          remarks: remarks || '',
          callBackDt: callBackDt ? new Date(callBackDt) : null,
          appointmentDt: appointmentDt ? new Date(appointmentDt) : null,
          createdAt: new Date(),
          lastModified: new Date()
        };
        await leadsCollection.insertOne(leadRecord);
      } catch (leadErr) {
        console.error('Failed to save permanent lead record:', leadErr);
      }
    } else if (disposition === 'Appointment') {
      try {
        const appointmentsCollection = getCollection('appointments');
        const appointmentRecord = {
          contactId: new ObjectId(req.params.id),
          fields: contact.fields,
          batchId: contact.batchId,
          assignedTo: new ObjectId(req.user._id),
          agentName: req.user.name,
          appointmentDt: appointmentDt ? new Date(appointmentDt) : null,
          remarks: remarks || '',
          createdAt: new Date(),
          lastModified: new Date()
        };
        await appointmentsCollection.insertOne(appointmentRecord);
      } catch (err) { console.error('Appointment save error:', err); }
    } else if (disposition === 'CallBack') {
      try {
        const callbacksCollection = getCollection('callbacks');
        const callbackRecord = {
          contactId: new ObjectId(req.params.id),
          fields: contact.fields,
          batchId: contact.batchId,
          assignedTo: new ObjectId(req.user._id),
          agentName: req.user.name,
          callBackDt: callBackDt ? new Date(callBackDt) : null,
          remarks: remarks || '',
          status: 'Call Back',
          createdAt: new Date(),
          lastModified: new Date()
        };
        await callbacksCollection.insertOne(callbackRecord);

        // Consolidate callbacks for this phone number
        const phoneNum = contact.fields?.Phone || contact.fields?.phone || contact.fields?.Mobile;
        await consolidateCallbacks(phoneNum);
      } catch (err) { console.error('Callback save error:', err); }
    }

    const io = req.app.get('io');
    if (io) io.emit('contact_disposed', { contactId: req.params.id, disposition, agentName: req.user.name });
    res.json({ success: true });
  } catch (err) { 
    console.error('Disposition error:', err);
    res.status(500).json({ error: 'Server error' }); 
  }
});

// PUT /contacts/:id/status
router.put('/:id/status', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const { status, statusDetails, callBackDt, transactionId } = req.body;
    const contactsCollection = getCollection('contacts');
    const contactId = new ObjectId(req.params.id);

    // Locking Logic: If lead is already converted with transactionId, agents cannot change it
    if (req.user.role === 'agent') {
      const existing = await contactsCollection.findOne({ _id: contactId });
      if (existing && existing.status === 'Converted' && existing.transactionId) {
        return res.status(403).json({ error: 'This lead is locked and cannot be modified.' });
      }
    }

    const update = { lastModified: new Date(), status, statusDetails, transactionId };
    if (callBackDt) {
      update.callBackDt = new Date(callBackDt);
      update.cbReminderSent = false;
    }
    if (status === 'Converted') {
      update.queueOrder = 999999;
      update.conversionDate = new Date();
    }
    await contactsCollection.updateOne({ _id: contactId }, { $set: update });

    // Cleanup: If status is NOT Call Back or Appointment, remove from those tables
    if (status !== 'Call Back' && status !== 'Appointment') {
      await Promise.all([
        getCollection('appointments').deleteMany({ contactId }),
        getCollection('callbacks').deleteMany({ contactId })
      ]);
    }

    // Sync with Permanent Leads
    try {
      const leadsCollection = getCollection('leads');
      const existing = await leadsCollection.findOne({ contactId: contactId });
      
      if (existing) {
        // Update the latest lead record for this contact
        await leadsCollection.updateOne(
          { contactId: contactId },
          { $set: { status, statusDetails, transactionId, lastModified: new Date() } },
          { sort: { createdAt: -1 } }
        );
      } else {
        // If it's a lead disposition but no lead record exists, create one
        const contact = await contactsCollection.findOne({ _id: contactId });
        if (contact && contact.disposition === 'Lead') {
          await leadsCollection.insertOne({
            contactId: contactId,
            fields: contact.fields,
            batchId: contact.batchId,
            assignedTo: contact.assignedTo,
            agentName: contact.agentName || 'Unknown',
            leadAmount: contact.leadAmount || 0,
            status: status || 'Pending',
            statusDetails: statusDetails || '',
            transactionId: transactionId || '',
            remarks: contact.remarks || '[Auto-synced from status update]',
            createdAt: new Date(),
            lastModified: new Date()
          });
        }
      }
    } catch (leadErr) {
      console.error('Failed to sync status to leads collection:', leadErr);
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('contacts_updated');
      io.emit('dashboard_update');
    }

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/:id', verify, authorize(['admin']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    await contactsCollection.updateOne({ _id: new ObjectId(req.params.id) }, { $set: { isDeleted: true, deletedAt: new Date() } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/batch/:batchId', verify, authorize(['admin']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    // Preservation Logic: Skip contacts that have been disposed as 'Lead'
    await contactsCollection.updateMany(
      { batchId: req.params.batchId, disposition: { $ne: 'Lead' } }, 
      { $set: { isDeleted: true, deletedAt: new Date() } }
    );
    const batchesCollection = getCollection('batches');
    await batchesCollection.deleteOne({ _id: req.params.batchId });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/bulk-delete-batches', verify, authorize(['admin']), async (req, res) => {
  try {
    const { batchIds } = req.body;
    const contactsCollection = getCollection('contacts');
    const batchesCollection = getCollection('batches');
    // Preservation Logic: Skip contacts that have been disposed as 'Lead'
    await contactsCollection.updateMany(
      { batchId: { $in: batchIds }, disposition: { $ne: 'Lead' } }, 
      { $set: { isDeleted: true, deletedAt: new Date() } }
    );
    await batchesCollection.deleteMany({ _id: { $in: batchIds } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});


router.post('/bulk-delete', verify, authorize(['admin']), async (req, res) => {
  try {
    const { ids } = req.body;
    const contactsCollection = getCollection('contacts');
    const objectIds = ids.map(id => new ObjectId(id));
    // Preservation Logic: Skip contacts that have been disposed as 'Lead'
    await contactsCollection.updateMany(
      { _id: { $in: objectIds }, disposition: { $ne: 'Lead' } }, 
      { $set: { isDeleted: true, deletedAt: new Date() } }
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/:id/requeue', verify, authorize(['admin', 'tl', 'agent']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    const contactId = new ObjectId(req.params.id);
    
    const contact = await contactsCollection.findOne({ _id: contactId });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    // Permission check
    let canUpdate = false;
    if (req.user.role === 'admin') {
      canUpdate = true;
    } else if (req.user.role === 'tl') {
      const usersCollection = getCollection('users');
      const assignedAgent = await usersCollection.findOne({ _id: contact.assignedTo });
      if (assignedAgent && String(assignedAgent.tlId) === String(req.user._id)) {
        canUpdate = true;
      }
    } else if (req.user.role === 'agent') {
      if (String(contact.assignedTo) === String(req.user._id)) {
        canUpdate = true;
      }
    }

    if (!canUpdate) return res.status(403).json({ error: 'Forbidden' });

    if (contact.disposition === 'Lead') {
      // Duplication Logic: Create a fresh copy for re-contacting
      const { _id, ...contactData } = contact;
      const newContact = {
        ...contactData,
        disposition: null,
        queueOrder: 0,
        remarks: `[Re-contact copy of previous lead]`,
        lastModified: new Date(),
        createdAt: new Date(),
        // Reset lead/disposition specific fields
        leadAmount: null,
        conversionDate: null,
        status: null,
        statusDetails: null,
        transactionId: null,
        callBackDt: null,
        appointmentDt: null,
        reminderSent: false,
        lateNotified: false,
        cbReminderSent: false,
        rechurnCount: 0
      };
      await contactsCollection.insertOne(newContact);
    } else {
      // Standard Logic: Just reset the existing record
      await contactsCollection.updateOne(
        { _id: contactId }, 
        { $set: { disposition: null, queueOrder: 0, isDeleted: false, deletedAt: null, lastModified: new Date() } }
      );
    }

    // Cleanup: Remove from appointments and callbacks tables
    await Promise.all([
      getCollection('appointments').deleteMany({ contactId }),
      getCollection('callbacks').deleteMany({ contactId })
    ]);
    
    const io = req.app.get('io');
    if (io) {
      io.emit('requeue_notification', {
        agentId: contact.assignedTo,
        contactName: contact.fields?.Name || contact.fields?.name || 'Unknown',
        adminName: req.user.name,
        contactId: contact._id
      });
      io.emit('contacts_updated');
      io.emit('dashboard_update');
    }

    res.json({ success: true });
  } catch (err) { 
    console.error('Requeue error:', err);
    res.status(500).json({ error: 'Server error' }); 
  }
});

// GET /contacts/stats - Global statistics for dashboard
router.get('/stats', verify, authorize(['admin', 'tl', 'agent']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    const query = { isDeleted: { $ne: true } };

    if (req.user.role === 'agent') {
      query.assignedTo = new ObjectId(req.user._id);
    } else if (req.user.role === 'tl') {
      const usersCollection = getCollection('users');
      const agents = await usersCollection.find({ role: 'agent', tlId: new ObjectId(req.user._id) }).toArray();
      query.assignedTo = { $in: agents.map(a => a._id) };
    }

    const statsResult = await contactsCollection.aggregate([
      { $match: query },
      {
        $facet: {
          total: [{ $count: 'count' }],
          pending: [{ $match: { disposition: null } }, { $count: 'count' }],
          lead: [{ $match: { disposition: 'Lead' } }, { $count: 'count' }],
          appointment: [{ $match: { disposition: 'Appointment' } }, { $count: 'count' }],
          callBack: [{ $match: { disposition: 'CallBack' } }, { $count: 'count' }],
          invalid: [{ $match: { disposition: 'Invalid' } }, { $count: 'count' }],
          doNotCall: [{ $match: { disposition: 'DoNotCall' } }, { $count: 'count' }],
          hungUp: [{ $match: { disposition: 'HungUp' } }, { $count: 'count' }],
          leadAmount: [
            { $match: { disposition: 'Lead' } },
            { $group: { _id: null, total: { $sum: '$leadAmount' } } }
          ]
        }
      }
    ]).toArray();

    const s = statsResult[0];
    const getCount = (arr) => arr && arr[0] ? arr[0].count : 0;

    res.json({
      total: getCount(s.total),
      pending: getCount(s.pending),
      lead: getCount(s.lead),
      appointment: getCount(s.appointment),
      callBack: getCount(s.callBack),
      invalid: getCount(s.invalid),
      doNotCall: getCount(s.doNotCall),
      hungUp: getCount(s.hungUp),
      totalLeadAmount: s.leadAmount && s.leadAmount[0] ? s.leadAmount[0].total : 0
    });
  } catch (err) {
    res.status(500).json({ error: 'Stats fetch failed' });
  }
});

// GET /contacts/agent-queues - Stats breakdown by agent for Admins/TLs
router.get('/agent-queues', verify, authorize(['admin', 'tl']), async (req, res) => {
  try {
    const usersCollection = getCollection('users');
    const contactsCollection = getCollection('contacts');

    let agentQuery = { role: 'agent' };
    if (req.user.role === 'tl') {
      agentQuery.tlId = new ObjectId(req.user._id);
    }

    const agents = await usersCollection.find(agentQuery).toArray();
    const agentIds = agents.map(a => a._id);

    const statsResult = await contactsCollection.aggregate([
      { $match: { assignedTo: { $in: agentIds }, isDeleted: { $ne: true } } },
      {
        $group: {
          _id: '$assignedTo',
          total: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ['$disposition', null] }, 1, 0] } },
          lead: { $sum: { $cond: [{ $eq: ['$disposition', 'Lead'] }, 1, 0] } },
          appointment: { $sum: { $cond: [{ $eq: ['$disposition', 'Appointment'] }, 1, 0] } },
          leadAmount: { $sum: '$leadAmount' }
        }
      }
    ]).toArray();

    const statsMap = statsResult.reduce((acc, s) => {
      acc[s._id.toString()] = s;
      return acc;
    }, {});

    // Get TL names in bulk
    const tlIds = [...new Set(agents.map(a => a.tlId).filter(Boolean))];
    const tls = await usersCollection.find({ _id: { $in: tlIds } }).toArray();
    const tlMap = tls.reduce((acc, tl) => {
      acc[tl._id.toString()] = tl.name;
      return acc;
    }, {});

    const stats = agents.map(agent => {
      const s = statsMap[agent._id.toString()] || { total: 0, pending: 0, lead: 0, appointment: 0, leadAmount: 0 };
      return {
        agent: { _id: agent._id, name: agent.name },
        tlName: agent.tlId ? (tlMap[agent.tlId.toString()] || '—') : '—',
        total: s.total,
        disposed: s.total - s.pending,
        lead: s.lead,
        appointment: s.appointment,
        pending: s.pending,
        totalLeadAmount: s.leadAmount
      };
    });

    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Queue status fetch failed' });
  }
});

// POST /api/contacts/bulk-requeue - Re-queue multiple contacts at once
router.post('/bulk-requeue', verify, authorize(['admin', 'tl', 'agent']), async (req, res) => {
  try {
    const { ids } = req.body; // These should be contact IDs
    if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'Invalid IDs' });

    const contactsCollection = getCollection('contacts');
    const objectIds = ids.map(id => new ObjectId(id));

    // Reset all selected contacts to the front of the queue
    await contactsCollection.updateMany(
      { _id: { $in: objectIds } },
      { $set: { disposition: null, queueOrder: 0, isDeleted: false, deletedAt: null, lastModified: new Date() } }
    );

    // Cleanup: Remove from appointments and callbacks tables
    await Promise.all([
      getCollection('appointments').deleteMany({ contactId: { $in: objectIds } }),
      getCollection('callbacks').deleteMany({ contactId: { $in: objectIds } })
    ]);

    const io = req.app.get('io');
    if (io) {
      io.emit('contacts_updated');
      io.emit('dashboard_update');
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Bulk requeue error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

