const router = require('express').Router();
const { getCollection } = require('../mongodb');
const { authorize, verify } = require('../middleware/auth');
const { ObjectId } = require('mongodb');

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
  } else if (user.role === 'admin' && filters.tlId) {
    const usersCollection = getCollection('users');
    const agents = await usersCollection.find({ role: 'agent', tlId: new ObjectId(filters.tlId) }, { projection: { _id: 1 } }).toArray();
    const agentIds = agents.map(a => a._id);
    query.assignedTo = { $in: agentIds };
    delete query.tlId;
  }
  const contactsCollection = getCollection('contacts');
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
    if (agentId && req.user.role !== 'agent') filters.assignedTo = new ObjectId(agentId);
    if (tlId && req.user.role === 'admin') filters.tlId = tlId;
    let contacts = await getAccessibleContacts(req.user, filters);
    if (search) {
      const q = search.toLowerCase();
      contacts = contacts.filter(c => Object.values(c.fields || {}).some(v => String(v).toLowerCase().includes(q)));
    }
    const usersCollection = getCollection('users');
    const userCache = {};
    const enriched = await Promise.all(contacts.map(async c => {
      if (!userCache[c.assignedTo]) {
        userCache[c.assignedTo] = await usersCollection.findOne({ _id: c.assignedTo }, { projection: { password: 0 } });
      }
      return { ...c, agentName: userCache[c.assignedTo]?.name || 'Unknown' };
    }));
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
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
      disposition: { $in: ['Lead', 'Invalid', 'DoNotCall'] } 
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
    } else if (disposition === 'Appointment') {
      update.appointmentDt = appointmentDt ? new Date(appointmentDt) : null;
      update.queueOrder = 999999;
    } else if (disposition === 'CallBack') {
      update.callBackDt = callBackDt ? new Date(callBackDt) : null;
      update.queueOrder = 999999;
    } else if (disposition === 'CallNotAnswered' || disposition === 'HungUp') {
      update.rechurnCount = (contact.rechurnCount || 0) + 1;
      update.queueOrder = update.rechurnCount >= 3 ? 999999 : 0;
      update.lastCallAttempt = new Date();
    } else {
      update.queueOrder = 999999;
    }

    await contactsCollection.updateOne({ _id: new ObjectId(req.params.id) }, { $set: update });

    // Permanent Lead Storage Logic
    if (disposition === 'Lead') {
      const leadsCollection = getCollection('leads');
      const isFinalStatus = status === 'Converted' || status === 'Not Interested';
      
      // Check if lead already exists for this contact
      const existingLead = await leadsCollection.findOne({ contactId: new ObjectId(req.params.id) });

      if (!isFinalStatus && existingLead) {
        // If not a final status and lead already exists, block and ask agent to use CallBack/Appointment
        return res.status(409).json({ 
          error: 'EXISTING_LEAD', 
          message: 'A lead record already exists for this contact. Please save as Callback or Appointment.' 
        });
      }

      // If no lead exists OR if it's a final status update (we can allow multiple final records or update?)
      // User said "if dont then save the lead in my leads"
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
          createdAt: new Date(),
          lastModified: new Date()
        };
        await callbacksCollection.insertOne(callbackRecord);
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
    if (callBackDt) update.callBackDt = new Date(callBackDt);
    if (status === 'Converted') {
      update.queueOrder = 999999;
      update.conversionDate = new Date();
    }
    await contactsCollection.updateOne({ _id: contactId }, { $set: update });

    // Sync with Permanent Leads
    try {
      const leadsCollection = getCollection('leads');
      // Update the latest lead record for this contact
      await leadsCollection.updateOne(
        { contactId: contactId },
        { $set: { status, statusDetails, transactionId, lastModified: new Date() } },
        { sort: { createdAt: -1 } }
      );
    } catch (leadErr) {
      console.error('Failed to sync status to leads collection:', leadErr);
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

    const [total, pending, lead, appointment, callBack, invalid, doNotCall, hungUp] = await Promise.all([
      contactsCollection.countDocuments(query),
      contactsCollection.countDocuments({ ...query, disposition: null }),
      contactsCollection.countDocuments({ ...query, disposition: 'Lead' }),
      contactsCollection.countDocuments({ ...query, disposition: 'Appointment' }),
      contactsCollection.countDocuments({ ...query, disposition: 'CallBack' }),
      contactsCollection.countDocuments({ ...query, disposition: 'Invalid' }),
      contactsCollection.countDocuments({ ...query, disposition: 'DoNotCall' }),
      contactsCollection.countDocuments({ ...query, disposition: 'HungUp' }),
    ]);

    // Aggregate lead amount
    const leadAmountResult = await contactsCollection.aggregate([
      { $match: { ...query, disposition: 'Lead' } },
      { $group: { _id: null, total: { $sum: '$leadAmount' } } }
    ]).toArray();

    res.json({
      total, pending, lead, appointment, callBack, invalid, doNotCall, hungUp,
      totalLeadAmount: leadAmountResult[0]?.total || 0
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
    
    const stats = await Promise.all(agents.map(async (agent) => {
      const q = { assignedTo: agent._id, isDeleted: { $ne: true } };
      
      const [total, pending, lead, appointment] = await Promise.all([
        contactsCollection.countDocuments(q),
        contactsCollection.countDocuments({ ...q, disposition: null }),
        contactsCollection.countDocuments({ ...q, disposition: 'Lead' }),
        contactsCollection.countDocuments({ ...q, disposition: 'Appointment' }),
      ]);
      const disposed = total - pending;

      const leadAmountResult = await contactsCollection.aggregate([
        { $match: { ...q, disposition: 'Lead' } },
        { $group: { _id: null, total: { $sum: '$leadAmount' } } }
      ]).toArray();

      let tlName = '—';
      if (agent.tlId) {
        const tl = await usersCollection.findOne({ _id: agent.tlId });
        tlName = tl?.name || '—';
      }

      return {
        agent: { _id: agent._id, name: agent.name },
        tlName,
        total,
        disposed,
        lead,
        appointment,
        pending,
        totalLeadAmount: leadAmountResult[0]?.total || 0
      };
    }));

    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Queue status fetch failed' });
  }
});

module.exports = router;

