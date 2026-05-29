const router = require('express').Router();
const { prisma } = require('../shared/db');
const { authorize, verify } = require('../shared/authMiddleware');
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

router.get('/', verify, authorize(['superadmin', 'admin', 'tl', 'agent']), async (req, res) => {
  try {
    const { disposition, agentId, tlId, search, batchId, page, limit } = req.query;
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
      let contacts = await prisma.contact.findMany({
        where: whereQuery,
        orderBy: { createdAt: 'desc' }
      });
      
      const q = search.trim().toLowerCase();
      contacts = contacts.filter(c => {
        return (
          (c.remarks && c.remarks.toLowerCase().includes(q)) ||
          Object.values(c.fields || {}).some(v => String(v).toLowerCase().includes(q)) ||
          (c.agentName && c.agentName.toLowerCase().includes(q))
        );
      });

      const userMap = {};
      const allUsers = await prisma.user.findMany({ select: { id: true, name: true, tlId: true, adminId: true } });
      allUsers.forEach(u => userMap[u.id] = u);

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
        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 50;
        const total = contacts.length;
        const paginatedContacts = contacts.slice((pageNum - 1) * limitNum, pageNum * limitNum);
        
        let totalLeadValue = 0;
        if (disposition === 'Lead') {
          totalLeadValue = contacts.reduce((sum, c) => sum + (c.leadAmount || 0), 0);
        }

        return res.json({ 
          contacts: paginatedContacts, 
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

      const [total, contactsRaw, allUsers] = await Promise.all([
        prisma.contact.count({ where: whereQuery }),
        prisma.contact.findMany({
          where: whereQuery,
          orderBy: { createdAt: 'desc' },
          skip: skipNum,
          take: limitNum
        }),
        prisma.user.findMany({ select: { id: true, name: true, tlId: true, adminId: true } })
      ]);
      let contacts = contactsRaw;
      const userMap = {};
      allUsers.forEach(u => userMap[u.id] = u);

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
      const [contactsRaw, allUsers] = await Promise.all([
        prisma.contact.findMany({ where: whereQuery, orderBy: { createdAt: 'desc' } }),
        prisma.user.findMany({ select: { id: true, name: true, tlId: true, adminId: true } })
      ]);
      let contacts = contactsRaw;
      const userMap = {};
      allUsers.forEach(u => userMap[u.id] = u);

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
      'HungUp': 'Hung Up', 'Invalid': 'Invalid / Wrong No.', 'DoNotCall': 'Do Not Call', 'CallBack': 'Call Back'
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
          transactionId: transactionId
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
    const admins = await prisma.user.findMany({ where: { role: 'admin', isDeleted: false } });
    const rawStats = await prisma.$queryRaw`
      SELECT 
        admin_id as "adminId",
        COUNT(CASE WHEN disposition = 'Lead' AND status = 'Converted' THEN 1 END)::int as leads,
        COUNT(CASE WHEN disposition = 'Appointment' THEN 1 END)::int as appointments,
        COUNT(CASE WHEN disposition = 'CallBack' THEN 1 END)::int as callbacks,
        COALESCE(SUM(CASE WHEN disposition = 'Lead' AND status = 'Converted' THEN lead_amount END), 0)::float as "totalLeadAmount"
      FROM contacts
      WHERE is_deleted = false AND admin_id IS NOT NULL
      GROUP BY admin_id
    `;

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
    let statsArray = [];

    if (req.user.role === 'agent') {
      statsArray = await prisma.$queryRaw`
        SELECT 
          COUNT(*)::int as total,
          COUNT(CASE WHEN disposition IS NULL OR disposition = '' THEN 1 END)::int as pending,
          COUNT(CASE WHEN disposition = 'Lead' AND status = 'Converted' THEN 1 END)::int as lead,
          COUNT(CASE WHEN disposition = 'Appointment' THEN 1 END)::int as appointment,
          COUNT(CASE WHEN disposition = 'CallBack' THEN 1 END)::int as callback,
          COUNT(CASE WHEN disposition = 'Invalid' THEN 1 END)::int as invalid,
          COUNT(CASE WHEN disposition IN ('HungUp', 'CallNotAnswered') AND rechurn_count >= 3 THEN 1 END)::int as hungup,
          COUNT(CASE WHEN disposition = 'DoNotCall' THEN 1 END)::int as donotcall,
          COALESCE(SUM(CASE WHEN disposition = 'Lead' AND status = 'Converted' THEN lead_amount END), 0)::float as totalleadamount,
          COUNT(CASE WHEN disposition = 'Lead' THEN 1 END)::int as alllead,
          COALESCE(SUM(CASE WHEN disposition = 'Lead' THEN lead_amount END), 0)::float as allleadamount
        FROM contacts
        WHERE is_deleted = false AND assigned_to = ${userId}
      `;
    } else if (req.user.role === 'tl') {
      const agents = await prisma.user.findMany({ where: { tlId: userId } });
      const agentIds = agents.map(a => a.id);
      if (agentIds.length === 0) {
        const totalAdmins = await prisma.user.count({ where: { role: 'admin', isDeleted: false } });
        return res.json({
          total: 0, pending: 0, lead: 0, appointment: 0, callBack: 0, invalid: 0, hungUp: 0, doNotCall: 0,
          totalLeadAmount: 0, totalAdmins, allLead: 0, allLeadAmount: 0
        });
      }
      statsArray = await prisma.$queryRawUnsafe(`
        SELECT 
          COUNT(*)::int as total,
          COUNT(CASE WHEN disposition IS NULL OR disposition = '' THEN 1 END)::int as pending,
          COUNT(CASE WHEN disposition = 'Lead' AND status = 'Converted' THEN 1 END)::int as lead,
          COUNT(CASE WHEN disposition = 'Appointment' THEN 1 END)::int as appointment,
          COUNT(CASE WHEN disposition = 'CallBack' THEN 1 END)::int as callback,
          COUNT(CASE WHEN disposition = 'Invalid' THEN 1 END)::int as invalid,
          COUNT(CASE WHEN disposition IN ('HungUp', 'CallNotAnswered') AND rechurn_count >= 3 THEN 1 END)::int as hungup,
          COUNT(CASE WHEN disposition = 'DoNotCall' THEN 1 END)::int as donotcall,
          COALESCE(SUM(CASE WHEN disposition = 'Lead' AND status = 'Converted' THEN lead_amount END), 0)::float as totalleadamount,
          COUNT(CASE WHEN disposition = 'Lead' THEN 1 END)::int as alllead,
          COALESCE(SUM(CASE WHEN disposition = 'Lead' THEN lead_amount END), 0)::float as allleadamount
        FROM contacts
        WHERE is_deleted = false AND assigned_to IN (${agentIds.map(id => `'${id}'`).join(',')})
      `);
    } else if (req.user.role === 'admin') {
      statsArray = await prisma.$queryRaw`
        SELECT 
          COUNT(*)::int as total,
          COUNT(CASE WHEN disposition IS NULL OR disposition = '' THEN 1 END)::int as pending,
          COUNT(CASE WHEN disposition = 'Lead' AND status = 'Converted' THEN 1 END)::int as lead,
          COUNT(CASE WHEN disposition = 'Appointment' THEN 1 END)::int as appointment,
          COUNT(CASE WHEN disposition = 'CallBack' THEN 1 END)::int as callback,
          COUNT(CASE WHEN disposition = 'Invalid' THEN 1 END)::int as invalid,
          COUNT(CASE WHEN disposition IN ('HungUp', 'CallNotAnswered') AND rechurn_count >= 3 THEN 1 END)::int as hungup,
          COUNT(CASE WHEN disposition = 'DoNotCall' THEN 1 END)::int as donotcall,
          COALESCE(SUM(CASE WHEN disposition = 'Lead' AND status = 'Converted' THEN lead_amount END), 0)::float as totalleadamount,
          COUNT(CASE WHEN disposition = 'Lead' THEN 1 END)::int as alllead,
          COALESCE(SUM(CASE WHEN disposition = 'Lead' THEN lead_amount END), 0)::float as allleadamount
        FROM contacts
        WHERE is_deleted = false AND admin_id = ${userId}
      `;
    } else { // superadmin
      statsArray = await prisma.$queryRaw`
        SELECT 
          COUNT(*)::int as total,
          COUNT(CASE WHEN disposition IS NULL OR disposition = '' THEN 1 END)::int as pending,
          COUNT(CASE WHEN disposition = 'Lead' AND status = 'Converted' THEN 1 END)::int as lead,
          COUNT(CASE WHEN disposition = 'Appointment' THEN 1 END)::int as appointment,
          COUNT(CASE WHEN disposition = 'CallBack' THEN 1 END)::int as callback,
          COUNT(CASE WHEN disposition = 'Invalid' THEN 1 END)::int as invalid,
          COUNT(CASE WHEN disposition IN ('HungUp', 'CallNotAnswered') AND rechurn_count >= 3 THEN 1 END)::int as hungup,
          COUNT(CASE WHEN disposition = 'DoNotCall' THEN 1 END)::int as donotcall,
          COALESCE(SUM(CASE WHEN disposition = 'Lead' AND status = 'Converted' THEN lead_amount END), 0)::float as totalleadamount,
          COUNT(CASE WHEN disposition = 'Lead' THEN 1 END)::int as alllead,
          COALESCE(SUM(CASE WHEN disposition = 'Lead' THEN lead_amount END), 0)::float as allleadamount
        FROM contacts
        WHERE is_deleted = false
      `;
    }

    const s = statsArray[0] || {};
    const totalAdmins = await prisma.user.count({ where: { role: 'admin', isDeleted: false } });

    res.json({
      total: s.total || 0,
      pending: s.pending || 0,
      lead: s.lead || 0,
      appointment: s.appointment || 0,
      callBack: s.callback || 0,
      invalid: s.invalid || 0,
      hungUp: s.hungup || 0,
      doNotCall: s.donotcall || 0,
      totalLeadAmount: s.totalleadamount || 0,
      totalAdmins,
      allLead: s.alllead || 0,
      allLeadAmount: s.allleadamount || 0
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
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

    const rawQueues = await prisma.$queryRawUnsafe(`
      SELECT 
        assigned_to as "agentId",
        COUNT(*)::int as total,
        COUNT(CASE WHEN disposition IS NULL OR disposition = '' THEN 1 END)::int as pending,
        COUNT(CASE WHEN disposition = 'Lead' AND status = 'Converted' THEN 1 END)::int as lead,
        COUNT(CASE WHEN disposition = 'Appointment' THEN 1 END)::int as appointment,
        COALESCE(SUM(CASE WHEN disposition = 'Lead' AND status = 'Converted' THEN lead_amount END), 0)::float as "totalLeadAmount"
      FROM contacts
      WHERE is_deleted = false AND assigned_to IN (${agentIds.map(id => `'${id}'`).join(',')})
      GROUP BY assigned_to
    `);

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
      contact = await prisma.contact.findFirst({
        where: { id: req.query.contactId, assignedTo: agentId, isDeleted: false }
      });
    }
    
    if (!contact) {
      const dueCallbacks = await prisma.contact.findMany({
        where: { assignedTo: agentId, disposition: 'CallBack', callBackDt: { lte: now }, queueOrder: { lt: 999999 }, isDeleted: false },
        orderBy: { callBackDt: 'asc' }, take: 1
      });
      
      if (dueCallbacks.length > 0) {
        contact = dueCallbacks[0];
        await prisma.contact.update({ where: { id: contact.id }, data: { queueOrder: 0, callBackDt: null } });
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
    const update = { status: status || contact.status };

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
      update.disposition = 'CallBack';
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
      await prisma.callback.create({
        data: {
          contactId: contact.id, fields: contact.fields || {}, batchId: contact.batchId,
          assignedTo: contact.assignedTo, agentName: contact.agentName || req.user.name,
          callBackDt: update.callBackDt, remarks: remarks || 'Status updated to Call Back',
          adminId: contact.adminId, source: 'lead'
        }
      });
      
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
      queueOrder: 0
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

    const [rawContacts, rawLeads, rawCallbacks, rawAppointments, allUsers] = await Promise.all([
      prisma.contact.findMany({
        select: {
          id: true, fields: true, remarks: true, status: true, disposition: true,
          leadAmount: true, transactionId: true, createdAt: true, disposedAt: true,
          lastModified: true, assignedTo: true, agentName: true, conversionDate: true
        }
      }),
      prisma.lead.findMany({
        select: {
          id: true, contactId: true, fields: true, remarks: true, status: true,
          leadAmount: true, transactionId: true, createdAt: true, lastModified: true,
          assignedTo: true, agentName: true
        }
      }),
      prisma.callback.findMany({
        select: {
          id: true, contactId: true, fields: true, remarks: true, callBackDt: true,
          createdAt: true, assignedTo: true, agentName: true
        }
      }),
      prisma.appointment.findMany({
        select: {
          id: true, contactId: true, fields: true, remarks: true, appointmentDt: true,
          createdAt: true, assignedTo: true, agentName: true
        }
      }),
      prisma.user.findMany({
        select: { id: true, name: true, username: true }
      })
    ]);

    const userMap = {};
    allUsers.forEach(u => {
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
    const seenConvertedKeys = new Set();

    matchingLeads.forEach(l => {
      if (l.status === 'Converted') {
        const key = `${l.transactionId || ''}_${l.leadAmount || 0}_${new Date(l.createdAt).getTime()}`;
        if (!seenConvertedKeys.has(key)) {
          seenConvertedKeys.add(key);
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
      }
    });

    matchingContacts.forEach(c => {
      if (c.status === 'Converted' && c.disposition === 'Lead') {
        const key = `${c.transactionId || ''}_${c.leadAmount || 0}_${new Date(c.conversionDate || c.disposedAt || c.createdAt).getTime()}`;
        if (!seenConvertedKeys.has(key)) {
          seenConvertedKeys.add(key);
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
