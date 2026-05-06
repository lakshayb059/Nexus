const router = require('express').Router();
const { getCollection } = require('../mongodb');
const { authorize, verify } = require('../middleware/auth');
const { ObjectId } = require('mongodb');
const { consolidateCallbacks, cleanupAllCallbacks } = require('../utils/callbackUtils');

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

    const pipeline = [
      { $match: matchQuery },
      {
        $addFields: {
          normPhone: { $ifNull: ["$fields.Phone", { $ifNull: ["$fields.phone", { $ifNull: ["$fields.Mobile", "N/A"] }] }] }
        }
      },
      { $sort: { appointmentDt: 1 } }, // Earliest first
      {
        $group: {
          _id: "$normPhone",
          earliestApp: { $first: "$$ROOT" }
        }
      },
      { $replaceRoot: { newRoot: "$earliestApp" } },
      { $sort: { appointmentDt: 1 } }
    ];
    const aggregated = await appointmentsCollection.aggregate(pipeline).toArray();
    res.json(aggregated);
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

    const callbacks = await callbacksCollection.find(matchQuery).sort({ callBackDt: 1 }).toArray();
    res.json(callbacks.map(c => ({ ...c, isLeadCallback: false })));
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

// PUT /api/leads/callbacks/:id - Update an existing callback
router.put('/callbacks/:id', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const { callBackDt, remarks } = req.body;
    const callbacksCollection = getCollection('callbacks');
    const contactsCollection = getCollection('contacts');

    const callback = await callbacksCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!callback) return res.status(404).json({ error: 'Callback not found' });

    const update = { lastModified: new Date() };
    if (callBackDt) update.callBackDt = new Date(callBackDt);
    if (remarks) update.remarks = remarks;

    await callbacksCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: update }
    );

    // Also update the associated contact if it exists
    if (callback.contactId) {
      await contactsCollection.updateOne(
        { _id: new ObjectId(callback.contactId) },
        { $set: { ...update, disposition: 'CallBack' } }
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Update callback error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/leads/:id/clone-and-dispose - Clone contact and perform a call action
router.post('/:id/clone-and-dispose', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const { action, leadAmount, status, transactionId, callBackDt, remarks, statusDetails } = req.body;
    const leadsCollection = getCollection('leads');
    const contactsCollection = getCollection('contacts');

    // 1. Find the existing lead to get contact fields
    const existingLead = await leadsCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!existingLead) return res.status(404).json({ error: 'Original lead not found' });

    // 2. Create the cloned contact record (clean state)
    const newContact = {
      fields: existingLead.fields,
      batchId: existingLead.batchId,
      assignedTo: new ObjectId(req.user._id),
      createdAt: new Date(),
      lastModified: new Date(),
      isDeleted: false,
      queueOrder: 999999, // Push it out of the main queue since we are immediately disposing it
      disposition: null,
      disposedBy: new ObjectId(req.user._id),
      disposedAt: new Date(),
      agentName: req.user.name,
      agentId: new ObjectId(req.user._id),
      remarks: remarks || `[Call Action: ${action}]`
    };

    if (action === 'Followup') {
      newContact.disposition = 'CallBack';
      newContact.callBackDt = new Date(callBackDt);
    } else {
      newContact.disposition = 'Lead';
      newContact.leadAmount = parseFloat(leadAmount) || 0;
      newContact.conversionDate = new Date();
      newContact.status = action === 'Not Interested' ? 'Not Interested' : status;
      newContact.transactionId = transactionId || '';
      newContact.statusDetails = statusDetails || '';
    }

    const insertResult = await contactsCollection.insertOne(newContact);
    const newContactId = insertResult.insertedId;

    // 3. Perform specific disposition logic
    if (action === 'Followup') {
      const callbacksCollection = getCollection('callbacks');
      await callbacksCollection.insertOne({
        contactId: newContactId,
        fields: newContact.fields,
        batchId: newContact.batchId,
        assignedTo: new ObjectId(req.user._id),
        agentName: req.user.name,
        callBackDt: new Date(callBackDt),
        remarks: remarks || '[Follow-up scheduled from My Leads]',
        source: 'lead',
        createdAt: new Date(),
        lastModified: new Date()
      });

      // Consolidate callbacks for this phone number
      const phoneNum = newContact.fields?.Phone || newContact.fields?.phone || newContact.fields?.Mobile;
      await consolidateCallbacks(phoneNum);
    } else if (action === 'Lead' || action === 'Not Interested') {
      const leadRecord = {
        contactId: newContactId,
        fields: newContact.fields,
        batchId: newContact.batchId,
        assignedTo: new ObjectId(req.user._id),
        agentName: req.user.name,
        leadAmount: parseFloat(leadAmount) || 0,
        status: action === 'Not Interested' ? 'Not Interested' : status,
        statusDetails: statusDetails || '',
        transactionId: transactionId || '',
        remarks: remarks || `[Generated from Call Action: ${action}]`,
        callBackDt: status === 'Call Back' && callBackDt ? new Date(callBackDt) : null,
        appointmentDt: null,
        createdAt: new Date(),
        lastModified: new Date()
      };
      await leadsCollection.insertOne(leadRecord);
    }

    // Cleanup: If not a Followup, remove all callbacks for this phone
    const phoneNum = newContact.fields?.Phone || newContact.fields?.phone || newContact.fields?.Mobile;
    if (action !== 'Followup') {
      await cleanupAllCallbacks(phoneNum);
    }

    // 4. Emit events
    const io = req.app.get('io');
    if (io) {
      io.emit('contact_disposed', { contactId: newContactId, disposition: newContact.disposition, agentName: req.user.name });
      io.emit('dashboard_update');
      io.emit('contacts_updated');
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Clone and dispose error:', err);
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
