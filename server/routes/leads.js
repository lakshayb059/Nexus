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
        {
          $addFields: {
            normPhone: { $ifNull: ["$fields.Phone", { $ifNull: ["$fields.phone", { $ifNull: ["$fields.Mobile", "N/A"] }] }] },
            sortPriority: {
              $cond: {
                if: { $in: ["$status", ["Converted", "Not Interested"]] },
                then: 1,
                else: 0
              }
            }
          }
        },
        { $sort: { sortPriority: 1, createdAt: -1 } },
        {
          $group: {
            _id: "$normPhone",
            latestLead: { $first: "$$ROOT" },
            totalAmount: { $sum: "$leadAmount" },
            leadsCount: { $sum: 1 }
          }
        },
        {
          $replaceRoot: {
            newRoot: { $mergeObjects: ["$latestLead", { totalAmount: "$totalAmount", leadsCount: "$leadsCount" }] }
          }
        },
        { $sort: { lastModified: -1 } } // For the final list of unique contacts
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
    const usersCollection = getCollection('users');

    let matchQuery = {};
    if (req.user.role === 'agent') {
      matchQuery.assignedTo = new ObjectId(req.user._id);
    } else if (req.user.role === 'tl') {
      const agents = await usersCollection.find({ tlId: new ObjectId(req.user._id) }).toArray();
      matchQuery.assignedTo = { $in: agents.map(a => a._id) };
    }

    if (req.user.role === 'admin') {
      const appointments = await appointmentsCollection.find(matchQuery).sort({ appointmentDt: 1 }).toArray();
      res.json(appointments);
    } else {
      // Aggregate view for Agents/TLs
      const pipeline = [
        { $match: matchQuery },
        {
          $addFields: {
            normPhone: { $ifNull: ["$fields.Phone", { $ifNull: ["$fields.phone", { $ifNull: ["$fields.Mobile", "N/A"] }] }] }
          }
        },
        { $sort: { appointmentDt: -1 } },
        {
          $group: {
            _id: "$normPhone",
            latestApp: { $first: "$$ROOT" }
          }
        },
        { $replaceRoot: { newRoot: "$latestApp" } },
        { $sort: { appointmentDt: 1 } }
      ];
      const aggregated = await appointmentsCollection.aggregate(pipeline).toArray();
      res.json(aggregated);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/leads/callbacks - Fetch upcoming callbacks
router.get('/callbacks', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const callbacksCollection = getCollection('callbacks');
    const usersCollection = getCollection('users');

    let matchQuery = {};
    if (req.user.role === 'agent') {
      matchQuery.assignedTo = new ObjectId(req.user._id);
    } else if (req.user.role === 'tl') {
      const agents = await usersCollection.find({ tlId: new ObjectId(req.user._id) }).toArray();
      matchQuery.assignedTo = { $in: agents.map(a => a._id) };
    }

    if (req.user.role === 'admin') {
      const callbacks = await callbacksCollection.find(matchQuery).sort({ callBackDt: 1 }).toArray();
      res.json(callbacks.map(c => ({ ...c, isLeadCallback: false })));
    } else {
      // Aggregate view for Agents/TLs
      const pipeline = [
        { $match: matchQuery },
        {
          $addFields: {
            normPhone: { $ifNull: ["$fields.Phone", { $ifNull: ["$fields.phone", { $ifNull: ["$fields.Mobile", "N/A"] }] }] }
          }
        },
        { $sort: { callBackDt: -1 } },
        {
          $group: {
            _id: "$normPhone",
            latestCb: { $first: "$$ROOT" }
          }
        },
        { $replaceRoot: { newRoot: "$latestCb" } },
        { $sort: { callBackDt: 1 } }
      ];

      const aggregated = await callbacksCollection.aggregate(pipeline).toArray();
      res.json(aggregated.map(c => ({ ...c, isLeadCallback: false })));
    }
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

// DELETE /api/leads/:id - Delete a lead record (Admin only)
router.delete('/:id', verify, authorize(['admin']), async (req, res) => {
  try {
    const leadsCollection = getCollection('leads');
    const lead = await leadsCollection.findOne({ _id: new ObjectId(req.params.id) });

    if (lead && lead.contactId) {
      const contactsCollection = getCollection('contacts');
      await contactsCollection.deleteOne({ _id: new ObjectId(lead.contactId) });
    }

    await leadsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/leads/bulk-delete - Delete multiple lead records (Admin only)
router.post('/bulk-delete', verify, authorize(['admin']), async (req, res) => {
  try {
    const { ids } = req.body;
    const leadsCollection = getCollection('leads');
    const objectIds = ids.map(id => new ObjectId(id));

    // Find all lead records to get contact IDs
    const leads = await leadsCollection.find({ _id: { $in: objectIds } }).toArray();
    const contactIds = leads.map(l => l.contactId).filter(Boolean);

    if (contactIds.length > 0) {
      const contactsCollection = getCollection('contacts');
      await contactsCollection.deleteMany({ _id: { $in: contactIds.map(id => new ObjectId(id)) } });
    }

    await leadsCollection.deleteMany({ _id: { $in: objectIds } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/leads/appointments/:id - Delete an appointment (Admin only)
router.delete('/appointments/:id', verify, authorize(['admin']), async (req, res) => {
  try {
    const appointmentsCollection = getCollection('appointments');
    const app = await appointmentsCollection.findOne({ _id: new ObjectId(req.params.id) });

    if (app && app.contactId) {
      const contactsCollection = getCollection('contacts');
      await contactsCollection.deleteOne({ _id: new ObjectId(app.contactId) });
    }

    await appointmentsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/leads/appointments/bulk-delete - Delete multiple appointments (Admin only)
router.post('/appointments/bulk-delete', verify, authorize(['admin']), async (req, res) => {
  try {
    const { ids } = req.body;
    const appointmentsCollection = getCollection('appointments');
    const objectIds = ids.map(id => new ObjectId(id));

    const apps = await appointmentsCollection.find({ _id: { $in: objectIds } }).toArray();
    const contactIds = apps.map(a => a.contactId).filter(Boolean);

    if (contactIds.length > 0) {
      const contactsCollection = getCollection('contacts');
      await contactsCollection.deleteMany({ _id: { $in: contactIds.map(id => new ObjectId(id)) } });
    }

    await appointmentsCollection.deleteMany({ _id: { $in: objectIds } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/leads/callbacks/:id - Delete a callback (Admin only)
router.delete('/callbacks/:id', verify, authorize(['admin']), async (req, res) => {
  try {
    const callbacksCollection = getCollection('callbacks');
    const cb = await callbacksCollection.findOne({ _id: new ObjectId(req.params.id) });

    if (cb && cb.contactId) {
      const contactsCollection = getCollection('contacts');
      await contactsCollection.deleteOne({ _id: new ObjectId(cb.contactId) });
    }

    await callbacksCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/leads/callbacks/bulk-delete - Delete multiple callbacks (Admin only)
router.post('/callbacks/bulk-delete', verify, authorize(['admin']), async (req, res) => {
  try {
    const { ids } = req.body;
    const callbacksCollection = getCollection('callbacks');
    const objectIds = ids.map(id => new ObjectId(id));

    const cbs = await callbacksCollection.find({ _id: { $in: objectIds } }).toArray();
    const contactIds = cbs.map(c => c.contactId).filter(Boolean);

    if (contactIds.length > 0) {
      const contactsCollection = getCollection('contacts');
      await contactsCollection.deleteMany({ _id: { $in: contactIds.map(id => new ObjectId(id)) } });
    }

    await callbacksCollection.deleteMany({ _id: { $in: objectIds } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/leads/:id - Update a specific lead record
router.put('/:id', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const { status, remarks, leadAmount, statusDetails, transactionId, callBackDt, appointmentDt } = req.body;
    const leadsCollection = getCollection('leads');

    const update = {
      status,
      remarks,
      lastModified: new Date()
    };

    if (leadAmount !== undefined) update.leadAmount = parseFloat(leadAmount) || 0;
    if (statusDetails !== undefined) update.statusDetails = statusDetails;
    if (transactionId !== undefined) update.transactionId = transactionId;
    if (callBackDt) update.callBackDt = new Date(callBackDt);
    if (appointmentDt) update.appointmentDt = new Date(appointmentDt);

    const result = await leadsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: update }
    );

    if (result.matchedCount === 0) return res.status(404).json({ error: 'Lead not found' });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/leads/history/:phone - Fetch full history for a specific phone number
router.get('/history/:phone', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const leadsCollection = getCollection('leads');
    // Find all leads that match the phone number (or normalized phone)
    // For simplicity, we search for leads where any field in fields contains the phone
    const rawPhone = req.params.phone;
    // Normalize: get last 10 digits and create a flexible regex
    const last10 = rawPhone.replace(/\D/g, '').slice(-10);

    if (!last10) return res.json([]);

    // Create a regex that allows non-digit characters between numbers
    // e.g. 9876543210 -> 9[^0-9]*8[^0-9]*7...
    const regexPattern = last10.split('').join('[^0-9]*');
    const phoneRegex = new RegExp(regexPattern);

    const history = await leadsCollection.aggregate([
      {
        $match: {
          $or: [
            { "fields.Phone": { $regex: phoneRegex } },
            { "fields.phone": { $regex: phoneRegex } },
            { "fields.Mobile": { $regex: phoneRegex } },
            { "fields.Phone": { $regex: new RegExp(last10) } },
            { "fields.phone": { $regex: new RegExp(last10) } },
            { "fields.Mobile": { $regex: new RegExp(last10) } }
          ]
        }
      },
      {
        $addFields: {
          sortPriority: {
            $cond: {
              if: { $in: ["$status", ["Converted", "Not Interested"]] },
              then: 1,
              else: 0
            }
          }
        }
      },
      { $sort: { sortPriority: 1, createdAt: -1 } }
    ]).toArray();

    res.json(history);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
