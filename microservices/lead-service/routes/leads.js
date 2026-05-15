const router = require('express').Router();
const { getCollection } = require('../../shared/mongodb');
const { authorize, verify } = require('../../shared/authMiddleware');
const { ObjectId } = require('mongodb');

// GET /api/leads/my-leads
router.get('/my-leads', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const leadsCollection = getCollection('leads');
    const usersCollection = getCollection('users');

    const matchQuery = { isDeleted: { $ne: true } };
    if (req.user.role === 'agent') {
      matchQuery.assignedTo = new ObjectId(req.user._id);
    } else if (req.user.role === 'tl') {
      const agents = await usersCollection.find({ tlId: new ObjectId(req.user._id) }).toArray();
      matchQuery.assignedTo = { $in: agents.map(a => a._id) };
    }

    const leads = await leadsCollection.find(matchQuery).sort({ createdAt: -1 }).toArray();
    const groupedMap = new Map();

    const normalize = (phone) => {
      if (!phone) return 'N/A';
      const clean = String(phone).replace(/\D/g, '');
      return clean.length >= 10 ? clean.slice(-10) : clean || 'N/A';
    };

    leads.forEach(lead => {
      const rawPhone = lead.fields?.Phone || lead.fields?.phone || lead.fields?.Mobile || 'N/A';
      const normPhone = normalize(rawPhone);
      if (!groupedMap.has(normPhone)) {
        groupedMap.set(normPhone, { ...lead, totalAmount: 0, leadsCount: 0 });
      }
      const group = groupedMap.get(normPhone);
      group.totalAmount += (parseFloat(lead.leadAmount) || 0);
      group.leadsCount += 1;
      if (new Date(lead.createdAt) > new Date(group.createdAt)) {
        const currentAmount = group.totalAmount;
        const currentCount = group.leadsCount;
        Object.assign(group, lead);
        group.totalAmount = currentAmount;
        group.leadsCount = currentCount;
      }
    });

    const result = Array.from(groupedMap.values()).sort((a, b) => 
      new Date(b.lastModified || b.createdAt) - new Date(a.lastModified || a.createdAt)
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/leads/stats
router.get('/stats', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const leadsCollection = getCollection('leads');
    let query = {};
    if (req.user.role === 'agent') query.assignedTo = new ObjectId(req.user._id);
    else if (req.user.role === 'tl') {
      const usersCollection = getCollection('users');
      const agents = await usersCollection.find({ tlId: new ObjectId(req.user._id) }).toArray();
      query.assignedTo = { $in: agents.map(a => a._id) };
    }
    const stats = await leadsCollection.aggregate([
      { $match: query },
      { $group: { _id: null, totalLeads: { $sum: 1 }, totalAmount: { $sum: '$leadAmount' } } }
    ]).toArray();
    res.json(stats[0] || { totalLeads: 0, totalAmount: 0 });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// GET /leads/appointments - Fetch scheduled appointments
router.get('/appointments', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const appointmentsCollection = getCollection('appointments');
    let query = { };
    if (req.user.role === 'agent') query.assignedTo = new ObjectId(req.user._id);
    else if (req.user.role === 'tl') {
      const usersCollection = getCollection('users');
      const agents = await usersCollection.find({ tlId: new ObjectId(req.user._id) }).toArray();
      query.assignedTo = { $in: agents.map(a => a._id) };
    }
    const appointments = await appointmentsCollection.find(query).sort({ appointmentDt: 1 }).toArray();
    res.json(appointments);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// GET /leads/callbacks - Fetch scheduled callbacks
router.get('/callbacks', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const callbacksCollection = getCollection('callbacks');
    let query = { };
    if (req.user.role === 'agent') query.assignedTo = new ObjectId(req.user._id);
    else if (req.user.role === 'tl') {
      const usersCollection = getCollection('users');
      const agents = await usersCollection.find({ tlId: new ObjectId(req.user._id) }).toArray();
      query.assignedTo = { $in: agents.map(a => a._id) };
    }
    const callbacks = await callbacksCollection.find(query).sort({ callBackDt: 1 }).toArray();
    res.json(callbacks);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /leads/appointments/:id - Delete individual appointment
router.get('/appointments/wipe', verify, authorize(['admin']), async (req, res) => {
  try {
    await getCollection('appointments').deleteMany({});
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/appointments/:id', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const appointmentsCollection = getCollection('appointments');
    const query = { _id: new ObjectId(req.params.id) };
    if (req.user.role === 'agent') query.assignedTo = new ObjectId(req.user._id);
    await appointmentsCollection.deleteOne(query);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /leads/callbacks/:id - Delete individual callback
router.get('/callbacks/wipe', verify, authorize(['admin']), async (req, res) => {
  try {
    await getCollection('callbacks').deleteMany({});
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/callbacks/:id', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const callbacksCollection = getCollection('callbacks');
    const query = { _id: new ObjectId(req.params.id) };
    if (req.user.role === 'agent') query.assignedTo = new ObjectId(req.user._id);
    await callbacksCollection.deleteOne(query);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// DELETE /leads/:id - Delete individual lead
router.delete('/:id', verify, authorize(['admin']), async (req, res) => {
  try {
    const leadsCollection = getCollection('leads');
    await leadsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
