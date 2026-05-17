const router = require('express').Router();
const { getCollection } = require('../../shared/mongodb');
const { authorize, verify } = require('../../shared/authMiddleware');
const { ObjectId } = require('mongodb');
const { consolidateCallbacks } = require('../../shared/callbackUtils');
const { broadcast } = require('../../shared/notificationClient');

// GET /api/leads/my-leads
router.get('/my-leads', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const leadsCollection = getCollection('leads');
    const contactsCollection = getCollection('contacts');
    const usersCollection = getCollection('users');

    const matchQuery = { isDeleted: { $ne: true } };
    if (req.user.role === 'agent') {
      matchQuery.assignedTo = new ObjectId(req.user._id);
    } else if (req.user.role === 'tl') {
      const agents = await usersCollection.find({ tlId: new ObjectId(req.user._id) }).toArray();
      matchQuery.assignedTo = { $in: agents.map(a => a._id) };
    }

    // Fetch from both leads collection and contacts collection where disposition is 'Lead'
    const [leads, contactLeads, allUsers] = await Promise.all([
      leadsCollection.find(matchQuery).toArray(),
      contactsCollection.find({ ...matchQuery, disposition: 'Lead' }).toArray(),
      usersCollection.find({ role: { $in: ['agent', 'tl'] } }).toArray()
    ]);

    const userMap = allUsers.reduce((acc, u) => { acc[u._id.toString()] = u.name; return acc; }, {});

    // Map contactLeads to match the lead schema, filtering out duplicates already in leadsCollection
    const leadContactIds = new Set(leads.map(l => l.contactId ? l.contactId.toString() : ''));
    const uniqueContactLeads = contactLeads.filter(c => !leadContactIds.has(c._id.toString()));

    const mappedContactLeads = uniqueContactLeads.map(c => ({
      _id: c._id,
      contactId: c._id,
      fields: c.fields,
      batchId: c.batchId,
      assignedTo: c.assignedTo,
      agentName: c.agentName || (c.assignedTo ? userMap[c.assignedTo.toString()] : 'Unassigned'),
      leadAmount: c.leadAmount || 0,
      status: c.status || 'Converted',
      remarks: c.remarks || 'Imported Lead',
      transactionId: c.transactionId || '',
      createdAt: c.createdAt,
      lastModified: c.lastModified
    }));

    const combinedLeads = [...leads, ...mappedContactLeads];
    const groupedMap = new Map();

    const normalize = (phone) => {
      if (!phone) return 'N/A';
      const clean = String(phone).replace(/\D/g, '');
      return clean.length >= 10 ? clean.slice(-10) : clean || 'N/A';
    };

    combinedLeads.forEach(lead => {
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
    console.error('Fetch leads failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/leads/stats
router.get('/stats', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const leadsCollection = getCollection('leads');
    const contactsCollection = getCollection('contacts');
    
    let query = {};
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
    
    const [leads, contactLeads] = await Promise.all([
      leadsCollection.find(query).toArray(),
      contactsCollection.find({ ...query, disposition: 'Lead' }).toArray()
    ]);
    
    const leadContactIds = new Set(leads.map(l => l.contactId ? l.contactId.toString() : ''));
    const uniqueContactLeads = contactLeads.filter(c => !leadContactIds.has(c._id.toString()));
    
    const totalLeads = leads.length + uniqueContactLeads.length;
    const totalAmount = leads.reduce((sum, l) => sum + (parseFloat(l.leadAmount) || 0), 0) +
                        uniqueContactLeads.reduce((sum, c) => sum + (parseFloat(c.leadAmount) || 0), 0);
    
    res.json({
      totalLeads,
      totalAmount
    });
  } catch (err) {
    console.error('Leads stats failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /leads/appointments - Fetch scheduled appointments
router.get('/appointments', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const appointmentsCollection = getCollection('appointments');
    const contactsCollection = getCollection('contacts');
    const usersCollection = getCollection('users');

    let query = { isDeleted: { $ne: true } };
    if (req.user.role === 'agent') {
      query.assignedTo = new ObjectId(req.user._id);
    } else if (req.user.role === 'tl') {
      const agents = await usersCollection.find({ tlId: new ObjectId(req.user._id) }).toArray();
      query.assignedTo = { $in: agents.map(a => a._id) };
    }

    const [appointments, contactAppts, allUsers] = await Promise.all([
      appointmentsCollection.find(query).toArray(),
      contactsCollection.find({ ...query, disposition: 'Appointment' }).toArray(),
      usersCollection.find({ role: { $in: ['agent', 'tl'] } }).toArray()
    ]);

    const userMap = allUsers.reduce((acc, u) => { acc[u._id.toString()] = u.name; return acc; }, {});

    // Map contactAppts to standard appointment schema
    const mappedContactAppts = contactAppts.map(c => ({
      _id: c._id,
      contactId: c._id,
      fields: c.fields,
      batchId: c.batchId,
      assignedTo: c.assignedTo,
      agentName: c.agentName || (c.assignedTo ? userMap[c.assignedTo.toString()] : 'Unassigned'),
      appointmentDt: c.appointmentDt,
      remarks: c.remarks || 'Scheduled',
      createdAt: c.createdAt || c.disposedAt || new Date(),
      lastModified: c.lastModified || new Date()
    }));

    // Deduplicate by contactId to prevent double listing
    const mergedMap = new Map();
    [...appointments, ...mappedContactAppts].forEach(app => {
      const cid = app.contactId ? app.contactId.toString() : app._id.toString();
      if (!mergedMap.has(cid) || new Date(app.createdAt) > new Date(mergedMap.get(cid).createdAt)) {
        mergedMap.set(cid, app);
      }
    });

    const result = Array.from(mergedMap.values()).sort((a, b) => new Date(a.appointmentDt) - new Date(b.appointmentDt));
    res.json(result);
  } catch (err) {
    console.error('Fetch appointments failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /leads/callbacks - Fetch scheduled callbacks
router.get('/callbacks', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const callbacksCollection = getCollection('callbacks');
    const contactsCollection = getCollection('contacts');
    const usersCollection = getCollection('users');

    let query = { isDeleted: { $ne: true } };
    if (req.user.role === 'agent') {
      query.assignedTo = new ObjectId(req.user._id);
    } else if (req.user.role === 'tl') {
      const agents = await usersCollection.find({ tlId: new ObjectId(req.user._id) }).toArray();
      query.assignedTo = { $in: agents.map(a => a._id) };
    }

    const [callbacks, contactCbs, allUsers] = await Promise.all([
      callbacksCollection.find(query).toArray(),
      contactsCollection.find({ ...query, disposition: 'CallBack' }).toArray(),
      usersCollection.find({ role: { $in: ['agent', 'tl'] } }).toArray()
    ]);

    const userMap = allUsers.reduce((acc, u) => { acc[u._id.toString()] = u.name; return acc; }, {});

    // Map contactCbs to standard callback schema
    const mappedContactCbs = contactCbs.map(c => ({
      _id: c._id,
      contactId: c._id,
      fields: c.fields,
      batchId: c.batchId,
      assignedTo: c.assignedTo,
      agentName: c.agentName || (c.assignedTo ? userMap[c.assignedTo.toString()] : 'Unassigned'),
      callBackDt: c.callBackDt,
      remarks: c.remarks || 'Scheduled Follow Up',
      disposition: c.disposition,
      status: c.status,
      leadAmount: c.leadAmount,
      source: c.source || (c.status === 'Call Back' || c.leadAmount > 0 ? 'lead' : undefined),
      createdAt: c.createdAt || c.disposedAt || new Date(),
      lastModified: c.lastModified || new Date()
    }));

    // Deduplicate by contactId to prevent double listing
    const mergedMap = new Map();
    [...callbacks, ...mappedContactCbs].forEach(cb => {
      const cid = cb.contactId ? cb.contactId.toString() : cb._id.toString();
      if (!mergedMap.has(cid) || new Date(cb.createdAt) > new Date(mergedMap.get(cid).createdAt)) {
        mergedMap.set(cid, cb);
      }
    });

    const result = Array.from(mergedMap.values()).sort((a, b) => new Date(a.callBackDt) - new Date(b.callBackDt));
    res.json(result);
  } catch (err) {
    console.error('Fetch callbacks failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
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

// POST /leads/appointments/bulk-delete - Bulk delete appointments
router.post('/appointments/bulk-delete', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !ids.length) return res.status(400).json({ error: 'No IDs provided' });
    const appointmentsCollection = getCollection('appointments');
    const query = { _id: { $in: ids.map(id => new ObjectId(id)) } };
    if (req.user.role === 'agent') query.assignedTo = new ObjectId(req.user._id);
    await appointmentsCollection.deleteMany(query);
    res.json({ success: true });
  } catch (err) {
    console.error('Bulk delete appointments failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
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

// POST /leads/callbacks/bulk-delete - Bulk delete callbacks
router.post('/callbacks/bulk-delete', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !ids.length) return res.status(400).json({ error: 'No IDs provided' });
    const callbacksCollection = getCollection('callbacks');
    const query = { _id: { $in: ids.map(id => new ObjectId(id)) } };
    if (req.user.role === 'agent') query.assignedTo = new ObjectId(req.user._id);
    await callbacksCollection.deleteMany(query);
    res.json({ success: true });
  } catch (err) {
    console.error('Bulk delete callbacks failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /leads/:id - Delete individual lead
router.delete('/:id', verify, authorize(['admin']), async (req, res) => {
  try {
    const leadsCollection = getCollection('leads');
    const contactsCollection = getCollection('contacts');
    
    const leadId = new ObjectId(req.params.id);
    
    // Check if it exists in leadsCollection
    const lead = await leadsCollection.findOne({ _id: leadId });
    if (lead) {
      await Promise.all([
        leadsCollection.deleteOne({ _id: leadId }),
        contactsCollection.updateOne({ _id: lead.contactId }, { $set: { isDeleted: true } })
      ]);
    } else {
      // It is a mapped contact lead where lead ID is the contact ID
      await Promise.all([
        leadsCollection.deleteMany({ contactId: leadId }),
        contactsCollection.updateOne({ _id: leadId }, { $set: { isDeleted: true } })
      ]);
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error('Delete lead error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /leads/:id - Update lead details/status
router.put('/:id', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const leadsCollection = getCollection('leads');
    const contactsCollection = getCollection('contacts');
    
    const leadId = new ObjectId(req.params.id);
    const updateData = { ...req.body, lastModified: new Date() };
    
    // Find the lead in leadsCollection
    const lead = await leadsCollection.findOne({ _id: leadId });
    
    // If status is changed to Call Back, remove from lead tracking and add to callbacks follow-up
    if (req.body.status === 'Call Back' || req.body.status === 'CallBack') {
      const contactId = lead ? (lead.contactId || leadId) : leadId;
      const leadObj = lead || await contactsCollection.findOne({ _id: leadId });
      if (!leadObj) return res.status(404).json({ error: 'Lead not found' });

      // 1. Delete from leadsCollection
      await leadsCollection.deleteOne({ _id: leadId });
      await leadsCollection.deleteMany({ contactId });

      // 2. Update contactsCollection
      const callBackDt = req.body.callBackDt ? new Date(req.body.callBackDt) : new Date();
      await contactsCollection.updateOne(
        { _id: contactId },
        {
          $set: {
            disposition: 'CallBack',
            status: 'Call Back',
            callBackDt: callBackDt,
            remarks: req.body.remarks || 'Status changed from Lead to Callback',
            lastModified: new Date()
          }
        }
      );

      // 3. Upsert into callbacksCollection
      const callbacksCollection = getCollection('callbacks');
      await callbacksCollection.deleteMany({ contactId });
      await callbacksCollection.insertOne({
        contactId,
        fields: leadObj.fields || {},
        batchId: leadObj.batchId,
        assignedTo: leadObj.assignedTo,
        agentName: leadObj.agentName || req.user.name,
        callBackDt: callBackDt,
        remarks: req.body.remarks || 'Status changed from Lead to Callback',
        status: 'Call Back',
        createdAt: new Date(),
        lastModified: new Date()
      });

      const phoneNum = leadObj.fields?.Phone || leadObj.fields?.phone || leadObj.fields?.Mobile;
      if (phoneNum) await consolidateCallbacks(phoneNum);

      broadcast('dashboard_update');
      broadcast('contacts_updated');
      return res.json({ success: true });
    }

    if (lead) {
      if (lead.status === 'Converted' && req.body.status && req.body.status !== 'Converted') {
        return res.status(400).json({ error: 'Cannot change status of a successfully converted lead' });
      }
      await Promise.all([
        leadsCollection.updateOne({ _id: leadId }, { $set: updateData }),
        contactsCollection.updateOne(
          { _id: lead.contactId },
          { 
            $set: { 
              status: req.body.status, 
              leadAmount: req.body.leadAmount ? parseFloat(req.body.leadAmount) : undefined,
              transactionId: req.body.transactionId,
              remarks: req.body.remarks,
              callBackDt: req.body.callBackDt ? new Date(req.body.callBackDt) : undefined,
              appointmentDt: req.body.appointmentDt ? new Date(req.body.appointmentDt) : undefined,
              lastModified: new Date()
            } 
          }
        )
      ]);
    } else {
      // It is a mapped contact lead where lead ID is the contact ID
      const contact = await contactsCollection.findOne({ _id: leadId });
      if (contact && contact.status === 'Converted' && req.body.status && req.body.status !== 'Converted') {
        return res.status(400).json({ error: 'Cannot change status of a successfully converted lead' });
      }
      await contactsCollection.updateOne(
        { _id: leadId },
        {
          $set: {
            status: req.body.status,
            leadAmount: req.body.leadAmount ? parseFloat(req.body.leadAmount) : undefined,
            transactionId: req.body.transactionId,
            remarks: req.body.remarks,
            callBackDt: req.body.callBackDt ? new Date(req.body.callBackDt) : undefined,
            appointmentDt: req.body.appointmentDt ? new Date(req.body.appointmentDt) : undefined,
            lastModified: new Date()
          }
        }
      );
      
      // Also update any matching lead document if it was created later
      await leadsCollection.updateOne(
        { contactId: leadId },
        { $set: updateData }
      );
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error('Update lead error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /leads/bulk-delete - Bulk delete leads
router.post('/bulk-delete', verify, authorize(['admin']), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !ids.length) return res.status(400).json({ error: 'No IDs provided' });
    
    const leadsCollection = getCollection('leads');
    const contactsCollection = getCollection('contacts');
    
    const objectIds = ids.map(id => new ObjectId(id));
    
    // Find matching leads to get contactIds
    const leads = await leadsCollection.find({ _id: { $in: objectIds } }).toArray();
    const leadContactIds = leads.map(l => l.contactId).filter(Boolean);
    
    await Promise.all([
      leadsCollection.deleteMany({ _id: { $in: objectIds } }),
      leadsCollection.deleteMany({ contactId: { $in: objectIds } }),
      contactsCollection.updateMany(
        { _id: { $in: [...objectIds, ...leadContactIds] } },
        { $set: { isDeleted: true } }
      )
    ]);
    
    res.json({ success: true });
  } catch (err) {
    console.error('Bulk delete leads error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/leads/history/:phone
router.get('/history/:phone', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const phoneParam = req.params.phone;
    if (!phoneParam) {
      return res.status(400).json({ error: 'Phone parameter is required' });
    }

    const leadsCollection = getCollection('leads');
    const contactsCollection = getCollection('contacts');
    const usersCollection = getCollection('users');

    const matchQuery = { isDeleted: { $ne: true } };
    if (req.user.role === 'agent') {
      matchQuery.assignedTo = new ObjectId(req.user._id);
    } else if (req.user.role === 'tl') {
      const agents = await usersCollection.find({ tlId: new ObjectId(req.user._id) }).toArray();
      matchQuery.assignedTo = { $in: agents.map(a => a._id) };
    }

    // Fetch matching data
    const [leads, contactLeads, allUsers] = await Promise.all([
      leadsCollection.find(matchQuery).toArray(),
      contactsCollection.find({ ...matchQuery, disposition: 'Lead' }).toArray(),
      usersCollection.find({ role: { $in: ['agent', 'tl'] } }).toArray()
    ]);

    const userMap = allUsers.reduce((acc, u) => { acc[u._id.toString()] = u.name; return acc; }, {});

    // Map contactLeads to match the lead schema, filtering out duplicates already in leadsCollection
    const leadContactIds = new Set(leads.map(l => l.contactId ? l.contactId.toString() : ''));
    const uniqueContactLeads = contactLeads.filter(c => !leadContactIds.has(c._id.toString()));

    const mappedContactLeads = uniqueContactLeads.map(c => ({
      _id: c._id,
      contactId: c._id,
      fields: c.fields,
      batchId: c.batchId,
      assignedTo: c.assignedTo,
      agentName: c.agentName || (c.assignedTo ? userMap[c.assignedTo.toString()] : 'Unassigned'),
      leadAmount: c.leadAmount || 0,
      status: c.status || 'Converted',
      remarks: c.remarks || 'Imported Lead',
      transactionId: c.transactionId || '',
      createdAt: c.createdAt || c.disposedAt || new Date(),
      lastModified: c.lastModified || new Date()
    }));

    const combined = [...leads, ...mappedContactLeads];

    const normalize = (phone) => {
      if (!phone) return 'N/A';
      const clean = String(phone).replace(/\D/g, '');
      return clean.length >= 10 ? clean.slice(-10) : clean || 'N/A';
    };

    const targetNormPhone = normalize(phoneParam);

    const history = combined.filter(lead => {
      const rawPhone = lead.fields?.Phone || lead.fields?.phone || lead.fields?.Mobile || 'N/A';
      return normalize(rawPhone) === targetNormPhone;
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json(history);
  } catch (err) {
    console.error('Fetch history failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
