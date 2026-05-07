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

    const matchQuery = { isDeleted: { $ne: true } };
    if (req.user.role === 'agent') {
      matchQuery.assignedTo = new ObjectId(req.user._id);
    } else if (req.user.role === 'tl') {
      const agents = await usersCollection.find({ tlId: new ObjectId(req.user._id) }).toArray();
      matchQuery.assignedTo = { $in: agents.map(a => a._id) };
    }

    // 1. Fetch raw lead records
    const leads = await leadsCollection.find(matchQuery).sort({ createdAt: -1 }).toArray();

    // 2. Group and normalize in Node.js for 100% reliability across all tiers
    const groupedMap = new Map();

    const normalize = (phone) => {
      if (!phone) return 'N/A';
      const clean = String(phone).replace(/\D/g, '');
      return clean.length >= 10 ? clean.slice(-10) : clean || 'N/A';
    };

    leads.forEach(lead => {
      const rawPhone = lead.fields?.Phone || lead.fields?.phone || lead.fields?.Mobile || 
                       lead.fields?.MOBILE || lead.fields?.PHONE || lead.fields?.Contact || 
                       lead.fields?.['Mobile No'] || 'N/A';
      
      const normPhone = normalize(rawPhone);

      if (!groupedMap.has(normPhone)) {
        groupedMap.set(normPhone, {
          ...lead,
          totalAmount: 0,
          leadsCount: 0
        });
      }

      const group = groupedMap.get(normPhone);
      group.totalAmount += (parseFloat(lead.leadAmount) || 0);
      group.leadsCount += 1;
      
      // Keep the most recent record as the primary one for the card
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
    const phone = req.params.phone;
    const last10 = phone.replace(/\D/g, "").slice(-10);

    if (!last10) return res.json([]);

    // 1. Fetch leads that could possibly match (indexed search)
    const leads = await leadsCollection.find({
      isDeleted: { $ne: true },
      $or: [
        { "fields.Phone": { $regex: last10 + "$" } },
        { "fields.phone": { $regex: last10 + "$" } },
        { "fields.Mobile": { $regex: last10 + "$" } },
        { "fields.MOBILE": { $regex: last10 + "$" } },
        { "fields.PHONE": { $regex: last10 + "$" } },
        { "fields.Contact": { $regex: last10 + "$" } },
        { "fields.Mobile No": { $regex: last10 + "$" } }
      ]
    }).toArray();

    // 2. Final normalization and filtering in Node.js for perfect accuracy
    const normalize = (p) => {
      if (!p) return 'N/A';
      const clean = String(p).replace(/\D/g, '');
      return clean.length >= 10 ? clean.slice(-10) : clean || 'N/A';
    };

    const history = leads.filter(l => {
      const p = l.fields?.Phone || l.fields?.phone || l.fields?.Mobile || 
                l.fields?.MOBILE || l.fields?.PHONE || l.fields?.Contact || 
                l.fields?.['Mobile No'] || 'N/A';
      return normalize(p) === last10;
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json(history);
  } catch (err) {
    console.error('[HISTORY] Error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
