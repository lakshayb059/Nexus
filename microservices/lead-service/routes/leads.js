const router = require('express').Router();
const { prisma } = require('../../shared/db');
const { authorize, verify } = require('../../shared/authMiddleware');
const { consolidateCallbacks } = require('../../shared/callbackUtils');
const { broadcast } = require('../../shared/notificationClient');
const { triggerConversionEmail } = require('../../shared/triggerConversionEmail');
const axios = require('axios');

// GET /api/leads/my-leads
router.get('/my-leads', verify, authorize(['superadmin', 'agent', 'tl', 'admin']), async (req, res) => {
  try {
    const { search, source, status, page, limit } = req.query;
    let whereQuery = {};
    if (req.user.role === 'agent') {
      whereQuery.assignedTo = req.user._id || req.user.id;
    } else if (req.user.role === 'tl') {
      const agents = await prisma.user.findMany({ where: { tlId: req.user._id || req.user.id } });
      whereQuery.assignedTo = { in: agents.map(a => a.id) };
    } else if (req.user.role === 'admin') {
      whereQuery.adminId = req.user._id || req.user.id;
    }

    if (source === 'created') whereQuery.batchId = null;
    else if (source === 'uploaded') whereQuery.batchId = { not: null };

    if (status && status !== 'all') whereQuery.status = status;

    const [leads, contactLeads, allUsers] = await Promise.all([
      prisma.lead.findMany({ where: whereQuery }),
      prisma.contact.findMany({ where: { ...whereQuery, disposition: 'Lead', isDeleted: false } }),
      prisma.user.findMany({})
    ]);

    const userMap = allUsers.reduce((acc, u) => { acc[u.id] = u; return acc; }, {});
    const leadContactIds = new Set(leads.map(l => l.contactId));
    const uniqueContactLeads = contactLeads.filter(c => !leadContactIds.has(c.id));

    const mappedContactLeads = uniqueContactLeads.map(c => {
      const agent = c.assignedTo ? userMap[c.assignedTo] : null;
      const tl = agent?.tlId ? userMap[agent.tlId] : null;
      const admin = agent?.adminId ? userMap[agent.adminId] : (c.adminId ? userMap[c.adminId] : null);

      return {
        _id: c.id,
        contactId: c.id,
        fields: c.fields,
        batchId: c.batchId,
        assignedTo: c.assignedTo,
        agentName: agent ? agent.name : 'Unassigned',
        tlName: tl ? tl.name : 'N/A',
        adminName: admin ? admin.name : 'N/A',
        leadAmount: c.leadAmount || 0,
        status: c.status || 'Converted',
        remarks: c.remarks || 'Imported Lead',
        createdAt: c.createdAt,
        lastModified: c.lastModified
      };
    });

    const combinedLeads = [...leads.map(l => {
      const agent = l.assignedTo ? userMap[l.assignedTo] : null;
      const tl = agent?.tlId ? userMap[agent.tlId] : null;
      const admin = agent?.adminId ? userMap[agent.adminId] : (l.adminId ? userMap[l.adminId] : null);

      return {
        ...l, 
        _id: l.id,
        agentName: agent ? agent.name : 'Unassigned',
        tlName: tl ? tl.name : 'N/A',
        adminName: admin ? admin.name : 'N/A',
      };
    }), ...mappedContactLeads];
    const groupedMap = new Map();

    const normalize = (phone) => {
      if (!phone) return 'N/A';
      const clean = String(phone).replace(/\D/g, '');
      return clean.length >= 10 ? clean.slice(-10) : clean || 'N/A';
    };

    combinedLeads.forEach(lead => {
      const fields = lead.fields || {};
      const rawPhone = fields.Phone || fields.phone || fields.Mobile || 'N/A';
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

    let result = Array.from(groupedMap.values()).sort((a, b) => 
      new Date(b.lastModified || b.createdAt) - new Date(a.lastModified || a.createdAt)
    );

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(l => {
        const match = Object.values(l.fields || {}).some(v => String(v).toLowerCase().includes(q)) ||
          (l.agentName && l.agentName.toLowerCase().includes(q));
        return match;
      });
    }

    if (page) {
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 50;
      const total = result.length;
      const paginatedResult = result.slice((pageNum - 1) * limitNum, pageNum * limitNum);
      return res.json({ leads: paginatedResult, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) });
    }

    res.json(result);
  } catch (err) {
    console.error('Fetch leads failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/leads/stats
router.get('/stats', verify, authorize(['superadmin', 'agent', 'tl', 'admin']), async (req, res) => {
  try {
    let whereQuery = {};
    if (req.user.role === 'agent') {
      whereQuery.assignedTo = req.user._id || req.user.id;
    } else if (req.user.role === 'tl') {
      const agents = await prisma.user.findMany({ where: { tlId: req.user._id || req.user.id } });
      whereQuery.assignedTo = { in: agents.map(a => a.id) };
    } else if (req.user.role === 'admin') {
      whereQuery.adminId = req.user._id || req.user.id;
    }

    const [leads, contactLeads, allLeadsArr, allContactLeads] = await Promise.all([
      prisma.lead.findMany({ where: { ...whereQuery, status: 'Converted' } }),
      prisma.contact.findMany({ where: { ...whereQuery, disposition: 'Lead', status: 'Converted', isDeleted: false } }),
      prisma.lead.findMany({ where: { ...whereQuery } }),
      prisma.contact.findMany({ where: { ...whereQuery, disposition: 'Lead', isDeleted: false } })
    ]);
    
    // Converted Leads
    const leadContactIds = new Set(leads.map(l => l.contactId));
    const uniqueContactLeads = contactLeads.filter(c => !leadContactIds.has(c.id));
    
    const totalLeads = leads.length + uniqueContactLeads.length;
    const totalAmount = leads.reduce((sum, l) => sum + (parseFloat(l.leadAmount) || 0), 0) +
                        uniqueContactLeads.reduce((sum, c) => sum + (parseFloat(c.leadAmount) || 0), 0);
                        
    // All Leads
    const allLeadContactIds = new Set(allLeadsArr.map(l => l.contactId));
    const uniqueAllContactLeads = allContactLeads.filter(c => !allLeadContactIds.has(c.id));
    
    const allLeadsCount = allLeadsArr.length + uniqueAllContactLeads.length;
    const allLeadsAmount = allLeadsArr.reduce((sum, l) => sum + (parseFloat(l.leadAmount) || 0), 0) +
                           uniqueAllContactLeads.reduce((sum, c) => sum + (parseFloat(c.leadAmount) || 0), 0);
    
    res.json({ totalLeads, totalAmount, allLeads: allLeadsCount, allLeadsAmount });
  } catch (err) {
    console.error('Leads stats failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /leads/appointments
router.get('/appointments', verify, authorize(['superadmin', 'agent', 'tl', 'admin']), async (req, res) => {
  try {
    const { search, page, limit } = req.query;
    let whereQuery = {};
    let contactsWhereQuery = { isDeleted: false };
    if (req.user.role === 'agent') {
      whereQuery.assignedTo = req.user._id || req.user.id;
      contactsWhereQuery.assignedTo = req.user._id || req.user.id;
    } else if (req.user.role === 'tl') {
      const agents = await prisma.user.findMany({ where: { tlId: req.user._id || req.user.id } });
      const ids = agents.map(a => a.id);
      whereQuery.assignedTo = { in: ids };
      contactsWhereQuery.assignedTo = { in: ids };
    } else if (req.user.role === 'admin') {
      whereQuery.adminId = req.user._id || req.user.id;
      contactsWhereQuery.adminId = req.user._id || req.user.id;
    }

    const [appointments, contactAppts, allUsers] = await Promise.all([
      prisma.appointment.findMany({ where: whereQuery }),
      prisma.contact.findMany({ where: { ...contactsWhereQuery, disposition: 'Appointment' } }),
      prisma.user.findMany({ where: { role: { in: ['agent', 'tl'] } } })
    ]);

    const userMap = allUsers.reduce((acc, u) => { acc[u.id] = u.name; return acc; }, {});

    const mappedContactAppts = contactAppts.map(c => ({
      _id: c.id, contactId: c.id, fields: c.fields, batchId: c.batchId,
      assignedTo: c.assignedTo, agentName: c.assignedTo ? userMap[c.assignedTo] || 'Unassigned' : 'Unassigned',
      appointmentDt: c.appointmentDt, remarks: c.remarks || 'Scheduled',
      createdAt: c.createdAt || c.disposedAt || new Date(), lastModified: c.lastModified || new Date()
    }));

    const mergedMap = new Map();
    [...appointments.map(a => ({ ...a, _id: a.id })), ...mappedContactAppts].forEach(app => {
      const cid = app.contactId ? app.contactId : app._id;
      if (!mergedMap.has(cid) || new Date(app.createdAt) > new Date(mergedMap.get(cid).createdAt)) {
        mergedMap.set(cid, app);
      }
    });

    let result = Array.from(mergedMap.values()).sort((a, b) => new Date(a.appointmentDt) - new Date(b.appointmentDt));

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(a => {
        const match = Object.values(a.fields || {}).some(v => String(v).toLowerCase().includes(q)) ||
          (a.agentName && a.agentName.toLowerCase().includes(q));
        return match;
      });
    }

    if (page) {
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 50;
      const total = result.length;
      const paginatedResult = result.slice((pageNum - 1) * limitNum, pageNum * limitNum);
      return res.json({ appointments: paginatedResult, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) });
    }

    res.json(result);
  } catch (err) {
    console.error('Fetch appointments failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /leads/callbacks
router.get('/callbacks', verify, authorize(['superadmin', 'agent', 'tl', 'admin']), async (req, res) => {
  try {
    const { search, page, limit } = req.query;
    let whereQuery = {};
    let contactsWhereQuery = { isDeleted: false };
    if (req.user.role === 'agent') {
      whereQuery.assignedTo = req.user._id || req.user.id;
      contactsWhereQuery.assignedTo = req.user._id || req.user.id;
    } else if (req.user.role === 'tl') {
      const agents = await prisma.user.findMany({ where: { tlId: req.user._id || req.user.id } });
      const ids = agents.map(a => a.id);
      whereQuery.assignedTo = { in: ids };
      contactsWhereQuery.assignedTo = { in: ids };
    } else if (req.user.role === 'admin') {
      whereQuery.adminId = req.user._id || req.user.id;
      contactsWhereQuery.adminId = req.user._id || req.user.id;
    }

    const [callbacks, contactCbs, allUsers] = await Promise.all([
      prisma.callback.findMany({ where: whereQuery }),
      prisma.contact.findMany({ where: { ...contactsWhereQuery, disposition: 'CallBack' } }),
      prisma.user.findMany({ where: { role: { in: ['agent', 'tl'] } } })
    ]);

    const userMap = allUsers.reduce((acc, u) => { acc[u.id] = u.name; return acc; }, {});

    const mappedCallbacks = callbacks.map(c => ({
      ...c, _id: c.id,
      source: c.source || (c.status === 'Call Back' || c.status === 'CallBack' ? 'lead' : 'workflow')
    }));

    const mappedContactCbs = contactCbs.map(c => ({
      _id: c.id, contactId: c.id, fields: c.fields, batchId: c.batchId,
      assignedTo: c.assignedTo, agentName: c.assignedTo ? userMap[c.assignedTo] || 'Unassigned' : 'Unassigned',
      callBackDt: c.callBackDt, remarks: c.remarks || 'Scheduled Follow Up',
      disposition: c.disposition, status: c.status, leadAmount: c.leadAmount,
      source: c.source || (c.status === 'Call Back' || c.status === 'CallBack' || c.leadAmount > 0 ? 'lead' : 'workflow'),
      createdAt: c.createdAt || c.disposedAt || new Date(), lastModified: c.lastModified || new Date()
    }));

    const mergedMap = new Map();
    [...mappedCallbacks, ...mappedContactCbs].forEach(cb => {
      const cid = cb.contactId ? cb.contactId : cb._id;
      if (!mergedMap.has(cid) || new Date(cb.createdAt) > new Date(mergedMap.get(cid).createdAt)) {
        mergedMap.set(cid, cb);
      }
    });

    let result = Array.from(mergedMap.values()).sort((a, b) => new Date(a.callBackDt) - new Date(b.callBackDt));

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(c => {
        const match = Object.values(c.fields || {}).some(v => String(v).toLowerCase().includes(q)) ||
          (c.agentName && c.agentName.toLowerCase().includes(q));
        return match;
      });
    }

    if (page) {
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 50;
      const total = result.length;
      const paginatedResult = result.slice((pageNum - 1) * limitNum, pageNum * limitNum);
      return res.json({ callbacks: paginatedResult, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) });
    }

    res.json(result);
  } catch (err) {
    console.error('Fetch callbacks failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/appointments/wipe', verify, authorize(['superadmin']), async (req, res) => {
  try {
    await prisma.appointment.deleteMany({});
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/appointments/:id', verify, authorize(['superadmin', 'agent', 'tl', 'admin']), async (req, res) => {
  try {
    const query = { id: req.params.id };
    if (req.user.role === 'agent') query.assignedTo = req.user._id || req.user.id;
    await prisma.appointment.deleteMany({ where: query });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/appointments/bulk-delete', verify, authorize(['superadmin', 'agent', 'tl', 'admin']), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !ids.length) return res.status(400).json({ error: 'No IDs provided' });
    const query = { id: { in: ids } };
    if (req.user.role === 'agent') query.assignedTo = req.user._id || req.user.id;
    await prisma.appointment.deleteMany({ where: query });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/callbacks/wipe', verify, authorize(['superadmin']), async (req, res) => {
  try {
    await prisma.callback.deleteMany({});
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/callbacks/:id', verify, authorize(['superadmin', 'agent', 'tl', 'admin']), async (req, res) => {
  try {
    const query = { id: req.params.id };
    if (req.user.role === 'agent') query.assignedTo = req.user._id || req.user.id;
    await prisma.callback.deleteMany({ where: query });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/callbacks/bulk-delete', verify, authorize(['superadmin', 'agent', 'tl', 'admin']), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !ids.length) return res.status(400).json({ error: 'No IDs provided' });
    const query = { id: { in: ids } };
    if (req.user.role === 'agent') query.assignedTo = req.user._id || req.user.id;
    await prisma.callback.deleteMany({ where: query });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/wipe', verify, authorize(['superadmin']), async (req, res) => {
  try {
    await prisma.lead.deleteMany({});
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/:id', verify, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const leadId = req.params.id;
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (lead) {
      await Promise.all([
        prisma.lead.delete({ where: { id: leadId } }),
        prisma.contact.update({ where: { id: lead.contactId }, data: { isDeleted: true } })
      ]);
    } else {
      await Promise.all([
        prisma.lead.deleteMany({ where: { contactId: leadId } }),
        prisma.contact.update({ where: { id: leadId }, data: { isDeleted: true } })
      ]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Delete lead error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', verify, authorize(['superadmin', 'agent', 'tl', 'admin']), async (req, res) => {
  try {
    const leadId = req.params.id;
    const updateData = {};
    if (req.body.status !== undefined) updateData.status = req.body.status;
    if (req.body.leadAmount !== undefined) updateData.leadAmount = parseFloat(req.body.leadAmount) || 0;
    if (req.body.remarks !== undefined) updateData.remarks = req.body.remarks;
    if (req.body.assignedTo !== undefined) updateData.assignedTo = req.body.assignedTo;
    if (req.body.agentName !== undefined) updateData.agentName = req.body.agentName;
    if (req.body.fields !== undefined) updateData.fields = req.body.fields;
    if (req.body.transactionId !== undefined) updateData.transactionId = req.body.transactionId;
    
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    
    if (req.body.status === 'Call Back' || req.body.status === 'CallBack') {
      const contactId = lead ? (lead.contactId || leadId) : leadId;
      const leadObj = lead || await prisma.contact.findUnique({ where: { id: leadId } });
      if (!leadObj) return res.status(404).json({ error: 'Lead not found' });

      await prisma.lead.deleteMany({ where: { id: leadId } });
      await prisma.lead.deleteMany({ where: { contactId } });

      const callBackDt = req.body.callBackDt ? new Date(req.body.callBackDt) : new Date();
      await prisma.contact.update({
        where: { id: contactId },
        data: {
          disposition: 'CallBack', status: 'Call Back', callBackDt,
          remarks: req.body.remarks || 'Status changed from Lead to Callback',
        }
      });

      await prisma.callback.deleteMany({ where: { contactId } });
      await prisma.callback.create({
        data: {
          contactId, fields: leadObj.fields || {}, batchId: leadObj.batchId,
          assignedTo: leadObj.assignedTo, agentName: leadObj.agentName || req.user.name,
          callBackDt, remarks: req.body.remarks || 'Status changed from Lead to Callback', source: 'lead'
        }
      });

      const fields = leadObj.fields || {};
      const phoneNum = fields.Phone || fields.phone || fields.Mobile;
      if (phoneNum) await consolidateCallbacks(phoneNum);

      broadcast('dashboard_update');
      broadcast('contacts_updated');
      return res.json({ success: true });
    }

    if (lead) {
      if (lead.status === 'Converted' && req.body.status && req.body.status !== 'Converted') {
        return res.status(400).json({ error: 'Cannot change status of a successfully converted lead' });
      }
      
      const contactUpdate = {};
      if (req.body.status) contactUpdate.status = req.body.status;
      if (req.body.leadAmount) contactUpdate.leadAmount = parseFloat(req.body.leadAmount);
      if (req.body.remarks !== undefined) contactUpdate.remarks = req.body.remarks;
      if (req.body.callBackDt) contactUpdate.callBackDt = new Date(req.body.callBackDt);
      if (req.body.appointmentDt) contactUpdate.appointmentDt = new Date(req.body.appointmentDt);

      await Promise.all([
        prisma.lead.update({ where: { id: leadId }, data: updateData }),
        prisma.contact.update({ where: { id: lead.contactId }, data: contactUpdate })
      ]);
      
      if (req.body.status === 'Converted' && lead.status !== 'Converted') {
        triggerConversionEmail(lead.contactId, req.body.receiptImage);
      }
    } else {
      const contact = await prisma.contact.findUnique({ where: { id: leadId } });
      if (contact && contact.status === 'Converted' && req.body.status && req.body.status !== 'Converted') {
        return res.status(400).json({ error: 'Cannot change status of a successfully converted lead' });
      }

      const contactUpdate = {};
      if (req.body.status) contactUpdate.status = req.body.status;
      if (req.body.leadAmount) contactUpdate.leadAmount = parseFloat(req.body.leadAmount);
      if (req.body.remarks !== undefined) contactUpdate.remarks = req.body.remarks;
      if (req.body.callBackDt) contactUpdate.callBackDt = new Date(req.body.callBackDt);
      if (req.body.appointmentDt) contactUpdate.appointmentDt = new Date(req.body.appointmentDt);

      await prisma.contact.update({ where: { id: leadId }, data: contactUpdate });
      await prisma.lead.updateMany({ where: { contactId: leadId }, data: updateData });

      if (req.body.status === 'Converted' && (!contact || contact.status !== 'Converted')) {
        triggerConversionEmail(leadId, req.body.receiptImage);
      }
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error('Update lead error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/bulk-delete', verify, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !ids.length) return res.status(400).json({ error: 'No IDs provided' });
    
    const leads = await prisma.lead.findMany({ where: { id: { in: ids } } });
    const leadContactIds = leads.map(l => l.contactId).filter(Boolean);
    
    await Promise.all([
      prisma.lead.deleteMany({ where: { id: { in: ids } } }),
      prisma.lead.deleteMany({ where: { contactId: { in: ids } } }),
      prisma.contact.updateMany({
        where: { id: { in: [...ids, ...leadContactIds] } },
        data: { isDeleted: true }
      })
    ]);
    
    res.json({ success: true });
  } catch (err) {
    console.error('Bulk delete leads error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/history/:phone', verify, authorize(['superadmin', 'agent', 'tl', 'admin']), async (req, res) => {
  try {
    const phoneParam = req.params.phone;
    if (!phoneParam) return res.status(400).json({ error: 'Phone parameter is required' });

    let whereQuery = { isDeleted: false };
    if (req.user.role === 'agent') {
      whereQuery.assignedTo = req.user._id || req.user.id;
    } else if (req.user.role === 'tl') {
      const agents = await prisma.user.findMany({ where: { tlId: req.user._id || req.user.id } });
      whereQuery.assignedTo = { in: agents.map(a => a.id) };
    } else if (req.user.role === 'admin') {
      whereQuery.adminId = req.user._id || req.user.id;
    }

    const [leads, contactLeads, allUsers] = await Promise.all([
      prisma.lead.findMany({ where: { ...whereQuery, isDeleted: undefined } }), // isDeleted is on Contact, not Lead model
      prisma.contact.findMany({ where: { ...whereQuery, disposition: 'Lead' } }),
      prisma.user.findMany({ where: { role: { in: ['agent', 'tl'] } } })
    ]);

    const userMap = allUsers.reduce((acc, u) => { acc[u.id] = u.name; return acc; }, {});
    const leadContactIds = new Set(leads.map(l => l.contactId));
    const uniqueContactLeads = contactLeads.filter(c => !leadContactIds.has(c.id));

    const mappedContactLeads = uniqueContactLeads.map(c => ({
      _id: c.id, contactId: c.id, fields: c.fields, batchId: c.batchId,
      assignedTo: c.assignedTo, agentName: c.assignedTo ? userMap[c.assignedTo] || 'Unassigned' : 'Unassigned',
      leadAmount: c.leadAmount || 0, status: c.status || 'Converted',
      remarks: c.remarks || 'Imported Lead',
      createdAt: c.createdAt || c.disposedAt || new Date(),
      lastModified: c.lastModified || new Date()
    }));

    const combined = [...leads.map(l => ({ ...l, _id: l.id })), ...mappedContactLeads];

    const normalize = (phone) => {
      if (!phone) return 'N/A';
      const clean = String(phone).replace(/\D/g, '');
      return clean.length >= 10 ? clean.slice(-10) : clean || 'N/A';
    };

    const targetNormPhone = normalize(phoneParam);

    const history = combined.filter(lead => {
      const fields = lead.fields || {};
      const rawPhone = fields.Phone || fields.phone || fields.Mobile || 'N/A';
      return normalize(rawPhone) === targetNormPhone;
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json(history);
  } catch (err) {
    console.error('Fetch history failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/clone-and-dispose', verify, authorize(['superadmin', 'agent', 'tl', 'admin']), async (req, res) => {
  try {
    const leadId = req.params.id;
    let contact = await prisma.contact.findUnique({ where: { id: leadId } });
    
    if (!contact) {
      const lead = await prisma.lead.findUnique({ where: { id: leadId } });
      if (lead && lead.contactId) {
        contact = await prisma.contact.findUnique({ where: { id: lead.contactId } });
      }
    }
    
    if (!contact) return res.status(404).json({ error: 'Original contact not found' });

    const { action, status, remarks, leadAmount, transactionId, statusDetails, callBackDt } = req.body;
    let disposition = 'Lead';
    let finalStatus = status || '';

    if (action === 'Followup') { disposition = 'CallBack'; finalStatus = 'Call Back'; } 
    else if (action === 'Not Interested') { disposition = 'Lead'; finalStatus = 'Not Interested'; }

    const dateStr = new Date().toLocaleString('en-US', {
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true
    });
    const updaterName = req.user.name || req.user.username || 'Agent';
    const actionLabel = finalStatus || disposition;
    const formattedRemarks = `[${actionLabel} by ${updaterName} on ${dateStr}]: ${remarks || ''}`;

    const newContactData = {
      fields: contact.fields || {}, batchId: contact.batchId,
      assignedTo: req.user._id || req.user.id, adminId: contact.adminId,
      disposition, status: finalStatus, remarks: formattedRemarks,
      disposedBy: req.user._id || req.user.id, disposedAt: new Date(),
      queueOrder: 999999
    };

    if (disposition === 'Lead') {
      newContactData.leadAmount = parseFloat(leadAmount) || 0;
      newContactData.conversionDate = new Date();
      if (callBackDt) newContactData.callBackDt = new Date(callBackDt);
    } else if (disposition === 'CallBack') {
      newContactData.callBackDt = callBackDt ? new Date(callBackDt) : null;
    }

    const newContact = await prisma.contact.create({ data: newContactData });
    const newContactId = newContact.id;

    if (disposition === 'Lead') {
      await prisma.lead.create({
        data: {
          contactId: newContactId, adminId: req.user.role === 'admin' ? (req.user._id || req.user.id) : (req.user.adminId || null),
          fields: newContact.fields || {}, batchId: newContact.batchId,
          assignedTo: newContact.assignedTo, agentName: newContact.agentName,
          leadAmount: newContact.leadAmount || 0, status: newContact.status,
          remarks: newContact.remarks
        }
      });
    } else if (disposition === 'CallBack') {
      await prisma.callback.create({
        data: {
          contactId: newContactId, adminId: req.user.role === 'admin' ? (req.user._id || req.user.id) : (req.user.adminId || null),
          fields: newContact.fields || {}, batchId: newContact.batchId,
          assignedTo: newContact.assignedTo, agentName: newContact.agentName,
          callBackDt: newContact.callBackDt, remarks: newContact.remarks, source: 'lead'
        }
      });
      const fields = newContact.fields || {};
      const phoneNum = fields.Phone || fields.phone || fields.Mobile;
      if (phoneNum) await consolidateCallbacks(phoneNum);
    }

    broadcast('contact_disposed', { contactId: newContactId, disposition, agentName: req.user.name });
    broadcast('dashboard_update');
    broadcast('contacts_updated');

    res.json({ success: true, contactId: newContactId });
  } catch (err) {
    console.error('Clone and dispose failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/extract-transaction', verify, authorize(['superadmin', 'admin', 'tl', 'agent']), async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'No image provided' });

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Groq API key not configured' });

    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Extract the transaction ID (or UTR number) and the payment amount from this screenshot. Return a JSON object strictly in this format: {"transactionId": "<id>", "amount": <number>}. If no transaction ID is found, return {"transactionId": "NOT_FOUND", "amount": null}. Do not return anything except the raw JSON object without markdown formatting.'
              },
              {
                type: 'image_url',
                image_url: { url: imageBase64 }
              }
            ]
          }
        ],
        temperature: 0.1
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const extractedText = response.data.choices[0]?.message?.content?.trim() || '{}';
    let parsedData = { transactionId: 'NOT_FOUND', amount: null };
    try {
      parsedData = JSON.parse(extractedText.replace(/```json/g, '').replace(/```/g, '').trim());
    } catch (e) {
      console.error('Failed to parse Groq response:', extractedText);
    }
    
    if (parsedData.transactionId === 'NOT_FOUND' || !parsedData.transactionId) {
      return res.json({ success: false, error: 'No transaction ID found in image' });
    }

    res.json({ success: true, transactionId: parsedData.transactionId, amount: parsedData.amount });
  } catch (err) {
    console.error('Extract transaction failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to extract transaction ID' });
  }
});

module.exports = router;
