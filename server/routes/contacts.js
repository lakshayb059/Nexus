const router = require('express').Router();
const { getCollection } = require('../mongodb');
const { authorize, verify } = require('../middleware/auth');
const { ObjectId } = require('mongodb');

// Helper: get contacts based on role
async function getAccessibleContacts(user, filters = {}) {
  let query = { ...filters };
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
    delete query.tlId; // Remove tlId from query as it's not a field in contacts
  }
  const contactsCollection = getCollection('contacts');
  return contactsCollection.find(query).sort({ queueOrder: 1, createdAt: 1 }).toArray();
}

// GET /contacts - list with filters
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
      contacts = contacts.filter(c =>
        Object.values(c.fields || {}).some(v => String(v).toLowerCase().includes(q))
      );
    }

    // Enrich with agent names
    const usersCollection = getCollection('users');
    const userCache = {};
    const enriched = await Promise.all(contacts.map(async c => {
      if (!userCache[c.assignedTo]) {
        userCache[c.assignedTo] = await usersCollection.findOne({ _id: c.assignedTo }, { projection: { password: 0 } });
      }
      return { ...c, agentName: userCache[c.assignedTo]?.name || 'Unknown' };
    }));

    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /contacts/queue - next item in agent queue (Enhanced)
router.get('/queue', verify, authorize(['agent']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    const now = new Date();
    
    // First check for callbacks that are due
    const dueCallbacks = await contactsCollection.find({
      assignedTo: new ObjectId(req.user._id),
      disposition: 'CallBack',
      callBackDt: { $lte: now },
      queueOrder: { $lt: 999999 }
    }).sort({ callBackDt: 1 }).limit(1).toArray();

    if (dueCallbacks.length > 0) {
      // Reset callback to queue for recall
      await contactsCollection.updateOne(
        { _id: dueCallbacks[0]._id },
        { $set: { queueOrder: 0, callBackDt: null } }
      );
      
      const total = await contactsCollection.countDocuments({ assignedTo: new ObjectId(req.user._id) });
      const disposed = await contactsCollection.countDocuments({ 
        assignedTo: new ObjectId(req.user._id), 
        disposition: { $nin: [null, 'CallNotAnswered'] } 
      });
      
      return res.json({ 
        contact: dueCallbacks[0], 
        remaining: 1, 
        total, 
        disposed,
        type: 'callback_due',
        message: 'Callback due - recalling now'
      });
    }

    let query = { 
      assignedTo: new ObjectId(req.user._id),
      queueOrder: { $lt: 999999 }
    };

    // If specific contact requested
    if (req.query.contactId) {
      query._id = new ObjectId(req.query.contactId);
    } else {
      // Prioritize fresh contacts (disposition null)
      // We'll search in two stages or use $sort with priority
    }

    const allPending = await contactsCollection.find(query).sort({ queueOrder: 1, createdAt: 1 }).toArray();
    
    // Split into fresh and rechurn
    const fresh = allPending.filter(c => c.disposition === null);
    const rechurn = allPending.filter(c => (c.disposition === 'CallNotAnswered' || c.disposition === 'HungUp') && (c.rechurnCount || 0) < 3);

    let contact = null;
    let type = 'fresh';
    let rechurnNum = 0;

    if (req.query.contactId) {
      contact = allPending[0];
    } else if (fresh.length > 0) {
      contact = fresh[0];
      type = 'fresh';
    } else if (rechurn.length > 0) {
      contact = rechurn[0];
      type = 'rechurn';
      rechurnNum = (contact.rechurnCount || 0) + 1;
    }

    const total = await contactsCollection.countDocuments({ assignedTo: new ObjectId(req.user._id) });
    const disposed = await contactsCollection.countDocuments({ 
      assignedTo: new ObjectId(req.user._id), 
      disposition: { $nin: [null, 'CallNotAnswered', 'HungUp'] } 
    });
    
    // Check for upcoming appointments
    const upcomingAppointments = await contactsCollection.find({
      assignedTo: new ObjectId(req.user._id),
      disposition: 'Appointment',
      appointmentDt: { 
        $gte: now,
        $lte: new Date(now.getTime() + 30 * 60 * 1000) // 30 minutes from now
      }
    }).sort({ appointmentDt: 1 }).limit(3).toArray();

    res.json({ 
      contact, 
      remaining: fresh.length + rechurn.length, 
      total, 
      disposed,
      upcomingAppointments,
      callbacksDue: dueCallbacks.length,
      type: contact ? (contact._id.equals(dueCallbacks[0]?._id) ? 'callback_due' : type) : null,
      rechurnNum
    });
  } catch (err) {
    console.error('Queue error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /contacts/stats - summary stats
router.get('/stats', verify, authorize(['admin', 'tl', 'agent']), async (req, res) => {
  try {
    const all = await getAccessibleContacts(req.user);
    const stats = {
      total: all.length,
      pending: all.filter(c => !c.disposition || c.disposition === 'CallNotAnswered').length,
      lead: all.filter(c => c.disposition === 'Lead').length,
      appointment: all.filter(c => c.disposition === 'Appointment').length,
      callNotAnswered: all.filter(c => c.disposition === 'CallNotAnswered').length,
      invalid: all.filter(c => c.disposition === 'Invalid').length,
      doNotCall: all.filter(c => c.disposition === 'DoNotCall').length,
      callBack: all.filter(c => c.disposition === 'CallBack').length,
      hungUp: all.filter(c => (c.disposition === 'HungUp' || c.disposition === 'CallNotAnswered') && c.queueOrder === 999999).length,
      totalLeadAmount: all.reduce((sum, c) => sum + (Number(c.leadAmount) || 0), 0)
    };
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /contacts/agent-queues - queue sizes per agent (admin/tl)
router.get('/agent-queues', verify, authorize(['admin', 'tl']), async (req, res) => {
  try {
    let agents;
    if (req.user.role === 'admin') {
      const usersCollection = getCollection('users');
      agents = await usersCollection.find({ role: 'agent' }, { projection: { password: 0 } }).toArray();
    } else {
      const usersCollection = getCollection('users');
      agents = await usersCollection.find({ role: 'agent', tlId: new ObjectId(req.user._id) }, { projection: { password: 0 } }).toArray();
    }
    const result = await Promise.all(agents.map(async ag => {
      const contactsCollection = getCollection('contacts');
      const usersCollection = getCollection('users');
      
      const total = await contactsCollection.countDocuments({ assignedTo: ag._id });
      const pending = await contactsCollection.countDocuments({ 
        assignedTo: ag._id, 
        disposition: { $in: [null, 'CallNotAnswered'] } 
      });
      const lead = await contactsCollection.countDocuments({ assignedTo: ag._id, disposition: 'Lead' });
      const appointment = await contactsCollection.countDocuments({ assignedTo: ag._id, disposition: 'Appointment' });
      
      let tlName = 'None';
      if (ag.tlId) {
        try {
          const tl = await usersCollection.findOne({ _id: new ObjectId(ag.tlId) });
          tlName = tl ? tl.name : 'Unknown';
        } catch (e) {
          tlName = 'Error';
        }
      }

      const totalLeadAmount = await contactsCollection.aggregate([
        { $match: { assignedTo: ag._id, disposition: 'Lead' } },
        { $group: { _id: null, total: { $sum: '$leadAmount' } } }
      ]).toArray();

      return { 
        agent: ag, 
        tlName, 
        total, 
        pending, 
        disposed: total - pending, 
        lead, 
        appointment,
        totalLeadAmount: totalLeadAmount[0]?.total || 0
      };
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /contacts/:id/dispose - set disposition (Enhanced)
router.post('/:id/dispose', verify, authorize(['agent']), async (req, res) => {
  try {
    const { disposition, remarks, appointmentDt, leadAmount, callBackDt, status, statusDetails } = req.body;
    const validDisps = ['Lead', 'Appointment', 'CallNotAnswered', 'Invalid', 'DoNotCall', 'CallBack', 'HungUp'];
    if (!validDisps.includes(disposition)) return res.status(400).json({ error: 'Invalid disposition' });

    const contactsCollection = getCollection('contacts');
    const contact = await contactsCollection.findOne({ _id: new ObjectId(req.params.id), assignedTo: new ObjectId(req.user._id) });
    if (!contact) return res.status(404).json({ error: 'Contact not found or not assigned to you' });

    const update = {
      disposition,
      remarks: remarks || '',
      lastModified: new Date(),
      disposedBy: new ObjectId(req.user._id),
      disposedAt: new Date()
    };

    // Enhanced Lead disposition handling
    if (disposition === 'Lead') {
      if (leadAmount === undefined || leadAmount === '' || leadAmount <= 0) {
        return res.status(400).json({ error: 'Valid lead amount is required for Lead disposition' });
      }

      // Check for duplicate lead by phone number
      const phoneFields = ['Phone', 'phone', 'Mobile', 'mobile', 'Contact', 'contact'];
      let contactPhone = null;
      for (const field of phoneFields) {
        if (contact.fields && contact.fields[field]) {
          contactPhone = contact.fields[field];
          break;
        }
      }

      if (contactPhone) {
        const duplicateQuery = {
          disposition: 'Lead',
          $or: phoneFields.map(f => ({ [`fields.${f}`]: contactPhone }))
        };
        const existingLead = await contactsCollection.findOne(duplicateQuery);
        if (existingLead && !existingLead._id.equals(contact._id)) {
          return res.status(400).json({ error: `A lead with the number ${contactPhone} already exists. Admin must delete it first.` });
        }
      }

      update.leadAmount = parseFloat(leadAmount);
      update.conversionDate = new Date();
      update.queueOrder = 999999; // Remove from active queue
      if (status) update.status = status;
      if (statusDetails) update.statusDetails = statusDetails;
    } else {
      update.leadAmount = null;
    }

    // Enhanced Appointment disposition handling
    if (disposition === 'Appointment') {
      if (!appointmentDt) return res.status(400).json({ error: 'Appointment date/time required' });
      const appointmentDate = new Date(appointmentDt);
      if (appointmentDate <= new Date()) {
        return res.status(400).json({ error: 'Appointment must be in the future' });
      }
      update.appointmentDt = appointmentDate;
      update.appointmentStatus = 'scheduled';
      update.queueOrder = 999999; // Remove from active queue
    } else {
      update.appointmentDt = null;
      update.appointmentStatus = null;
    }

    // Enhanced CallNotAnswered & HungUp handling
    if (disposition === 'CallNotAnswered' || disposition === 'HungUp') {
      const newRechurnCount = (contact.rechurnCount || 0) + 1;
      update.callAttempts = (contact.callAttempts || 0) + 1;
      update.rechurnCount = newRechurnCount;
      update.lastCallAttempt = new Date();

      if (newRechurnCount >= 3) {
        update.queueOrder = 999999; // Permanently remove from active queue
      } else {
        const maxOrderContact = await contactsCollection.find({ 
          assignedTo: new ObjectId(req.user._id),
          queueOrder: { $lt: 999999 }
        }).sort({ queueOrder: -1 }).limit(1).toArray();
        
        const newOrder = maxOrderContact.length > 0 ? (maxOrderContact[0].queueOrder + 1) : 0;
        update.queueOrder = newOrder;
      }
    }

    // Enhanced CallBack handling
    if (disposition === 'CallBack') {
      if (!callBackDt) return res.status(400).json({ error: 'Callback date/time required' });
      const callBackDate = new Date(callBackDt);
      if (callBackDate <= new Date()) {
        return res.status(400).json({ error: 'Callback must be in the future' });
      }
      update.callBackDt = callBackDate;
      update.queueOrder = 999999; // Remove from active queue until callback time
    } else {
      update.callBackDt = null;
    }

    // Handle Invalid and DoNotCall - remove from queue
    if (disposition === 'Invalid' || disposition === 'DoNotCall') {
      update.queueOrder = 999999;
      if (disposition === 'DoNotCall') {
        update.doNotCallFlag = true;
        update.doNotCallDate = new Date();
      }
    }

    await contactsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: update }
    );
    
    const io = req.app.get('io');
    if (io) {
      // Enhanced socket events
      io.emit('contact_disposed', {
        contactId: req.params.id,
        disposition,
        agentId: req.user._id,
        agentName: req.user.name,
        leadAmount: update.leadAmount,
        timestamp: new Date()
      });
      
      // Update dashboard stats
      io.emit('dashboard_update', { type: 'disposition', data: update });
    }

    res.json({ 
      success: true, 
      message: `${disposition} recorded successfully`,
      nextContactAvailable: disposition !== 'CallNotAnswered'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /contacts/:id/status - update lead status (agent/tl/admin)
router.put('/:id/status', verify, authorize(['agent', 'tl', 'admin']), async (req, res) => {
  try {
    const { status, statusDetails, callBackDt } = req.body;
    const contactsCollection = getCollection('contacts');
    
    let query = { _id: new ObjectId(req.params.id) };
    if (req.user.role === 'agent') {
      query.assignedTo = new ObjectId(req.user._id);
    }
    
    const update = { 
      status, 
      statusDetails: statusDetails || '',
      lastModified: new Date().toISOString()
    };
    
    if (status === 'Call Back' && callBackDt) {
      update.callBackDt = new Date(callBackDt);
    }
    
    const result = await contactsCollection.updateOne(query, { $set: update });
    if (result.matchedCount === 0) return res.status(404).json({ error: 'Contact not found or access denied' });
    
    const io = req.app.get('io');
    if (io) io.emit('contacts_updated', { contactId: req.params.id, status });

    res.json({ success: true });
  } catch (err) {
    console.error('Status update error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /contacts/:id - update (admin)
router.put('/:id', verify, authorize(['admin', 'tl']), async (req, res) => {
  try {
    const { assignedTo, disposition, remarks, appointmentDt } = req.body;
    const contactsCollection = getCollection('contacts');
    const usersCollection = getCollection('users');

    // Security check for TL
    if (req.user.role === 'tl') {
      const contact = await contactsCollection.findOne({ _id: new ObjectId(req.params.id) });
      if (!contact || !new ObjectId(contact.assignedTo).equals(new ObjectId(req.user._id))) {
        return res.status(403).json({ error: 'You can only reassign contacts currently assigned to you' });
      }
      if (assignedTo) {
        const targetAgent = await usersCollection.findOne({ _id: new ObjectId(assignedTo), tlId: new ObjectId(req.user._id) });
        if (!targetAgent) return res.status(403).json({ error: 'You can only assign to agents in your team' });
      }
    }

    const update = { lastModified: new Date().toISOString() };
    if (assignedTo !== undefined) update.assignedTo = new ObjectId(assignedTo);
    if (disposition !== undefined) update.disposition = disposition;
    if (remarks !== undefined) update.remarks = remarks;
    if (appointmentDt !== undefined) update.appointmentDt = appointmentDt;
    
    await contactsCollection.updateOne({ _id: new ObjectId(req.params.id) }, { $set: update });
    
    const io = req.app.get('io');
    if (io) {
      io.emit('contacts_updated', { contactId: req.params.id });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /contacts/:id (admin)
router.delete('/:id', verify, authorize(['admin']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    await contactsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    
    const io = req.app.get('io');
    if (io) io.emit('contacts_updated', { deletedId: req.params.id });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /contacts/batch/:batchId (admin)
router.delete('/batch/:batchId', verify, authorize(['admin']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    const result = await contactsCollection.deleteMany({ batchId: req.params.batchId });
    const batchesCollection = getCollection('batches');
    await batchesCollection.deleteOne({ _id: req.params.batchId });
    
    const io = req.app.get('io');
    if (io) io.emit('contacts_updated', { batchDeleted: true });

    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    console.error('Batch Delete Error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// POST /contacts/bulk-delete (admin)
router.post('/bulk-delete', verify, authorize(['admin']), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'IDs array required' });
    
    const contactsCollection = getCollection('contacts');
    const objectIds = ids.map(id => new ObjectId(id));
    const result = await contactsCollection.deleteMany({ _id: { $in: objectIds } });
    
    const io = req.app.get('io');
    if (io) io.emit('contacts_updated', { bulkDeleted: true });

    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /contacts/batch/:batchId/handover (TL)
router.put('/batch/:batchId/handover', verify, authorize(['tl']), async (req, res) => {
  try {
    const { agentId } = req.body;
    if (!agentId) return res.status(400).json({ error: 'Target Agent ID required' });
    
    const contactsCollection = getCollection('contacts');
    const usersCollection = getCollection('users');
    const batchesCollection = getCollection('batches');

    // Verify target agent belongs to this TL
    const agent = await usersCollection.findOne({ _id: new ObjectId(agentId), tlId: new ObjectId(req.user._id) });
    if (!agent) return res.status(403).json({ error: 'Agent must be in your team' });

    // Verify batch is currently assigned to this TL
    const batch = await batchesCollection.findOne({ _id: req.params.batchId });
    if (!batch || !new ObjectId(batch.agentId).equals(new ObjectId(req.user._id))) {
      return res.status(403).json({ error: 'You can only handover batches assigned to you' });
    }

    // Update all contacts in batch
    await contactsCollection.updateMany(
      { batchId: req.params.batchId },
      { $set: { assignedTo: new ObjectId(agentId), lastModified: new Date().toISOString() } }
    );

    // Update batch record
    await batchesCollection.updateOne(
      { _id: req.params.batchId },
      { $set: { agentId: new ObjectId(agentId), agentName: agent.name } }
    );

    const io = req.app.get('io');
    if (io) io.emit('contacts_updated', { batchId: req.params.batchId });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /contacts/:id/requeue - move contact back to active workflow (Agent)
router.post('/:id/requeue', verify, authorize(['agent']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    const contact = await contactsCollection.findOne({ _id: new ObjectId(req.params.id), assignedTo: new ObjectId(req.user._id) });
    
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found or not assigned to you' });
    }

    const update = {
      disposition: null,
      appointmentDt: null,
      appointmentStatus: null,
      callBackDt: null,
      queueOrder: 0, // Put it at the front of the queue
      lastModified: new Date()
    };

    await contactsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: update }
    );

    const io = req.app.get('io');
    if (io) {
      io.emit('contacts_updated', { contactId: req.params.id, action: 'requeue' });
    }

    res.json({ success: true, message: 'Contact added back to workflow queue' });
  } catch (err) {
    console.error('Requeue Error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
