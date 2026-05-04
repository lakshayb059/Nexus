const router = require('express').Router();
const { getCollection } = require('../mongodb');
const { authorize, verify } = require('../middleware/auth');
const { ObjectId } = require('mongodb');

// GET /api/leads/my-leads - Fetch leads for the current agent
router.get('/my-leads', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    let query = { disposition: 'Lead' };
    
    if (req.user.role === 'agent') {
      query.assignedTo = new ObjectId(req.user._id);
    } else if (req.user.role === 'tl') {
      const usersCollection = getCollection('users');
      const agents = await usersCollection.find({ tlId: new ObjectId(req.user._id) }).toArray();
      const agentIds = agents.map(a => a._id);
      query.assignedTo = { $in: agentIds };
    }
    // Admin sees all leads

    const leads = await contactsCollection.find(query).sort({ lastModified: -1 }).toArray();
    
    // Enrich with agent names
    const usersCollection = getCollection('users');
    const enriched = await Promise.all(leads.map(async l => {
      const agent = await usersCollection.findOne({ _id: l.assignedTo }, { projection: { name: 1 } });
      return { ...l, agentName: agent?.name || 'Unknown Agent' };
    }));

    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/leads/appointments - Fetch upcoming appointments
router.get('/appointments', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    let query = { disposition: 'Appointment', appointmentDt: { $gte: new Date() } };
    
    if (req.user.role === 'agent') {
      query.assignedTo = new ObjectId(req.user._id);
    } else if (req.user.role === 'tl') {
      const usersCollection = getCollection('users');
      const agents = await usersCollection.find({ tlId: new ObjectId(req.user._id) }).toArray();
      const agentIds = agents.map(a => a._id);
      query.assignedTo = { $in: agentIds };
    }

    const appointments = await contactsCollection.find(query).sort({ appointmentDt: 1 }).toArray();
    
    // Enrich with agent names
    const usersCollection = getCollection('users');
    const enriched = await Promise.all(appointments.map(async a => {
      const agent = await usersCollection.findOne({ _id: a.assignedTo }, { projection: { name: 1 } });
      return { ...a, agentName: agent?.name || 'Unknown Agent' };
    }));

    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/leads/callbacks - Fetch upcoming callbacks
router.get('/callbacks', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    let query = { disposition: 'CallBack' };
    
    if (req.user.role === 'agent') {
      query.assignedTo = new ObjectId(req.user._id);
    } else if (req.user.role === 'tl') {
      const usersCollection = getCollection('users');
      const agents = await usersCollection.find({ tlId: new ObjectId(req.user._id) }).toArray();
      const agentIds = agents.map(a => a._id);
      query.assignedTo = { $in: agentIds };
    }

    const callbacks = await contactsCollection.find(query).sort({ callBackDt: 1 }).toArray();
    
    // Enrich with agent names
    const usersCollection = getCollection('users');
    const enriched = await Promise.all(callbacks.map(async c => {
      const agent = await usersCollection.findOne({ _id: c.assignedTo }, { projection: { name: 1 } });
      return { ...c, agentName: agent?.name || 'Unknown Agent' };
    }));

    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/leads/stats - Statistics for lead amounts and counts
router.get('/stats', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    let query = { disposition: 'Lead' };
    
    if (req.user.role === 'agent') {
      query.assignedTo = new ObjectId(req.user._id);
    } else if (req.user.role === 'tl') {
      const usersCollection = getCollection('users');
      const agents = await usersCollection.find({ tlId: new ObjectId(req.user._id) }).toArray();
      const agentIds = agents.map(a => a._id);
      query.assignedTo = { $in: agentIds };
    }

    const stats = await contactsCollection.aggregate([
      { $match: query },
      { 
        $group: { 
          _id: null, 
          totalLeads: { $sum: 1 }, 
          totalAmount: { $sum: '$leadAmount' } 
        } 
      }
    ]).toArray();

    res.json(stats[0] || { totalLeads: 0, totalAmount: 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
