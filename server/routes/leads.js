const router = require('express').Router();
const { prisma } = require('../shared/db');
const { authorize, verify } = require('../shared/authMiddleware');
const { consolidateCallbacks } = require('../shared/callbackUtils');
const { broadcast } = require('../shared/notificationClient');
const { triggerConversionEmail } = require('../shared/triggerConversionEmail');
const { resolveUserNamesForRecords } = require('../shared/userResolver');
const axios = require('axios');

function buildSqlWhere(whereQuery, params = []) {
  const clauses = [];
  
  for (const [key, value] of Object.entries(whereQuery)) {
    if (value === undefined) continue;

    let colName = key;
    if (key === 'isDeleted') colName = 'is_deleted';
    else if (key === 'assignedTo') colName = 'assigned_to';
    else if (key === 'adminId') colName = 'admin_id';
    else if (key === 'batchId') colName = 'batch_id';
    else if (key === 'disposition') colName = 'disposition';
    else if (key === 'status') colName = 'status';

    if (value === null) {
      clauses.push(`${colName} IS NULL`);
    } else if (typeof value === 'object' && value !== null) {
      if (value.in) {
        if (value.in.length === 0) {
          clauses.push('1 = 0');
        } else {
          const placeHolders = value.in.map(v => {
            params.push(v);
            return `$${params.length}`;
          }).join(', ');
          clauses.push(`${colName} IN (${placeHolders})`);
        }
      } else if (value.not !== undefined) {
        if (value.not === null) {
          clauses.push(`${colName} IS NOT NULL`);
        } else {
          params.push(value.not);
          clauses.push(`${colName} <> $${params.length}`);
        }
      }
    } else {
      params.push(value);
      clauses.push(`${colName} = $${params.length}`);
    }
  }

  return {
    clause: clauses.length > 0 ? clauses.join(' AND ') : '1 = 1',
    params
  };
}

router.get('/my-leads', verify, authorize(['superadmin', 'agent', 'tl', 'admin']), async (req, res) => {
  try {
    const { search, source, status, page, limit, convertedFrom, convertedTo } = req.query;
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

    if (convertedFrom && convertedTo) {
      const cStart = new Date(convertedFrom);
      const cEnd = new Date(new Date(convertedTo).setHours(23, 59, 59, 999));
      whereQuery.conversionDate = {
        gte: cStart,
        lte: cEnd
      };
    } else if (convertedFrom) {
      whereQuery.conversionDate = {
        gte: new Date(convertedFrom)
      };
    } else if (convertedTo) {
      whereQuery.conversionDate = {
        lte: new Date(new Date(convertedTo).setHours(23, 59, 59, 999))
      };
    }

    let leads = [];
    let contactLeads = [];

    if (search && search.trim()) {
      const q = search.trim();

      // Query leads
      const leadSqlParams = [];
      const { clause: leadBaseClause, params: leadParams } = buildSqlWhere(whereQuery, leadSqlParams);
      leadParams.push(`%${q}%`);
      const leadSearchIdx = leadParams.length;
      const leadIdsResult = await prisma.$queryRawUnsafe(
        `SELECT _id as id FROM leads WHERE ${leadBaseClause} AND (remarks ILIKE $${leadSearchIdx} OR agent_name ILIKE $${leadSearchIdx} OR fields::text ILIKE $${leadSearchIdx})`,
        ...leadParams
      );
      const leadIds = leadIdsResult.map(item => item.id);

      // Query contactLeads
      const contactSqlParams = [];
      const contactWhere = { ...whereQuery, disposition: 'Lead', isDeleted: false };
      const { clause: contactBaseClause, params: contactParams } = buildSqlWhere(contactWhere, contactSqlParams);
      contactParams.push(`%${q}%`);
      const contactSearchIdx = contactParams.length;
      const contactIdsResult = await prisma.$queryRawUnsafe(
        `SELECT _id as id FROM contacts WHERE ${contactBaseClause} AND (remarks ILIKE $${contactSearchIdx} OR agent_name ILIKE $${contactSearchIdx} OR fields::text ILIKE $${contactSearchIdx})`,
        ...contactParams
      );
      const contactIds = contactIdsResult.map(item => item.id);

      [leads, contactLeads] = await Promise.all([
        leadIds.length > 0 ? prisma.lead.findMany({ where: { id: { in: leadIds } } }) : [],
        contactIds.length > 0 ? prisma.contact.findMany({ where: { id: { in: contactIds } } }) : []
      ]);
    } else {
      [leads, contactLeads] = await Promise.all([
        prisma.lead.findMany({ where: whereQuery, take: 500 }),
        prisma.contact.findMany({ where: { ...whereQuery, disposition: 'Lead', isDeleted: false }, take: 500 })
      ]);
    }

    const leadContactIds = leads.map(l => l.contactId).filter(Boolean);
    const relatedContacts = await prisma.contact.findMany({
      where: { id: { in: leadContactIds } },
      select: { id: true, callBackDt: true }
    });

    const contactMap = relatedContacts.reduce((acc, c) => {
      acc[c.id] = c.callBackDt;
      return acc;
    }, {});

    const userMap = await resolveUserNamesForRecords([...leads, ...contactLeads]);
    const leadContactIdsSet = new Set(leads.map(l => l.contactId));
    const uniqueContactLeads = contactLeads.filter(c => !leadContactIdsSet.has(c.id));

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
        transactionId: c.transactionId,
        utrCharity: c.utrCharity,
        charityAmount: c.charityAmount,
        isCharityConfirmed: !!c.isCharityConfirmed,
        charityConfirmedAt: c.charityConfirmedAt,
        charityConfirmedBy: c.charityConfirmedBy,
        conversionDate: c.conversionDate,
        status: c.status || 'Converted',
        remarks: c.remarks || 'Imported Lead',
        createdAt: c.createdAt,
        lastModified: c.lastModified,
        callBackDt: c.callBackDt
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
        callBackDt: l.contactId ? contactMap[l.contactId] : null,
        isCharityConfirmed: !!l.isCharityConfirmed,
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
        groupedMap.set(normPhone, { totalAmount: 0, leadsCount: 0, historyStatuses: [] });
      }
      const group = groupedMap.get(normPhone);
      const leadEffAmount = (lead.isCharityConfirmed && lead.charityAmount !== null && lead.charityAmount !== undefined)
        ? (parseFloat(lead.charityAmount) || 0)
        : (parseFloat(lead.leadAmount) || 0);
      group.totalAmount += leadEffAmount;
      group.leadsCount += 1;
      group.historyStatuses.push(lead.status || 'Converted');

      // Prioritize non-converted leads as the representative (they need attention)
      const groupIsConverted = group.status === 'Converted';
      const leadIsConverted = lead.status === 'Converted';
      const shouldReplace = 
        !group.id ||
        (groupIsConverted && !leadIsConverted) || // non-converted takes priority over converted
        (groupIsConverted === leadIsConverted && new Date(lead.createdAt) > new Date(group.createdAt)); // same category: use newest

      if (shouldReplace) {
        const currentAmount = group.totalAmount;
        const currentCount = group.leadsCount;
        const currentHistory = group.historyStatuses;
        Object.assign(group, lead);
        group.totalAmount = currentAmount;
        group.leadsCount = currentCount;
        group.historyStatuses = currentHistory;
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

    const [convertedLeads, convertedContacts, allLeadsArr, allContactsArr] = await Promise.all([
      prisma.lead.findMany({
        where: { ...whereQuery, status: 'Converted' },
        select: { leadAmount: true, charityAmount: true, isCharityConfirmed: true },
        take: 10000
      }),
      prisma.contact.findMany({
        where: { ...whereQuery, disposition: 'Lead', status: 'Converted', isDeleted: false },
        select: { leadAmount: true, charityAmount: true, isCharityConfirmed: true },
        take: 10000
      }),
      prisma.lead.findMany({
        where: whereQuery,
        select: { leadAmount: true, charityAmount: true, isCharityConfirmed: true },
        take: 10000
      }),
      prisma.contact.findMany({
        where: { ...whereQuery, disposition: 'Lead', isDeleted: false },
        select: { leadAmount: true, charityAmount: true, isCharityConfirmed: true },
        take: 10000
      })
    ]);

    const getEffAmount = item => (item.isCharityConfirmed && item.charityAmount !== null && item.charityAmount !== undefined)
      ? (parseFloat(item.charityAmount) || 0)
      : (parseFloat(item.leadAmount) || 0);

    const totalLeads = convertedLeads.length + convertedContacts.length;
    const totalAmount = convertedLeads.reduce((sum, l) => sum + getEffAmount(l), 0) +
                        convertedContacts.reduce((sum, c) => sum + getEffAmount(c), 0);
    const allLeadsCount = allLeadsArr.length + allContactsArr.length;
    const allLeadsAmount = allLeadsArr.reduce((sum, l) => sum + getEffAmount(l), 0) +
                           allContactsArr.reduce((sum, c) => sum + getEffAmount(c), 0);

    res.json({ totalLeads, totalAmount, allLeads: allLeadsCount, allLeadsAmount });
  } catch (err) {
    console.error('Leads stats failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

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

    let appointments = [];
    let contactAppts = [];

    if (search && search.trim()) {
      const q = search.trim();

      // Query appointments
      const apptSqlParams = [];
      const { clause: apptBaseClause, params: apptParams } = buildSqlWhere(whereQuery, apptSqlParams);
      apptParams.push(`%${q}%`);
      const apptSearchIdx = apptParams.length;
      const apptIdsResult = await prisma.$queryRawUnsafe(
        `SELECT _id as id FROM appointments WHERE ${apptBaseClause} AND (remarks ILIKE $${apptSearchIdx} OR agent_name ILIKE $${apptSearchIdx} OR fields::text ILIKE $${apptSearchIdx})`,
        ...apptParams
      );
      const apptIds = apptIdsResult.map(item => item.id);

      // Query contactAppts
      const contactSqlParams = [];
      const contactWhere = { ...contactsWhereQuery, disposition: 'Appointment' };
      const { clause: contactBaseClause, params: contactParams } = buildSqlWhere(contactWhere, contactSqlParams);
      contactParams.push(`%${q}%`);
      const contactSearchIdx = contactParams.length;
      const contactIdsResult = await prisma.$queryRawUnsafe(
        `SELECT _id as id FROM contacts WHERE ${contactBaseClause} AND (remarks ILIKE $${contactSearchIdx} OR agent_name ILIKE $${contactSearchIdx} OR fields::text ILIKE $${contactSearchIdx})`,
        ...contactParams
      );
      const contactIds = contactIdsResult.map(item => item.id);

      [appointments, contactAppts] = await Promise.all([
        apptIds.length > 0 ? prisma.appointment.findMany({ where: { id: { in: apptIds } } }) : [],
        contactIds.length > 0 ? prisma.contact.findMany({ where: { id: { in: contactIds } } }) : []
      ]);
    } else {
      [appointments, contactAppts] = await Promise.all([
        prisma.appointment.findMany({ where: whereQuery, take: 500 }),
        prisma.contact.findMany({ where: { ...contactsWhereQuery, disposition: 'Appointment' }, take: 500 })
      ]);
    }

    const userMapRaw = await resolveUserNamesForRecords([...appointments, ...contactAppts]);
    const userMap = {};
    Object.keys(userMapRaw).forEach(k => {
      userMap[k] = userMapRaw[k].name;
    });

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

    let callbacks = [];
    let contactCbs = [];

    if (search && search.trim()) {
      const q = search.trim();

      // Query callbacks
      const cbSqlParams = [];
      const { clause: cbBaseClause, params: cbParams } = buildSqlWhere(whereQuery, cbSqlParams);
      cbParams.push(`%${q}%`);
      const cbSearchIdx = cbParams.length;
      const cbIdsResult = await prisma.$queryRawUnsafe(
        `SELECT _id as id FROM callbacks WHERE ${cbBaseClause} AND (remarks ILIKE $${cbSearchIdx} OR agent_name ILIKE $${cbSearchIdx} OR fields::text ILIKE $${cbSearchIdx})`,
        ...cbParams
      );
      const cbIds = cbIdsResult.map(item => item.id);

      // Query contactCbs
      const contactSqlParams = [];
      const contactWhere = { ...contactsWhereQuery, disposition: 'CallBack' };
      const { clause: contactBaseClause, params: contactParams } = buildSqlWhere(contactWhere, contactSqlParams);
      contactParams.push(`%${q}%`);
      const contactSearchIdx = contactParams.length;
      const contactIdsResult = await prisma.$queryRawUnsafe(
        `SELECT _id as id FROM contacts WHERE ${contactBaseClause} AND (remarks ILIKE $${contactSearchIdx} OR agent_name ILIKE $${contactSearchIdx} OR fields::text ILIKE $${contactSearchIdx})`,
        ...contactParams
      );
      const contactIds = contactIdsResult.map(item => item.id);

      [callbacks, contactCbs] = await Promise.all([
        cbIds.length > 0 ? prisma.callback.findMany({ where: { id: { in: cbIds } } }) : [],
        contactIds.length > 0 ? prisma.contact.findMany({ where: { id: { in: contactIds } } }) : []
      ]);
    } else {
      [callbacks, contactCbs] = await Promise.all([
        prisma.callback.findMany({ where: whereQuery, take: 500 }),
        prisma.contact.findMany({ where: { ...contactsWhereQuery, disposition: 'CallBack' }, take: 500 })
      ]);
    }

    const userMapRaw = await resolveUserNamesForRecords([...callbacks, ...contactCbs]);
    const userMap = {};
    Object.keys(userMapRaw).forEach(k => {
      userMap[k] = userMapRaw[k].name;
    });

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
    if (req.body.utrCharity !== undefined) updateData.utrCharity = req.body.utrCharity;
    if (req.body.charityAmount !== undefined) updateData.charityAmount = parseFloat(req.body.charityAmount) || 0;
    if (req.body.isCharityConfirmed !== undefined) updateData.isCharityConfirmed = Boolean(req.body.isCharityConfirmed);
    if (req.body.status === 'Converted') updateData.conversionDate = new Date();
    
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    
    if (req.body.status === 'Call Back' || req.body.status === 'CallBack') {
      const contactId = lead ? (lead.contactId || leadId) : leadId;
      const leadObj = lead || await prisma.contact.findUnique({ where: { id: leadId } });
      if (!leadObj) return res.status(404).json({ error: 'Lead not found' });

      // Update the Lead record(s) to 'Call Back' status rather than deleting them
      await prisma.lead.updateMany({
        where: {
          OR: [
            { id: leadId },
            { contactId }
          ]
        },
        data: {
          status: 'Call Back',
          remarks: req.body.remarks || leadObj.remarks || 'Status changed from Lead to Callback',
          lastModified: new Date()
        }
      });

      const callBackDt = req.body.callBackDt ? new Date(req.body.callBackDt) : new Date();
      await prisma.contact.update({
        where: { id: contactId },
        data: {
          disposition: 'Lead', status: 'Call Back', callBackDt, cbReminderSent: false,
          remarks: req.body.remarks ? (leadObj.remarks ? `${leadObj.remarks} | ${req.body.remarks}` : req.body.remarks) : 'Status changed from Lead to Callback',
        }
      });

      await prisma.callback.deleteMany({ where: { contactId } });

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
      if (req.body.transactionId !== undefined) contactUpdate.transactionId = req.body.transactionId;
      if (req.body.utrCharity !== undefined) contactUpdate.utrCharity = req.body.utrCharity;
      if (req.body.charityAmount !== undefined) contactUpdate.charityAmount = parseFloat(req.body.charityAmount) || 0;
      if (req.body.isCharityConfirmed !== undefined) contactUpdate.isCharityConfirmed = Boolean(req.body.isCharityConfirmed);
      if (req.body.status === 'Converted') contactUpdate.conversionDate = new Date();

      await Promise.all([
        prisma.lead.update({ where: { id: leadId }, data: updateData }),
        prisma.contact.update({ where: { id: lead.contactId }, data: contactUpdate })
      ]);
      
      if (req.body.status === 'Converted' && lead.status !== 'Converted') {
        triggerConversionEmail(lead.contactId, req.body.receiptImage).then(emailResult => {
            broadcast('email_status', {
                agentId: req.user._id || req.user.id,
                success: emailResult.success,
                reason: emailResult.reason
            });
        }).catch(err => {
            broadcast('email_status', {
                agentId: req.user._id || req.user.id,
                success: false,
                reason: err.message
            });
        });
      }
      res.json({ success: true });
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
      if (req.body.transactionId !== undefined) contactUpdate.transactionId = req.body.transactionId;
      if (req.body.utrCharity !== undefined) contactUpdate.utrCharity = req.body.utrCharity;
      if (req.body.charityAmount !== undefined) contactUpdate.charityAmount = parseFloat(req.body.charityAmount) || 0;
      if (req.body.isCharityConfirmed !== undefined) contactUpdate.isCharityConfirmed = Boolean(req.body.isCharityConfirmed);
      if (req.body.status === 'Converted') contactUpdate.conversionDate = new Date();

      await prisma.contact.update({ where: { id: leadId }, data: contactUpdate });
      await prisma.lead.updateMany({ where: { contactId: leadId }, data: updateData });

      if (req.body.status === 'Converted' && (!contact || contact.status !== 'Converted')) {
        triggerConversionEmail(leadId, req.body.receiptImage).then(emailResult => {
            broadcast('email_status', {
                agentId: req.user._id || req.user.id,
                success: emailResult.success,
                reason: emailResult.reason
            });
        }).catch(err => {
            broadcast('email_status', {
                agentId: req.user._id || req.user.id,
                success: false,
                reason: err.message
            });
        });
      }
      res.json({ success: true });
    }
  } catch (err) {
    console.error('Update lead error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id/confirm-charity', verify, authorize(['superadmin', 'admin', 'tl', 'agent']), async (req, res) => {
  try {
    const leadId = req.params.id;
    const { utrCharity, charityAmount } = req.body;

    if (!utrCharity || charityAmount === undefined || charityAmount === null || charityAmount === '') {
      return res.status(400).json({ error: 'Both UTR-Charity and Charity Amount are required' });
    }

    const numAmount = parseFloat(charityAmount);
    if (isNaN(numAmount) || numAmount < 0) {
      return res.status(400).json({ error: 'Please provide a valid Charity Amount' });
    }

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    const contactId = lead ? (lead.contactId || leadId) : leadId;
    const now = new Date();
    const confirmedBy = req.user.name || req.user.username || 'Agent';

    const charityData = {
      utrCharity: String(utrCharity).trim(),
      charityAmount: numAmount,
      isCharityConfirmed: true,
      charityConfirmedAt: now,
      charityConfirmedBy: confirmedBy
    };

    // Update Contact
    await prisma.contact.update({
      where: { id: contactId },
      data: charityData
    }).catch(e => console.warn('Charity confirm contact update note:', e.message));

    // Update Lead(s)
    await prisma.lead.updateMany({
      where: {
        OR: [
          { id: leadId },
          { contactId }
        ]
      },
      data: charityData
    }).catch(e => console.warn('Charity confirm lead update note:', e.message));

    broadcast('dashboard_update');
    broadcast('contacts_updated');

    res.json({
      success: true,
      message: 'Lead confirmed by charity successfully',
      data: charityData
    });
  } catch (err) {
    console.error('Confirm charity error:', err);
    res.status(500).json({ error: 'Failed to confirm lead by charity' });
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

    const [leads, contactLeads] = await Promise.all([
      prisma.lead.findMany({ where: { ...whereQuery, isDeleted: undefined }, take: 200 }),
      prisma.contact.findMany({ where: { ...whereQuery, disposition: 'Lead' }, take: 200 })
    ]);

    const userMapRaw = await resolveUserNamesForRecords([...leads, ...contactLeads]);
    const userMap = {};
    Object.keys(userMapRaw).forEach(k => {
      userMap[k] = userMapRaw[k].name;
    });
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
      if (transactionId) newContactData.transactionId = transactionId;
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
          remarks: newContact.remarks,
          transactionId: transactionId || null
        }
      });

      // Do not create a callback record for leads to prevent adding them to callbacks page or back to workflow queue

      if (finalStatus === 'Converted') {
        triggerConversionEmail(newContactId, req.body.receiptImage).then(emailResult => {
            broadcast('email_status', {
                agentId: req.user._id || req.user.id,
                success: emailResult.success,
                reason: emailResult.reason
            });
        }).catch(err => {
            broadcast('email_status', {
                agentId: req.user._id || req.user.id,
                success: false,
                reason: err.message
            });
        });
      }
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
    if (!apiKey) {
      console.error('[Vision OCR] Extract transaction failed: GROQ_API_KEY is not configured.');
      return res.status(400).json({ 
        error: 'GROQ_API_KEY is not configured in your monolithic server settings.' 
      });
    }

    const models = [
      'qwen/qwen3.8-27b',
      'qwen/qwen3.6-27b'
    ];

    let response = null;
    let lastError = null;

    for (const model of models) {
      try {
        console.log(`[Vision OCR] Attempting extraction with model: ${model}`);
        response = await axios.post(
          'https://api.groq.com/openai/v1/chat/completions',
          {
            model: model,
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
            },
            timeout: 15000
          }
        );
        console.log(`[Vision OCR] Success using model: ${model}`);
        break;
      } catch (err) {
        lastError = err;
        const errDetails = err.response?.data?.error?.message || err.response?.data || err.message;
        console.warn(`[Vision OCR] Model ${model} failed:`, errDetails);
        if (err.response?.status === 401) {
          break;
        }
      }
    }

    if (!response) {
      const details = lastError.response?.data?.error?.message || lastError.response?.data || lastError.message;
      return res.status(500).json({ 
        error: `Groq API call failed. Details: ${JSON.stringify(details)}`
      });
    }

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
    const errDetails = err.response?.data?.error?.message || err.response?.data || err.message;
    console.error('Extract transaction failed:', errDetails);
    res.status(500).json({ error: `Failed to extract transaction ID: ${errDetails}` });
  }
});

router.post('/create', verify, authorize(['superadmin', 'admin', 'tl', 'agent']), async (req, res) => {
  try {
    const { name, phone, email, leadAmount, status, remarks, transactionId, createdAt } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and Phone are required' });
    }

    const creatorId = req.user._id || req.user.id;
    const role = req.user.role;
    
    // Determine the adminId (company)
    let adminId = null;
    if (role === 'agent' || role === 'tl') {
      adminId = req.user.adminId;
    } else if (role === 'admin') {
      adminId = creatorId;
    }
    
    // Determine assignedTo and agentName
    let assignedTo = creatorId;
    let agentName = req.user.name || req.user.username;
    
    // If a TL or Admin wants to assign it to a specific agent:
    if ((role === 'tl' || role === 'admin' || role === 'superadmin') && req.body.assignedTo) {
      assignedTo = req.body.assignedTo;
      const assignedUser = await prisma.user.findUnique({ where: { id: assignedTo } });
      if (assignedUser) {
        agentName = assignedUser.name || assignedUser.username;
        if (!adminId && assignedUser.adminId) {
          adminId = assignedUser.adminId;
        }
      }
    }

    const leadDate = createdAt ? new Date(createdAt) : new Date();

    // Create the Contact
    const contactData = {
      fields: {
        Name: name,
        Phone: phone,
        Email: email || '',
        manuallyCreated: true,
        createdByName: req.user.name || req.user.username
      },
      assignedTo,
      agentName,
      adminId,
      disposition: 'Lead',
      status: status || 'Pending',
      leadAmount: parseFloat(leadAmount) || 0,
      transactionId: transactionId || null,
      remarks: remarks || '',
      isDeleted: false,
      createdAt: leadDate,
      queueOrder: 999999
    };

    if (status === 'Converted') {
      contactData.conversionDate = leadDate;
    } else if (status === 'Call Back' || status === 'CallBack') {
      contactData.callBackDt = req.body.callBackDt ? new Date(req.body.callBackDt) : leadDate;
    }

    const contact = await prisma.contact.create({ data: contactData });

    // Create the Lead
    const newLead = await prisma.lead.create({
      data: {
        contactId: contact.id,
        fields: contact.fields,
        assignedTo,
        agentName,
        adminId,
        leadAmount: parseFloat(leadAmount) || 0,
        status: status || 'Pending',
        remarks: remarks || '',
        transactionId: transactionId || null,
        createdAt: leadDate
      }
    });

    // If status is Call Back, create a Callback record
    if (status === 'Call Back' || status === 'CallBack') {
      const callBackDt = req.body.callBackDt ? new Date(req.body.callBackDt) : leadDate;
      await prisma.callback.create({
        data: {
          contactId: contact.id,
          fields: contact.fields,
          assignedTo,
          agentName,
          callBackDt,
          remarks: remarks || '',
          adminId,
          source: 'lead'
        }
      });
      
      const { consolidateCallbacks } = require('../shared/callbackUtils');
      if (phone) await consolidateCallbacks(phone);
    }

    // Trigger Conversion Email if Converted
    if (status === 'Converted') {
      triggerConversionEmail(contact.id, req.body.receiptImage).then(emailResult => {
          broadcast('email_status', {
              agentId: creatorId,
              success: emailResult.success,
              reason: emailResult.reason
          });
      }).catch(err => {
          broadcast('email_status', {
              agentId: creatorId,
              success: false,
              reason: err.message
          });
      });
    }

    broadcast('dashboard_update');
    broadcast('contacts_updated');

    // DUPLICATE CHECK:
    // "check for the duplicate lead in the database for the respective company for the same contact on the same date and time and with the same transaction id"
    const normalize = (ph) => {
      if (!ph) return 'N/A';
      const clean = String(ph).replace(/\D/g, '');
      return clean.length >= 10 ? clean.slice(-10) : clean || 'N/A';
    };

    const targetPhoneNorm = normalize(phone);
    
    // Find potential duplicates under the same company (adminId)
    // and with the same transactionId.
    const potentialDuplicates = await prisma.lead.findMany({
      where: {
        id: { not: newLead.id }, // Exclude the new lead
        adminId: adminId || undefined,
        transactionId: transactionId ? transactionId : undefined
      }
    });

    const duplicates = potentialDuplicates.filter(l => {
      const fields = l.fields || {};
      const lPhone = fields.Phone || fields.phone || fields.Mobile;
      if (normalize(lPhone) !== targetPhoneNorm) return false;

      // Same date and time check (minute-precision)
      const d1 = new Date(l.createdAt);
      const d2 = new Date(newLead.createdAt);

      return (
        d1.getFullYear() === d2.getFullYear() &&
        d1.getMonth() === d2.getMonth() &&
        d1.getDate() === d2.getDate() &&
        d1.getHours() === d2.getHours() &&
        d1.getMinutes() === d2.getMinutes()
      );
    });

    const isDuplicate = duplicates.length > 0;

    res.json({
      success: true,
      lead: newLead,
      duplicateFound: isDuplicate,
      duplicates: duplicates.map(d => ({
        id: d.id,
        agentName: d.agentName,
        createdAt: d.createdAt,
        leadAmount: d.leadAmount,
        status: d.status
      }))
    });

  } catch (err) {
    console.error('Create lead failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
