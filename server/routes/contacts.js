const router = require('express').Router();
const { prisma } = require('../shared/db');
const { authorize, verify } = require('../shared/authMiddleware');
const { resolveUserNamesForRecords } = require('../shared/userResolver');
const { consolidateCallbacks, cleanupAllCallbacks, normalizePhone } = require('../shared/callbackUtils');
const { broadcast } = require('../shared/notificationClient');
const { triggerConversionEmail } = require('../shared/triggerConversionEmail');

async function getAccessibleContactsQuery(user, filters = {}, includeDeleted = false) {
  let where = { ...filters };
  if (!includeDeleted && user?.role !== 'superadmin') where.isDeleted = false;

  if (!user || !user.role) {
    where.id = 'non-existent-id-prevent-access';
    return where;
  }

  if (user.role === 'agent') {
    where.assignedTo = user._id || user.id;
  } else if (user.role === 'tl') {
    const agents = await prisma.user.findMany({ where: { role: 'agent', tlId: user._id || user.id } });
    where.assignedTo = { in: agents.map(a => a.id) };
  } else if (user.role === 'admin') {
    where.adminId = user._id || user.id;
    if (filters.tlId) {
      const agents = await prisma.user.findMany({ where: { role: 'agent', tlId: filters.tlId } });
      where.assignedTo = { in: agents.map(a => a.id) };
      delete where.tlId;
    }
  }
  return where;
}

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

router.get('/', verify, authorize(['superadmin', 'admin', 'tl', 'agent']), async (req, res) => {
  try {
    const { disposition, agentId, tlId, search, batchId, page, limit } = req.query;

    let isPhoneSearchInvalid = false;
    if (search && search.trim()) {
      const q = search.trim();
      const isPhoneLike = /^[0-9\s+\-()]+$/.test(q);
      const digitCount = (q.match(/\d/g) || []).length;
      if (isPhoneLike && digitCount > 0 && digitCount < 5) {
        isPhoneSearchInvalid = true;
      }
    }

    // Restrict agents from viewing all contacts directly without search term or with invalid short phone search
    if (req.user.role === 'agent' && (!disposition || disposition === 'all') && (!search || !search.trim() || isPhoneSearchInvalid)) {
      if (page) {
        return res.json({
          contacts: [],
          total: 0,
          page: parseInt(page) || 1,
          limit: parseInt(limit) || 50,
          pages: 0,
          totalLeadValue: 0
        });
      } else {
        return res.json([]);
      }
    }
    const filters = {};
    if (disposition === 'pending') filters.disposition = null;
    else if (disposition) filters.disposition = disposition;
    if (batchId) filters.batchId = batchId;

    if (req.user.role !== 'agent' && agentId) {
      filters.assignedTo = agentId;
    }
    if (req.user.role === 'admin' && tlId) filters.tlId = tlId;
    
    let whereQuery = await getAccessibleContactsQuery(req.user, filters);

    if (search && search.trim()) {
      const q = search.trim();
      const sqlParams = [];
      const { clause: baseClause, params } = buildSqlWhere(whereQuery, sqlParams);
      
      params.push(`%${q}%`);
      const searchParamIdx = params.length;
      
      const whereClause = `${baseClause} AND (
        remarks ILIKE $${searchParamIdx} 
        OR agent_name ILIKE $${searchParamIdx} 
        OR fields::text ILIKE $${searchParamIdx}
      )`;

      // Count total matches
      const countSql = `SELECT COUNT(*)::int as count FROM contacts WHERE ${whereClause}`;
      const countResult = await prisma.$queryRawUnsafe(countSql, ...params);
      const total = countResult[0]?.count || 0;

      let contacts = [];
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 50;
      const skipNum = (pageNum - 1) * limitNum;

      if (page) {
        const queryParams = [...params];
        queryParams.push(limitNum);
        const limitParamIdx = queryParams.length;
        queryParams.push(skipNum);
        const offsetParamIdx = queryParams.length;

        const selectSql = `
          SELECT _id as id FROM contacts 
          WHERE ${whereClause} 
          ORDER BY created_at DESC 
          LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
        `;
        const idsResult = await prisma.$queryRawUnsafe(selectSql, ...queryParams);
        const ids = idsResult.map(item => item.id);

        if (ids.length > 0) {
          contacts = await prisma.contact.findMany({
            where: { id: { in: ids } },
            orderBy: { createdAt: 'desc' }
          });
        }
      } else {
        const selectSql = `
          SELECT _id as id FROM contacts 
          WHERE ${whereClause} 
          ORDER BY created_at DESC
          LIMIT 500
        `;
        const idsResult = await prisma.$queryRawUnsafe(selectSql, ...params);
        const ids = idsResult.map(item => item.id);

        if (ids.length > 0) {
          contacts = await prisma.contact.findMany({
            where: { id: { in: ids } },
            orderBy: { createdAt: 'desc' }
          });
        }
      }

      const userMap = await resolveUserNamesForRecords(contacts);
      
      contacts = contacts.map(c => {
        const agent = c.assignedTo ? userMap[c.assignedTo] : null;
        const tl = agent?.tlId ? userMap[agent.tlId] : null;
        const admin = agent?.adminId ? userMap[agent.adminId] : (c.adminId ? userMap[c.adminId] : null);
        
        return {
          ...c, _id: c.id,
          agentName: agent ? agent.name : 'Unassigned',
          tlName: tl ? tl.name : 'N/A',
          adminName: admin ? admin.name : 'N/A'
        };
      });

      if (page) {
        let totalLeadValue = 0;
        if (disposition === 'Lead') {
          const sumSql = `SELECT SUM(lead_amount)::float as sum FROM contacts WHERE ${whereClause}`;
          const sumResult = await prisma.$queryRawUnsafe(sumSql, ...params);
          totalLeadValue = sumResult[0]?.sum || 0;
        }

        return res.json({ 
          contacts, 
          total, 
          page: pageNum, 
          limit: limitNum, 
          pages: Math.ceil(total / limitNum), 
          totalLeadValue 
        });
      } else {
        return res.json(contacts);
      }
    }

    if (page) {
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 50;
      const skipNum = (pageNum - 1) * limitNum;

      const [total, contactsRaw] = await Promise.all([
        prisma.contact.count({ where: whereQuery }),
        prisma.contact.findMany({
          where: whereQuery,
          orderBy: { createdAt: 'desc' },
          skip: skipNum,
          take: limitNum
        })
      ]);
      let contacts = contactsRaw;
      const userMap = await resolveUserNamesForRecords(contacts);

      contacts = contacts.map(c => {
        const agent = c.assignedTo ? userMap[c.assignedTo] : null;
        const tl = agent?.tlId ? userMap[agent.tlId] : null;
        const admin = agent?.adminId ? userMap[agent.adminId] : (c.adminId ? userMap[c.adminId] : null);
        
        return {
          ...c, _id: c.id,
          agentName: agent ? agent.name : 'Unassigned',
          tlName: tl ? tl.name : 'N/A',
          adminName: admin ? admin.name : 'N/A'
        };
      });

      let totalLeadValue = 0;
      if (disposition === 'Lead') {
        const agg = await prisma.contact.aggregate({
          where: whereQuery,
          _sum: { leadAmount: true }
        });
        totalLeadValue = agg._sum.leadAmount || 0;
      }

      return res.json({ contacts, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum), totalLeadValue });
    } else {
      const contactsRaw = await prisma.contact.findMany({ where: whereQuery, orderBy: { createdAt: 'desc' }, take: 500 });
      let contacts = contactsRaw;
      const userMap = await resolveUserNamesForRecords(contacts);

      contacts = contacts.map(c => {
        const agent = c.assignedTo ? userMap[c.assignedTo] : null;
        const tl = agent?.tlId ? userMap[agent.tlId] : null;
        const admin = agent?.adminId ? userMap[agent.adminId] : (c.adminId ? userMap[c.adminId] : null);
        
        return {
          ...c, _id: c.id,
          agentName: agent ? agent.name : 'Unassigned',
          tlName: tl ? tl.name : 'N/A',
          adminName: admin ? admin.name : 'N/A'
        };
      });
      return res.json(contacts);
    }
  } catch (err) {
    console.error('Fetch contacts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/dispose', verify, authorize(['agent']), async (req, res) => {
  try {
    const { disposition, remarks, appointmentDt, leadAmount, callBackDt, status, statusDetails, transactionId } = req.body;
    const query = { id: req.params.id, isDeleted: false };
    if (!['superadmin', 'admin', 'tl'].includes(req.user.role)) {
      query.assignedTo = req.user._id || req.user.id;
    }
    const contact = await prisma.contact.findFirst({
      where: query
    });

    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const DISP_LABELS = {
      'Lead': 'Lead', 'Appointment': 'Appointment', 'CallNotAnswered': 'Call Not Answered',
      'HungUp': 'Hung Up', 'Invalid': 'Invalid / Wrong No.', 'DoNotCall': 'Do Not Call', 'CallBack': 'Call Back',
      'NotInterested': 'Not Interested', 'LanguageBarrier': 'Language Barrier'
    };
    
    const dispositionLabel = DISP_LABELS[disposition] || disposition;
    const dateStr = new Date().toLocaleString('en-US', {
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true
    });
    const agentName = req.user.name || req.user.username || 'Agent';
    const newRemarkEntry = `[${dispositionLabel} by ${agentName} on ${dateStr}]: ${remarks || ''}`;
    const updatedRemarks = contact.remarks ? `${contact.remarks} | ${newRemarkEntry}` : newRemarkEntry;

    const update = {
      disposition, remarks: updatedRemarks,
      disposedBy: req.user._id || req.user.id, disposedAt: new Date()
    };

    if (disposition === 'Lead') {
      update.leadAmount = parseFloat(leadAmount) || 0;
      update.conversionDate = new Date();
      update.queueOrder = 999999;
      if (status) update.status = status;
      if (transactionId) update.transactionId = transactionId;
      if (req.body.utrCharity !== undefined) update.utrCharity = req.body.utrCharity;
      if (req.body.charityAmount !== undefined) update.charityAmount = parseFloat(req.body.charityAmount) || 0;
      if (req.body.isCharityConfirmed !== undefined) update.isCharityConfirmed = Boolean(req.body.isCharityConfirmed);
      if (callBackDt) { update.callBackDt = new Date(callBackDt); update.cbReminderSent = false; update.lateNotified = false; }
      if (appointmentDt) { update.appointmentDt = new Date(appointmentDt); update.reminderSent = false; update.lateNotified = false; }
    } else if (disposition === 'Appointment') {
      update.appointmentDt = appointmentDt ? new Date(appointmentDt) : null;
      update.reminderSent = false;
      update.lateNotified = false;
      update.queueOrder = 999999;
    } else if (disposition === 'CallBack') {
      update.callBackDt = callBackDt ? new Date(callBackDt) : null;
      update.cbReminderSent = false;
      update.lateNotified = false;
      update.queueOrder = 999999; update.status = 'Call Back';
    } else if (disposition === 'CallNotAnswered' || disposition === 'HungUp') {
      update.rechurnCount = (contact.rechurnCount || 0) + 1;
      update.lastCallAttempt = new Date();
      if (update.rechurnCount >= 3) {
        update.queueOrder = 999999;
      } else {
        const maxOrderContact = await prisma.contact.findFirst({
          where: { assignedTo: req.user._id || req.user.id, queueOrder: { lt: 999999 } },
          orderBy: { queueOrder: 'desc' }
        });
        update.queueOrder = maxOrderContact ? (maxOrderContact.queueOrder + 1) : 1;
      }
    } else {
      update.queueOrder = 999999;
    }

    await prisma.contact.update({ where: { id: req.params.id }, data: update });

    await Promise.all([
      prisma.appointment.deleteMany({ where: { contactId: req.params.id } }),
      prisma.callback.deleteMany({ where: { contactId: req.params.id } })
    ]);

    const fields = contact.fields || {};
    const phoneNum = fields.Phone || fields.phone || fields.Mobile;
    if (disposition !== 'CallBack' && phoneNum) await cleanupAllCallbacks(phoneNum);

    let emailResult = null;
    if (disposition === 'Lead') {
      await prisma.lead.create({
        data: {
          contactId: req.params.id, fields: contact.fields || {}, batchId: contact.batchId,
          assignedTo: req.user._id || req.user.id, agentName: req.user.name,
          leadAmount: parseFloat(leadAmount) || 0, status: status || 'Pending',
          remarks: remarks || '',
          adminId: contact.adminId,
          transactionId: transactionId,
          utrCharity: req.body.utrCharity || null,
          charityAmount: req.body.charityAmount ? parseFloat(req.body.charityAmount) : null,
          isCharityConfirmed: Boolean(req.body.isCharityConfirmed),
          conversionDate: status === 'Converted' ? new Date() : null
        }
      });
      if (status === 'Converted') {
        triggerConversionEmail(req.params.id, req.body.receiptImage).then(emailResult => {
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
    } else if (disposition === 'Appointment') {
      await prisma.appointment.create({
        data: {
          contactId: req.params.id, fields: contact.fields || {}, batchId: contact.batchId,
          assignedTo: req.user._id || req.user.id, agentName: req.user.name,
          appointmentDt: appointmentDt ? new Date(appointmentDt) : new Date(),
          remarks: remarks || '', adminId: contact.adminId
        }
      });
    } else if (disposition === 'CallBack') {
      await prisma.callback.create({
        data: {
          contactId: req.params.id, fields: contact.fields || {}, batchId: contact.batchId,
          assignedTo: req.user._id || req.user.id, agentName: req.user.name,
          callBackDt: callBackDt ? new Date(callBackDt) : new Date(),
          remarks: remarks || '', adminId: contact.adminId, source: 'workflow'
        }
      });
      if (phoneNum) await consolidateCallbacks(phoneNum);
    }

    broadcast('contact_disposed', { contactId: req.params.id, disposition, agentName: req.user.name });
    res.json({ success: true, emailResult });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id/confirm-charity', verify, authorize(['superadmin', 'admin', 'tl', 'agent']), async (req, res) => {
  try {
    const contactId = req.params.id;
    const { utrCharity, charityAmount } = req.body;

    if (!utrCharity || charityAmount === undefined || charityAmount === null || charityAmount === '') {
      return res.status(400).json({ error: 'Both UTR-Charity and Charity Amount are required' });
    }

    const numAmount = parseFloat(charityAmount);
    if (isNaN(numAmount) || numAmount < 0) {
      return res.status(400).json({ error: 'Please provide a valid Charity Amount' });
    }

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
          { id: contactId },
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

router.get('/notifications', verify, authorize(['superadmin', 'agent', 'tl', 'admin']), async (req, res) => {
  try {
    const now = new Date();
    const userId = req.user._id || req.user.id;
    const contactQuery = { assignedTo: userId, isDeleted: false };
    const notifications = [];
    const seen = new Set(); // Prevent duplicates across contacts and dedicated tables

    // --- Past-due Callbacks from contacts table ---
    const pastDueCallbackContacts = await prisma.contact.findMany({
      where: { ...contactQuery, disposition: 'CallBack', callBackDt: { lt: now } },
      orderBy: { callBackDt: 'desc' }, take: 20
    });
    pastDueCallbackContacts.forEach(c => {
      const key = `cb_contact_${c.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      notifications.push({
        type: 'callback', title: '⚠️ Callback Breached',
        message: `${(c.fields || {}).Name || (c.fields || {}).name || 'Unknown'} — was due at ${c.callBackDt ? new Date(c.callBackDt).toLocaleString() : ''}`,
        path: '/callbacks'
      });
    });

    // --- Past-due Callbacks from callbacks table ---
    const pastDueCallbackRecords = await prisma.callback.findMany({
      where: { assignedTo: userId, callBackDt: { lt: now } },
      orderBy: { callBackDt: 'desc' }, take: 20
    });
    pastDueCallbackRecords.forEach(cb => {
      const key = `cb_record_${cb.contactId || cb.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      notifications.push({
        type: 'callback', title: '⚠️ Callback Breached',
        message: `${(cb.fields || {}).Name || (cb.fields || {}).name || 'Unknown'} — was due at ${cb.callBackDt ? new Date(cb.callBackDt).toLocaleString() : ''}`,
        path: '/callbacks'
      });
    });

    // --- Past-due Appointments from contacts table ---
    const pastDueAppointmentContacts = await prisma.contact.findMany({
      where: { ...contactQuery, disposition: 'Appointment', appointmentDt: { lt: now } },
      orderBy: { appointmentDt: 'desc' }, take: 20
    });
    pastDueAppointmentContacts.forEach(c => {
      const key = `appt_contact_${c.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      notifications.push({
        type: 'appointment', title: '⚠️ Appointment Breached',
        message: `${(c.fields || {}).Name || (c.fields || {}).name || 'Unknown'} — was due at ${c.appointmentDt ? new Date(c.appointmentDt).toLocaleString() : ''}`,
        path: '/appointments'
      });
    });

    // --- Past-due Appointments from appointments table ---
    const pastDueAppointmentRecords = await prisma.appointment.findMany({
      where: { assignedTo: userId, appointmentDt: { lt: now } },
      orderBy: { appointmentDt: 'desc' }, take: 20
    });
    pastDueAppointmentRecords.forEach(appt => {
      const key = `appt_record_${appt.contactId || appt.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      notifications.push({
        type: 'appointment', title: '⚠️ Appointment Breached',
        message: `${(appt.fields || {}).Name || (appt.fields || {}).name || 'Unknown'} — was due at ${appt.appointmentDt ? new Date(appt.appointmentDt).toLocaleString() : ''}`,
        path: '/appointments'
      });
    });

    // Limit to 20 total notifications
    res.json(notifications.slice(0, 20));
  } catch (err) {
    console.error('Notifications fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/admin-stats', verify, authorize(['superadmin']), async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    const admins = await prisma.user.findMany({ where: { role: 'admin', isDeleted: false } });
    
    let queryText = `
      SELECT 
        admin_id as "adminId",
        COUNT(CASE WHEN disposition = 'Lead' AND status = 'Converted' THEN 1 END)::int as leads,
        COUNT(CASE WHEN disposition = 'Appointment' THEN 1 END)::int as appointments,
        COUNT(CASE WHEN disposition = 'CallBack' THEN 1 END)::int as callbacks,
        COALESCE(SUM(CASE WHEN disposition = 'Lead' AND status = 'Converted' THEN lead_amount END), 0)::float as "totalLeadAmount"
      FROM contacts
      WHERE is_deleted = false AND admin_id IS NOT NULL
    `;
    
    const params = [];
    let paramCount = 1;
    if (fromDate && toDate) {
      const start = new Date(fromDate);
      const end = new Date(new Date(toDate).setHours(23, 59, 59, 999));
      queryText += ` AND disposed_at >= $${paramCount++} AND disposed_at <= $${paramCount++}`;
      params.push(start, end);
    }
    
    queryText += ` GROUP BY admin_id`;
    
    const rawStats = await prisma.$queryRawUnsafe(queryText, ...params);

    const statsMap = {};
    rawStats.forEach(s => {
      statsMap[s.adminId] = s;
    });

    const stats = admins.map(a => {
      const s = statsMap[a.id] || { leads: 0, appointments: 0, callbacks: 0, totalLeadAmount: 0 };
      return {
        adminId: a.id,
        name: a.name,
        username: a.username,
        leads: s.leads,
        appointments: s.appointments,
        callbacks: s.callbacks,
        totalLeadAmount: s.totalLeadAmount
      };
    });
    res.json(stats);
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: 'Failed to fetch admin stats' });
  }
});

router.get('/stats', verify, authorize(['superadmin', 'agent', 'tl', 'admin']), async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { agentId, fromDate, toDate } = req.query;

    let conditions = ["is_deleted = false"];
    let params = [];
    let paramCount = 1;

    if (req.user.role === 'agent') {
      conditions.push(`assigned_to = $${paramCount++}`);
      params.push(userId);
    } else if (req.user.role === 'tl') {
      const agents = await prisma.user.findMany({ where: { tlId: userId }, select: { id: true } });
      const agentIds = agents.map(a => a.id);
      if (agentIds.length === 0) {
        const totalAdmins = await prisma.user.count({ where: { role: 'admin', isDeleted: false } });
        return res.json({
          total: 0, pending: 0, lead: 0, appointment: 0, callBack: 0, invalid: 0, hungUp: 0, doNotCall: 0,
          notInterested: 0, languageBarrier: 0,
          totalLeadAmount: 0, totalAdmins, allLead: 0, allLeadAmount: 0, todayCalls: 0
        });
      }
      if (agentId && agentIds.includes(agentId)) {
        conditions.push(`assigned_to = $${paramCount++}`);
        params.push(agentId);
      } else {
        const placeholders = agentIds.map(() => `$${paramCount++}`).join(',');
        conditions.push(`assigned_to IN (${placeholders})`);
        params.push(...agentIds);
      }
    } else if (req.user.role === 'admin') {
      conditions.push(`admin_id = $${paramCount++}`);
      params.push(userId);
      if (agentId) {
        conditions.push(`assigned_to = $${paramCount++}`);
        params.push(agentId);
      }
    } else { // superadmin
      if (agentId) {
        conditions.push(`assigned_to = $${paramCount++}`);
        params.push(agentId);
      }
    }

    if (fromDate && toDate) {
      const start = new Date(fromDate);
      const end = new Date(new Date(toDate).setHours(23, 59, 59, 999));
      conditions.push(`(
        (disposed_at >= $${paramCount++} AND disposed_at <= $${paramCount++})
        OR
        ((disposition IS NULL OR disposition = '') AND created_at >= $${paramCount++} AND created_at <= $${paramCount++})
      )`);
      params.push(start, end, start, end);
    }

    const queryText = `
      SELECT 
        COUNT(*)::int as total,
        COUNT(CASE WHEN disposition IS NULL OR disposition = '' THEN 1 END)::int as pending,
        COUNT(CASE WHEN disposition = 'Lead' AND status = 'Converted' THEN 1 END)::int as lead,
        COUNT(CASE WHEN disposition = 'Appointment' THEN 1 END)::int as appointment,
        COUNT(CASE WHEN disposition = 'CallBack' THEN 1 END)::int as callback,
        COUNT(CASE WHEN disposition = 'Invalid' THEN 1 END)::int as invalid,
        COUNT(CASE WHEN disposition = 'HungUp' THEN 1 END)::int as hungup,
        COUNT(CASE WHEN disposition = 'CallNotAnswered' THEN 1 END)::int as callnotanswered,
        COUNT(CASE WHEN disposition = 'DoNotCall' THEN 1 END)::int as donotcall,
        COUNT(CASE WHEN disposition = 'NotInterested' THEN 1 END)::int as notinterested,
        COUNT(CASE WHEN disposition = 'LanguageBarrier' THEN 1 END)::int as languagebarrier,
        COALESCE(SUM(CASE WHEN disposition = 'Lead' AND status = 'Converted' THEN COALESCE(charity_amount, lead_amount) END), 0)::float as totalleadamount,
        COUNT(CASE WHEN disposition = 'Lead' THEN 1 END)::int as alllead,
        COALESCE(SUM(CASE WHEN disposition = 'Lead' THEN COALESCE(charity_amount, lead_amount) END), 0)::float as allleadamount
      FROM contacts
      WHERE ${conditions.join(' AND ')}
    `;

    const statsArray = await prisma.$queryRawUnsafe(queryText, ...params);
    const s = statsArray[0] || {};
    const totalAdmins = await prisma.user.count({ where: { role: 'admin', isDeleted: false } });

    // Calculate total calls done today (real-time per day)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todayWhere = {
      isDeleted: false,
      disposedAt: {
        gte: todayStart,
        lte: todayEnd
      }
    };

    if (req.user.role === 'agent') {
      todayWhere.assignedTo = userId;
    } else if (req.user.role === 'tl') {
      const tlAgents = await prisma.user.findMany({ where: { tlId: userId }, select: { id: true } });
      const tlAgentIds = tlAgents.map(a => a.id);
      if (agentId && tlAgentIds.includes(agentId)) {
        todayWhere.assignedTo = agentId;
      } else {
        todayWhere.assignedTo = { in: tlAgentIds };
      }
    } else if (req.user.role === 'admin') {
      todayWhere.adminId = userId;
      if (agentId) {
        todayWhere.assignedTo = agentId;
      }
    } else { // superadmin
      if (agentId) {
        todayWhere.assignedTo = agentId;
      }
    }

    const todayCallsCount = await prisma.contact.count({
      where: todayWhere
    });

    res.json({
      total: s.total || 0,
      pending: s.pending || 0,
      lead: s.lead || 0,
      appointment: s.appointment || 0,
      callBack: s.callback || 0,
      invalid: s.invalid || 0,
      hungUp: s.hungup || 0,
      callNotAnswered: s.callnotanswered || 0,
      doNotCall: s.donotcall || 0,
      notInterested: s.notinterested || 0,
      languageBarrier: s.languagebarrier || 0,
      totalLeadAmount: s.totalleadamount || 0,
      totalAdmins,
      allLead: s.alllead || 0,
      allLeadAmount: s.allleadamount || 0,
      todayCalls: todayCallsCount || 0
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

router.get('/agent-calls-summary', verify, authorize(['superadmin', 'admin', 'tl']), async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { fromDate, toDate } = req.query;

    const userQuery = { role: 'agent', isDeleted: false };
    if (req.user.role === 'tl') userQuery.tlId = userId;
    if (req.user.role === 'admin') userQuery.adminId = userId;
    
    const agents = await prisma.user.findMany({ 
      where: userQuery,
      select: { id: true, name: true }
    });
    const agentIds = agents.map(a => a.id);

    if (agentIds.length === 0) return res.json([]);

    const agentPlaceholders = agentIds.map((_, i) => `$${i + 1}`).join(',');
    let conditions = ["is_deleted = false", `assigned_to IN (${agentPlaceholders})`, "disposed_at IS NOT NULL"];
    let params = [...agentIds];
    let paramCount = agentIds.length + 1;

    if (fromDate && toDate) {
      const start = new Date(fromDate);
      const end = new Date(new Date(toDate).setHours(23, 59, 59, 999));
      conditions.push(`disposed_at >= $${paramCount++}`);
      params.push(start);
      conditions.push(`disposed_at <= $${paramCount++}`);
      params.push(end);
    }

    const queryText = `
      SELECT 
        assigned_to as "agentId",
        COUNT(*)::int as "callsCount"
      FROM contacts
      WHERE ${conditions.join(' AND ')}
      GROUP BY assigned_to
    `;

    const rawStats = await prisma.$queryRawUnsafe(queryText, ...params);
    const statsMap = {};
    rawStats.forEach(s => {
      statsMap[s.agentId] = s.callsCount;
    });

    const result = agents.map(a => ({
      agentId: a.id,
      name: a.name || 'Unknown',
      callsCount: statsMap[a.id] || 0
    }));

    res.json(result);
  } catch (err) {
    console.error('Agent calls summary error:', err);
    res.status(500).json({ error: 'Failed to fetch agent calls summary' });
  }
});

router.get('/agent-queues', verify, authorize(['superadmin', 'admin', 'tl']), async (req, res) => {
  try {
    const userQuery = { role: 'agent', isDeleted: false };
    if (req.user.role === 'tl') userQuery.tlId = req.user._id || req.user.id;
    if (req.user.role === 'admin') userQuery.adminId = req.user._id || req.user.id;
    const agents = await prisma.user.findMany({ where: userQuery });
    const agentIds = agents.map(a => a.id);

    if (agentIds.length === 0) return res.json([]);

    const queuePlaceholders = agentIds.map((_, i) => `$${i + 1}`).join(',');
    const rawQueues = await prisma.$queryRawUnsafe(`
      SELECT 
        assigned_to as "agentId",
        COUNT(*)::int as total,
        COUNT(CASE WHEN disposition IS NULL OR disposition = '' THEN 1 END)::int as pending,
        COUNT(CASE WHEN disposition = 'Lead' AND status = 'Converted' THEN 1 END)::int as lead,
        COUNT(CASE WHEN disposition = 'Appointment' THEN 1 END)::int as appointment,
        COALESCE(SUM(CASE WHEN disposition = 'Lead' AND status = 'Converted' THEN COALESCE(charity_amount, lead_amount) END), 0)::float as "totalLeadAmount"
      FROM contacts
      WHERE is_deleted = false AND assigned_to IN (${queuePlaceholders})
      GROUP BY assigned_to
    `, ...agentIds);

    const queueMap = {};
    rawQueues.forEach(q => {
      queueMap[q.agentId] = q;
    });

    const tls = await prisma.user.findMany({ where: { role: 'tl', isDeleted: false } });
    const tlMap = {};
    tls.forEach(t => tlMap[t.id] = t);

    const result = agents.map(a => {
      const q = queueMap[a.id] || { total: 0, pending: 0, lead: 0, appointment: 0, totalLeadAmount: 0 };
      const tl = a.tlId ? tlMap[a.tlId] : null;
      return {
        agent: { _id: a.id, name: a.name },
        tlName: tl ? tl.name : '—',
        active: a.active,
        total: q.total,
        pending: q.pending,
        lead: q.lead,
        appointment: q.appointment,
        disposed: q.total - q.pending,
        totalLeadAmount: q.totalLeadAmount
      };
    });

    res.json(result);
  } catch (err) {
    console.error('Queue error:', err);
    res.status(500).json({ error: 'Failed to fetch queues' });
  }
});

router.get('/queue', verify, authorize(['superadmin', 'agent', 'tl', 'admin']), async (req, res) => {
  try {
    const agentId = req.user._id || req.user.id;
    const now = new Date();
    
    const [total, pending] = await Promise.all([
      prisma.contact.count({ where: { assignedTo: agentId, isDeleted: false } }),
      prisma.contact.count({ 
        where: { 
          assignedTo: agentId, isDeleted: false,
          OR: [
            { disposition: null }, { disposition: '' },
            { disposition: { in: ['CallNotAnswered', 'HungUp'] }, queueOrder: { lt: 999999 } }
          ]
        }
      })
    ]);

    const disposed = total - pending;
    let contact = null;
    let type = 'regular';
    let rechurnNum = 1;
    
    if (req.query.contactId) {
      const targetContact = await prisma.contact.findFirst({
        where: { id: req.query.contactId, assignedTo: agentId, isDeleted: false }
      });
      if (targetContact) {
        const isDisposed = ['Lead', 'Invalid', 'DoNotCall', 'NotInterested', 'LanguageBarrier'].includes(targetContact.disposition) ||
                           ((targetContact.disposition === 'CallNotAnswered' || targetContact.disposition === 'HungUp') && (targetContact.queueOrder === 999999 || targetContact.rechurnCount >= 3));
        if (!isDisposed) {
          contact = targetContact;
        }
      }
    }
    
    if (!contact) {
      const dueCallbacks = await prisma.contact.findMany({
        where: { assignedTo: agentId, disposition: 'CallBack', callBackDt: { lte: now }, queueOrder: { lt: 999999 }, isDeleted: false },
        orderBy: { callBackDt: 'asc' }, take: 1
      });
      
      if (dueCallbacks.length > 0) {
        contact = dueCallbacks[0];
        await prisma.contact.update({ 
          where: { id: contact.id }, 
          data: { queueOrder: -10, callBackDt: null, disposition: null } 
        });
        type = 'callback_due';
      } else {
        const standardPending = await prisma.contact.findMany({
          where: {
            assignedTo: agentId, isDeleted: false,
            OR: [
              { disposition: null }, { disposition: '' },
              { disposition: { in: ['CallNotAnswered', 'HungUp'] }, queueOrder: { lt: 999999 } }
            ]
          },
          orderBy: [{ queueOrder: 'asc' }, { createdAt: 'asc' }], take: 1
        });
        contact = standardPending[0] || null;
      }
    }
    
    if (contact && type !== 'callback_due') {
      if (contact.disposition === 'CallNotAnswered' || contact.disposition === 'HungUp') {
        type = 'rechurn'; rechurnNum = (contact.rechurnCount || 0) + 1;
      } else if (contact.queueOrder === -10) {
        type = 'callback_due';
      }
    }
    
    res.json({
      contact: contact ? { ...contact, _id: contact.id } : null,
      total, pending, disposed, remaining: pending, type, rechurnNum
    });
  } catch (err) {
    console.error('Queue route error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/export-delete-pending', verify, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const { agentId } = req.body;
    if (!agentId) {
      return res.status(400).json({ error: 'Agent ID is required.' });
    }

    // Verify agent exists and role is agent
    const agent = await prisma.user.findFirst({
      where: { id: agentId, role: 'agent', isDeleted: false }
    });
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found.' });
    }

    // If logged-in user is admin, make sure the agent belongs to this admin
    if (req.user.role === 'admin') {
      const loggedInAdminId = req.user._id || req.user.id;
      if (agent.adminId !== loggedInAdminId) {
        return res.status(403).json({ error: 'Unauthorized: Agent does not belong to your admin account.' });
      }
    }

    // Fetch the pending contacts for this agent
    const contacts = await prisma.contact.findMany({
      where: {
        assignedTo: agentId,
        OR: [
          { disposition: null },
          { disposition: '' }
        ]
      },
      orderBy: { createdAt: 'desc' }
    });

    if (contacts.length === 0) {
      return res.status(400).json({ error: 'No pending contacts found for this agent.' });
    }

    // Generate CSV contents
    const fieldCols = [...new Set(contacts.flatMap(c => Object.keys(c.fields || {})))];
    const rows = contacts.map((c, index) => {
      const row = {
        'S.No.': index + 1,
        'Contact ID': c.id,
        'Batch ID': c.batchId || '',
        'Agent Name': agent.name || 'Unknown',
        'Created At': c.createdAt ? new Date(c.createdAt).toLocaleString('en-IN') : '',
        'Remarks': c.remarks || ''
      };
      fieldCols.forEach(col => {
        row[col] = c.fields?.[col] || '';
      });
      return row;
    });

    const headers = rows.length ? Object.keys(rows[0]) : [];
    const escapeValue = v => {
      const s = String(v ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const csv = [
      headers.map(escapeValue).join(','),
      ...rows.map(r => headers.map(h => escapeValue(r[h])).join(','))
    ].join('\n');

    // Perform permanent deletion from database
    await prisma.contact.deleteMany({
      where: {
        assignedTo: agentId,
        OR: [
          { disposition: null },
          { disposition: '' }
        ]
      }
    });

    const safeAgentName = (agent.name || 'agent').replace(/[^a-zA-Z0-9]/g, '_');
    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="pending_contacts_${safeAgentName}_${Date.now()}.csv"`,
      'Access-Control-Expose-Headers': 'Content-Disposition'
    });

    return res.send(csv);
  } catch (err) {
    console.error('Export and delete pending contacts error:', err);
    res.status(500).json({ error: 'Internal server error during export and delete' });
  }
});

router.delete('/batch/:batchId', verify, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    await prisma.contact.deleteMany({ where: { batchId: req.params.batchId } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/bulk-delete', verify, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !ids.length) return res.status(400).json({ error: 'No IDs provided' });
    await prisma.contact.deleteMany({ where: { id: { in: ids } } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/wipe', verify, authorize(['superadmin']), async (req, res) => {
  try {
    await prisma.contact.deleteMany({});
    await prisma.batch.deleteMany({});
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/wipe/hungup', verify, authorize(['superadmin']), async (req, res) => {
  try {
    await prisma.contact.deleteMany({ where: { disposition: 'HungUp' } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/:id', verify, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    await prisma.contact.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/bulk-delete-batches', verify, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const { batchIds } = req.body;
    if (!batchIds || !batchIds.length) return res.status(400).json({ error: 'No batch IDs provided' });
    await Promise.all([
      prisma.contact.deleteMany({ where: { batchId: { in: batchIds } } }),
      prisma.batch.deleteMany({ where: { id: { in: batchIds } } })
    ]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id', verify, authorize(['superadmin', 'agent', 'tl', 'admin']), async (req, res) => {
  try {
    const contact = await prisma.contact.findFirst({ where: { id: req.params.id, isDeleted: false } });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    res.json({ ...contact, _id: contact.id });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/:id/check-callback', verify, authorize(['superadmin', 'agent', 'tl', 'admin']), async (req, res) => {
  try {
    const contactId = req.params.id;
    const existingCallback = await prisma.callback.findFirst({ where: { contactId } });
    if (existingCallback) return res.json({ exists: true, callback: { ...existingCallback, _id: existingCallback.id } });

    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (contact && contact.disposition === 'CallBack' && contact.callBackDt) {
      return res.json({
        exists: true,
        callback: { _id: contact.id, contactId: contact.id, callBackDt: contact.callBackDt, remarks: contact.remarks || '' }
      });
    }

    res.json({ exists: false });
  } catch (err) {
    console.error('Check callback error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id/status', verify, authorize(['superadmin', 'agent', 'tl', 'admin']), async (req, res) => {
  try {
    const contact = await prisma.contact.findUnique({ where: { id: req.params.id } });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    
    if (contact.status === 'Converted' && req.body.status && req.body.status !== 'Converted') {
      return res.status(400).json({ error: 'Cannot change status of a successfully converted lead' });
    }

    const { status, remarks, callBackDt, appointmentDt, leadAmount } = req.body;
    const update = { 
      status: status || contact.status,
      disposedAt: new Date(),
      disposedBy: req.user._id || req.user.id
    };

    if (remarks !== undefined) {
      const dateStr = new Date().toLocaleString('en-US', {
        year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true
      });
      const updaterName = req.user.name || req.user.username || 'Staff';
      const actionLabel = status ? `Status: ${status}` : 'Status Update';
      const newRemarkEntry = `[${actionLabel} by ${updaterName} on ${dateStr}]: ${remarks}`;
      update.remarks = contact.remarks ? `${contact.remarks} | ${newRemarkEntry}` : newRemarkEntry;
    }

    if (status === 'Call Back') {
      update.disposition = 'Lead';
      update.cbReminderSent = false;
      update.callBackDt = callBackDt ? new Date(callBackDt) : (contact.callBackDt || new Date());
      
      await prisma.lead.updateMany({
        where: { contactId: contact.id },
        data: {
          status: 'Call Back',
          remarks: remarks || 'Status updated to Call Back',
          lastModified: new Date()
        }
      });
      await prisma.callback.deleteMany({ where: { contactId: contact.id } });
      
      const fields = contact.fields || {};
      const phoneNum = fields.Phone || fields.phone || fields.Mobile;
      if (phoneNum) await consolidateCallbacks(phoneNum);

    } else if (status === 'Appointment') {
      update.disposition = 'Appointment';
      update.appointmentDt = appointmentDt ? new Date(appointmentDt) : (contact.appointmentDt || new Date());
      
      await prisma.appointment.deleteMany({ where: { contactId: contact.id } });
      await prisma.appointment.create({
        data: {
          contactId: contact.id, fields: contact.fields || {}, batchId: contact.batchId,
          assignedTo: contact.assignedTo, agentName: contact.agentName || req.user.name,
          appointmentDt: update.appointmentDt, remarks: remarks || 'Status updated to Appointment',
          adminId: contact.adminId
        }
      });

    } else if (status === 'Lead') {
      update.disposition = 'Lead';
      update.leadAmount = parseFloat(leadAmount) || contact.leadAmount || 0;
      update.conversionDate = new Date();
      if (req.body.transactionId !== undefined) update.transactionId = req.body.transactionId;
      if (req.body.status === 'Converted') update.status = 'Converted';

      await prisma.lead.deleteMany({ where: { contactId: contact.id } });
      await prisma.lead.create({
        data: {
          contactId: contact.id, fields: contact.fields || {}, batchId: contact.batchId,
          assignedTo: contact.assignedTo, agentName: contact.agentName || req.user.name,
          leadAmount: update.leadAmount, status: update.status || 'Lead', adminId: contact.adminId,
          transactionId: req.body.transactionId
        }
      });
      if (req.body.status === 'Converted') {
        triggerConversionEmail(contact.id, req.body.receiptImage).then(emailResult => {
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
    }

    await prisma.contact.update({ where: { id: contact.id }, data: update });
    broadcast('dashboard_update');
    broadcast('contacts_updated');

    res.json({ success: true, contact: { ...contact, ...update, _id: contact.id } });
  } catch (err) {
    console.error('Update contact status error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/requeue', verify, authorize(['superadmin', 'agent', 'tl', 'admin']), async (req, res) => {
  try {
    const contact = await prisma.contact.findUnique({ where: { id: req.params.id } });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const update = {
      disposition: null, status: null, leadAmount: null, appointmentDt: null, callBackDt: null,
      remarks: contact.remarks ? `${contact.remarks} | [Requeued at ${new Date().toLocaleString()}]` : `[Requeued at ${new Date().toLocaleString()}]`,
      queueOrder: -10
    };

    await Promise.all([
      prisma.contact.update({ where: { id: contact.id }, data: update }),
      prisma.lead.deleteMany({ where: { contactId: contact.id } }),
      prisma.appointment.deleteMany({ where: { contactId: contact.id } }),
      prisma.callback.deleteMany({ where: { contactId: contact.id } })
    ]);

    broadcast('dashboard_update');
    broadcast('contacts_updated');

    res.json({ success: true });
  } catch (err) {
    console.error('Requeue error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/bulk-requeue', verify, authorize(['superadmin', 'agent', 'tl', 'admin']), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !ids.length) {
      return res.status(400).json({ error: 'No IDs provided' });
    }

    const nowStr = new Date().toLocaleString();
    const remarkToAppend = ` | [Requeued at ${nowStr}]`;

    // Perform bulk update directly in PostgreSQL to concatenate remarks safely
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    
    await prisma.$executeRawUnsafe(
      `UPDATE contacts 
       SET disposition = NULL, 
           status = NULL, 
           lead_amount = NULL, 
           appointment_dt = NULL, 
           call_back_dt = NULL, 
           queue_order = -10,
           remarks = COALESCE(remarks, '') || $${ids.length + 1}
       WHERE _id IN (${placeholders})`,
      ...ids,
      remarkToAppend
    );

    // Clean up child tables
    await Promise.all([
      prisma.lead.deleteMany({ where: { contactId: { in: ids } } }),
      prisma.appointment.deleteMany({ where: { contactId: { in: ids } } }),
      prisma.callback.deleteMany({ where: { contactId: { in: ids } } })
    ]);

    broadcast('dashboard_update');
    broadcast('contacts_updated');

    res.json({ success: true });
  } catch (err) {
    console.error('Bulk requeue error:', err);
    res.status(500).json({ error: 'Server error during bulk requeue' });
  }
});


router.get('/customer-360/:phone', verify, authorize(['superadmin', 'agent', 'tl', 'admin']), async (req, res) => {
  try {
    const phoneParam = req.params.phone;
    if (!phoneParam) return res.status(400).json({ error: 'Phone parameter is required' });

    const targetNorm = normalizePhone(phoneParam);
    if (!targetNorm) {
      return res.json({
        phone: phoneParam,
        normalizedPhone: null,
        hasConvertedLead: false,
        convertedLeads: [],
        timeline: [],
        contactsCount: 0,
        leadsCount: 0,
        callbacksCount: 0,
        appointmentsCount: 0
      });
    }

    const likePattern = `%${targetNorm}`;

    const [rawContacts, rawLeads, rawCallbacks, rawAppointments] = await Promise.all([
      prisma.$queryRawUnsafe(`
        SELECT _id as id, fields, remarks, status, disposition, 
               lead_amount as "leadAmount", transaction_id as "transactionId", 
               created_at as "createdAt", disposed_at as "disposedAt", 
               last_modified as "lastModified", assigned_to as "assignedTo", 
               agent_name as "agentName", conversion_date as "conversionDate"
        FROM contacts
        WHERE is_deleted = false AND (
          regexp_replace(fields->>'Phone', '\\D', '', 'g') LIKE $1 OR
          regexp_replace(fields->>'phone', '\\D', '', 'g') LIKE $1 OR
          regexp_replace(fields->>'Mobile', '\\D', '', 'g') LIKE $1
        )
        LIMIT 100
      `, likePattern),
      prisma.$queryRawUnsafe(`
        SELECT _id as id, contact_id as "contactId", fields, remarks, status, 
               lead_amount as "leadAmount", transaction_id as "transactionId", 
               created_at as "createdAt", last_modified as "lastModified", 
               assigned_to as "assignedTo", agent_name as "agentName"
        FROM leads
        WHERE 
          regexp_replace(fields->>'Phone', '\\D', '', 'g') LIKE $1 OR
          regexp_replace(fields->>'phone', '\\D', '', 'g') LIKE $1 OR
          regexp_replace(fields->>'Mobile', '\\D', '', 'g') LIKE $1
        LIMIT 100
      `, likePattern),
      prisma.$queryRawUnsafe(`
        SELECT _id as id, contact_id as "contactId", fields, remarks, 
               call_back_dt as "callBackDt", created_at as "createdAt", 
               assigned_to as "assignedTo", agent_name as "agentName"
        FROM callbacks
        WHERE 
          regexp_replace(fields->>'Phone', '\\D', '', 'g') LIKE $1 OR
          regexp_replace(fields->>'phone', '\\D', '', 'g') LIKE $1 OR
          regexp_replace(fields->>'Mobile', '\\D', '', 'g') LIKE $1
        LIMIT 100
      `, likePattern),
      prisma.$queryRawUnsafe(`
        SELECT _id as id, contact_id as "contactId", fields, remarks, 
               appointment_dt as "appointmentDt", created_at as "createdAt", 
               assigned_to as "assignedTo", agent_name as "agentName"
        FROM appointments
        WHERE 
          regexp_replace(fields->>'Phone', '\\D', '', 'g') LIKE $1 OR
          regexp_replace(fields->>'phone', '\\D', '', 'g') LIKE $1 OR
          regexp_replace(fields->>'Mobile', '\\D', '', 'g') LIKE $1
        LIMIT 100
      `, likePattern)
    ]);

    const allRecords = [...rawContacts, ...rawLeads, ...rawCallbacks, ...rawAppointments];
    const assignedToIds = [...new Set(allRecords.map(r => r.assignedTo).filter(Boolean))];
    const resolvedUsers = assignedToIds.length > 0 ? await prisma.user.findMany({
      where: { id: { in: assignedToIds } },
      select: { id: true, name: true, username: true }
    }) : [];
    const userMap = {};
    resolvedUsers.forEach(u => {
      userMap[u.id] = u.name || u.username || 'System';
    });

    const matchingContacts = rawContacts.filter(c => {
      const f = c.fields || {};
      const p = f.Phone || f.phone || f.Mobile;
      return p && normalizePhone(p) === targetNorm;
    });

    const matchingLeads = rawLeads.filter(l => {
      const f = l.fields || {};
      const p = f.Phone || f.phone || f.Mobile;
      return p && normalizePhone(p) === targetNorm;
    });

    const matchingCallbacks = rawCallbacks.filter(cb => {
      const f = cb.fields || {};
      const p = f.Phone || f.phone || f.Mobile;
      return p && normalizePhone(p) === targetNorm;
    });

    const matchingAppointments = rawAppointments.filter(appt => {
      const f = appt.fields || {};
      const p = f.Phone || f.phone || f.Mobile;
      return p && normalizePhone(p) === targetNorm;
    });

    const convertedLeads = [];
    const seenContactIds = new Set();
    const seenTransactionIds = new Set();

    // 1. Process matchingLeads first
    matchingLeads.forEach(l => {
      if (l.status === 'Converted') {
        const txId = (l.transactionId || '').trim();
        if (txId && seenTransactionIds.has(txId)) return; // skip duplicate TxID
        
        if (txId) seenTransactionIds.add(txId);
        if (l.contactId) seenContactIds.add(l.contactId);
        
        convertedLeads.push({
          id: l.id,
          contactId: l.contactId,
          leadAmount: l.leadAmount,
          transactionId: l.transactionId,
          agentName: l.agentName || userMap[l.assignedTo] || 'Agent',
          createdAt: l.createdAt,
          remarks: l.remarks
        });
      }
    });

    // 2. Process matchingContacts, skipping any already represented
    matchingContacts.forEach(c => {
      if (c.status === 'Converted' && c.disposition === 'Lead') {
        if (seenContactIds.has(c.id)) return; // already added from leads table
        
        const txId = (c.transactionId || '').trim();
        if (txId && seenTransactionIds.has(txId)) return; // skip duplicate TxID
        
        seenContactIds.add(c.id);
        if (txId) seenTransactionIds.add(txId);

        convertedLeads.push({
          id: c.id,
          contactId: c.id,
          leadAmount: c.leadAmount,
          transactionId: c.transactionId,
          agentName: c.agentName || userMap[c.assignedTo] || 'Agent',
          createdAt: c.conversionDate || c.disposedAt || c.createdAt,
          remarks: c.remarks
        });
      }
    });

    const parseRemark = (remarkStr) => {
      const requeueRegex = /^\[Requeued by (.+?) on (.+?)\]$/;
      const standardRegex = /^\[(.+?) by (.+?) on (.+?)\]:\s*(.*)$/;
      const cbRegex = /^\[Later CB Remark:\s*(.*)\]$/;
      const oldRequeueRegex = /^Requeued by (.+)$/;
      const requeuedAtRegex = /^\[Requeued at (.+?)\]$/;

      if (requeueRegex.test(remarkStr)) {
        const [_, name, date] = remarkStr.match(requeueRegex);
        return { type: 'requeue', label: 'Requeued', agent: name, date: new Date(date), content: 'Contact was returned to the active calling queue.' };
      }
      if (requeuedAtRegex.test(remarkStr)) {
        const [_, date] = remarkStr.match(requeuedAtRegex);
        return { type: 'requeue', label: 'Requeued', date: new Date(date), content: 'Contact was returned to the active calling queue.' };
      }
      if (standardRegex.test(remarkStr)) {
        const [_, disposal, agent, date, content] = remarkStr.match(standardRegex);
        return { type: 'disposal', label: disposal, agent, date: new Date(date), content };
      }
      if (cbRegex.test(remarkStr)) {
        const [_, content] = remarkStr.match(cbRegex);
        return { type: 'callback', label: 'Callback', content };
      }
      if (oldRequeueRegex.test(remarkStr)) {
        const [_, name] = remarkStr.match(oldRequeueRegex);
        return { type: 'requeue', label: 'Requeued', agent: name, content: 'Contact was returned to the active calling queue.' };
      }
      return { type: 'legacy', content: remarkStr };
    };

    const timelineEntries = [];
    const seenRemarks = new Set();

    const addRemarkToTimeline = (remarkStr, recordDate) => {
      const trimmed = remarkStr.trim();
      if (!trimmed || seenRemarks.has(trimmed)) return;
      seenRemarks.add(trimmed);

      const parsed = parseRemark(trimmed);
      let entryDate = recordDate || new Date();
      if (parsed.date && !isNaN(parsed.date.getTime())) {
        entryDate = parsed.date;
      }
      
      timelineEntries.push({
        ...parsed,
        date: entryDate.toISOString(),
        originalRemark: trimmed
      });
    };

    matchingContacts.forEach(c => {
      if (c.remarks) {
        c.remarks.split(' | ').forEach(r => {
          addRemarkToTimeline(r, c.disposedAt || c.lastModified || c.createdAt);
        });
      }
    });

    matchingLeads.forEach(l => {
      if (l.remarks) {
        l.remarks.split(' | ').forEach(r => {
          addRemarkToTimeline(r, l.createdAt || l.lastModified);
        });
      }
    });

    matchingCallbacks.forEach(cb => {
      const agentName = cb.agentName || userMap[cb.assignedTo] || 'Agent';
      const callbackDate = cb.callBackDt ? new Date(cb.callBackDt).toLocaleString() : 'N/A';
      const entryText = `[Callback Scheduled by ${agentName} for ${callbackDate}]: ${cb.remarks || ''}`;
      addRemarkToTimeline(entryText, cb.createdAt);
    });

    matchingAppointments.forEach(appt => {
      const agentName = appt.agentName || userMap[appt.assignedTo] || 'Agent';
      const apptDate = appt.appointmentDt ? new Date(appt.appointmentDt).toLocaleString() : 'N/A';
      const entryText = `[Appointment Scheduled by ${agentName} for ${apptDate}]: ${appt.remarks || ''}`;
      addRemarkToTimeline(entryText, appt.createdAt);
    });

    timelineEntries.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      phone: phoneParam,
      normalizedPhone: targetNorm,
      hasConvertedLead: convertedLeads.length > 0,
      convertedLeads,
      timeline: timelineEntries,
      contactsCount: matchingContacts.length,
      leadsCount: matchingLeads.length,
      callbacksCount: matchingCallbacks.length,
      appointmentsCount: matchingAppointments.length
    });
  } catch (err) {
    console.error('Customer 360 fetch failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
