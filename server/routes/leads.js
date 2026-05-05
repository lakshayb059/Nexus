const router = require('express').Router();
const { getCollection } = require('../mongodb');
const { authorize, verify } = require('../middleware/auth');
const { ObjectId } = require('mongodb');

// GET /api/leads/my-leads - Fetch leads for the current agent
router.get('/my-leads', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const leadsCollection = getCollection('leads');
    const usersCollection = getCollection('users');
    
    let matchQuery = {};
    if (req.user.role === 'agent') {
      matchQuery.assignedTo = new ObjectId(req.user._id);
    } else if (req.user.role === 'tl') {
      const agents = await usersCollection.find({ tlId: new ObjectId(req.user._id) }).toArray();
      matchQuery.assignedTo = { $in: agents.map(a => a._id) };
    }

    if (req.user.role === 'admin') {
      // Admin sees every single lead record independently
      const leads = await leadsCollection.find(matchQuery).sort({ createdAt: -1 }).toArray();
      res.json(leads);
    } else {
      // Agents and TLs see aggregated view (one card per contact with total stats)
      const pipeline = [
        { $match: matchQuery },
        { $addFields: { 
            normPhone: { $ifNull: ["$fields.Phone", { $ifNull: ["$fields.phone", { $ifNull: ["$fields.Mobile", "N/A"] }] }] } 
        }},
        { $sort: { createdAt: -1 } },
        { $group: {
            _id: "$normPhone",
            latestLead: { $first: "$$ROOT" },
            totalAmount: { $sum: "$leadAmount" },
            leadsCount: { $sum: 1 }
        }},
        { $replaceRoot: { 
            newRoot: { $mergeObjects: ["$latestLead", { totalAmount: "$totalAmount", leadsCount: "$leadsCount" }] } 
        }},
        { $sort: { lastModified: -1 } }
      ];
      
      const aggregatedLeads = await leadsCollection.aggregate(pipeline).toArray();
      res.json(aggregatedLeads);
    }
  } catch (err) {
    console.error('Fetch leads error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/leads/appointments - Fetch upcoming appointments
router.get('/appointments', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const appointmentsCollection = getCollection('appointments');
    let query = {};
    
    if (req.user.role === 'agent') {
      query.assignedTo = new ObjectId(req.user._id);
    } else if (req.user.role === 'tl') {
      const usersCollection = getCollection('users');
      const agents = await usersCollection.find({ tlId: new ObjectId(req.user._id) }).toArray();
      const agentIds = agents.map(a => a._id);
      query.assignedTo = { $in: agentIds };
    }

    const appointments = await appointmentsCollection.find(query).sort({ appointmentDt: 1 }).toArray();
    res.json(appointments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/leads/callbacks - Fetch upcoming callbacks
router.get('/callbacks', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const callbacksCollection = getCollection('callbacks');
    let query = {};
    
    if (req.user.role === 'agent') {
      query.assignedTo = new ObjectId(req.user._id);
    } else if (req.user.role === 'tl') {
      const usersCollection = getCollection('users');
      const agents = await usersCollection.find({ tlId: new ObjectId(req.user._id) }).toArray();
      const agentIds = agents.map(a => a._id);
      query.assignedTo = { $in: agentIds };
    }

    const callbacks = await callbacksCollection.find(query).sort({ callBackDt: 1 }).toArray();
    res.json(callbacks);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/leads/stats - Statistics for lead amounts and counts
router.get('/stats', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const leadsCollection = getCollection('leads');
    let query = {};
    
    if (req.user.role === 'agent') {
      query.assignedTo = new ObjectId(req.user._id);
    } else if (req.user.role === 'tl') {
      const usersCollection = getCollection('users');
      const agents = await usersCollection.find({ tlId: new ObjectId(req.user._id) }).toArray();
      const agentIds = agents.map(a => a._id);
      query.assignedTo = { $in: agentIds };
    }

    const stats = await leadsCollection.aggregate([
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
