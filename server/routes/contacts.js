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
    const disposed = await contactsCollection.countDocuments({ ...commonQuery, disposition: { $nin: [null, 'CallNotAnswered', 'HungUp'] } });
    
    const upcomingAppointments = await contactsCollection.find({
      ...commonQuery,
      disposition: 'Appointment',
      appointmentDt: { $gte: now, $lte: new Date(now.getTime() + 30 * 60 * 1000) }
    }).sort({ appointmentDt: 1 }).limit(3).toArray();

    res.json({ contact, remaining: fresh.length + rechurn.length, total, disposed, upcomingAppointments, type: contact ? type : null, rechurnNum: contact?.rechurnCount || 0 });
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
    const update = { lastModified: new Date(), status, statusDetails, transactionId };
    if (callBackDt) update.callBackDt = new Date(callBackDt);
    if (status === 'Converted') {
      update.queueOrder = 999999;
      update.conversionDate = new Date();
    }
    await contactsCollection.updateOne({ _id: new ObjectId(req.params.id) }, { $set: update });
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
    await contactsCollection.updateMany({ batchId: req.params.batchId }, { $set: { isDeleted: true, deletedAt: new Date() } });
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
    await contactsCollection.updateMany({ batchId: { $in: batchIds } }, { $set: { isDeleted: true, deletedAt: new Date() } });
    await batchesCollection.deleteMany({ _id: { $in: batchIds } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});


router.post('/bulk-delete', verify, authorize(['admin']), async (req, res) => {
  try {
    const { ids } = req.body;
    const contactsCollection = getCollection('contacts');
    const objectIds = ids.map(id => new ObjectId(id));
    await contactsCollection.updateMany({ _id: { $in: objectIds } }, { $set: { isDeleted: true, deletedAt: new Date() } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/:id/requeue', verify, authorize(['agent']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    await contactsCollection.updateOne({ _id: new ObjectId(req.params.id), assignedTo: new ObjectId(req.user._id) }, { $set: { disposition: null, queueOrder: 0, lastModified: new Date() } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
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
      
      const [total, disposed, lead, appointment, pending] = await Promise.all([
        contactsCollection.countDocuments(q),
        contactsCollection.countDocuments({ ...q, disposition: { $nin: [null, 'CallNotAnswered', 'HungUp'] } }),
        contactsCollection.countDocuments({ ...q, disposition: 'Lead' }),
        contactsCollection.countDocuments({ ...q, disposition: 'Appointment' }),
        contactsCollection.countDocuments({ ...q, disposition: null }),
      ]);

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

