const router = require('express').Router();
const { prisma } = require('../../shared/db');
const { authorize, verify } = require('../../shared/authMiddleware');
const { consolidateCallbacks, cleanupAllCallbacks, normalizePhone } = require('../../shared/callbackUtils');
const { broadcast } = require('../../shared/notificationClient');

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
    
    // JSON search might not be perfectly supported in Prisma without raw queries, doing our best here
    let whereQuery = await getAccessibleContactsQuery(req.user, filters);

    if (search && search.trim()) {
      // If search is provided, we must fetch all matching base filters and filter in-memory
      // since Prisma doesn't support full-text search across arbitrary JSON keys easily.
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

      const total = await prisma.contact.count({ where: whereQuery });
      let contacts = await prisma.contact.findMany({
        where: whereQuery,
        orderBy: { createdAt: 'desc' },
        skip: skipNum,
        take: limitNum
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
      let contacts = await prisma.contact.findMany({ where: whereQuery, orderBy: { createdAt: 'desc' } });
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

    if (disposition === 'Lead') {
      await prisma.lead.create({
        data: {
          contactId: req.params.id, fields: contact.fields || {}, batchId: contact.batchId,
          assignedTo: req.user._id || req.user.id, agentName: req.user.name,
          leadAmount: parseFloat(leadAmount) || 0, status: status || 'Pending',
          remarks: remarks || '',
          adminId: contact.adminId
        }
      });
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
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/notifications', verify, authorize(['superadmin', 'agent', 'tl', 'admin']), async (req, res) => {
  try {
    const now = new Date();
    const query = { assignedTo: req.user._id || req.user.id, isDeleted: false };
    const notifications = [];

    const pastDueCallbacks = await prisma.contact.findMany({
      where: { ...query, disposition: 'CallBack', callBackDt: { lt: now } },
      orderBy: { callBackDt: 'desc' }, take: 10
    });
    pastDueCallbacks.forEach(c => {
      notifications.push({
        type: 'callback', title: 'Callback Past Due',
        message: `Callback for ${(c.fields || {}).Name || (c.fields || {}).name || 'Unknown'} was due at ${c.callBackDt ? new Date(c.callBackDt).toLocaleString() : ''}`,
        path: `/workflow/${c.id}`
      });
    });

    const pastDueAppointments = await prisma.contact.findMany({
      where: { ...query, disposition: 'Appointment', appointmentDt: { lt: now } },
      orderBy: { appointmentDt: 'desc' }, take: 10
    });
    pastDueAppointments.forEach(c => {
      notifications.push({
        type: 'appointment', title: 'Appointment Past Due',
        message: `Appointment for ${(c.fields || {}).Name || (c.fields || {}).name || 'Unknown'} was due at ${c.appointmentDt ? new Date(c.appointmentDt).toLocaleString() : ''}`,
        path: `/workflow/${c.id}`
      });
    });

    res.json(notifications);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/admin-stats', verify, authorize(['superadmin']), async (req, res) => {
  try {
    const admins = await prisma.user.findMany({ where: { role: 'admin', isDeleted: false } });
    const stats = await Promise.all(admins.map(async (a) => {
      const q = { adminId: a.id, isDeleted: false };
      const [leads, appointments, callbacks, leadAgg] = await Promise.all([
        prisma.contact.count({ where: { ...q, disposition: 'Lead', status: 'Converted' } }),
        prisma.contact.count({ where: { ...q, disposition: 'Appointment' } }),
        prisma.contact.count({ where: { ...q, disposition: 'CallBack' } }),
        prisma.contact.aggregate({ where: { ...q, disposition: 'Lead', status: 'Converted' }, _sum: { leadAmount: true } })
      ]);
      return {
        adminId: a.id,
        name: a.name,
        username: a.username,
        leads,
        appointments,
        callbacks,
        totalLeadAmount: leadAgg._sum.leadAmount || 0
      };
    }));
    res.json(stats);
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: 'Failed to fetch admin stats' });
  }
});

router.get('/stats', verify, authorize(['superadmin', 'agent', 'tl', 'admin']), async (req, res) => {
  try {
    const query = { isDeleted: false };
    if (req.user.role === 'agent') {
      query.assignedTo = req.user._id || req.user.id;
    } else if (req.user.role === 'tl') {
      const agents = await prisma.user.findMany({ where: { tlId: req.user._id || req.user.id } });
      query.assignedTo = { in: agents.map(a => a.id) };
    } else if (req.user.role === 'admin') {
      query.adminId = req.user._id || req.user.id;
    }

    // Prisma doesn't do conditional aggregation well without raw SQL
    // Doing multi-count fallback
    const [total, pending, lead, appointment, callBack, invalid, hungUp, doNotCall, leadAgg, totalAdmins, allLead, allLeadAgg] = await Promise.all([
      prisma.contact.count({ where: query }),
      prisma.contact.count({ where: { ...query, OR: [{ disposition: null }, { disposition: '' }] } }),
      prisma.contact.count({ where: { ...query, disposition: 'Lead', status: 'Converted' } }),
      prisma.contact.count({ where: { ...query, disposition: 'Appointment' } }),
      prisma.contact.count({ where: { ...query, disposition: 'CallBack' } }),
      prisma.contact.count({ where: { ...query, disposition: 'Invalid' } }),
      prisma.contact.count({ where: { ...query, disposition: { in: ['HungUp', 'CallNotAnswered'] }, rechurnCount: { gte: 3 } } }),
      prisma.contact.count({ where: { ...query, disposition: 'DoNotCall' } }),
      prisma.contact.aggregate({ where: { ...query, disposition: 'Lead', status: 'Converted' }, _sum: { leadAmount: true } }),
      prisma.user.count({ where: { role: 'admin', isDeleted: false } }),
      prisma.contact.count({ where: { ...query, disposition: 'Lead' } }),
      prisma.contact.aggregate({ where: { ...query, disposition: 'Lead' }, _sum: { leadAmount: true } })
    ]);

    const result = {
      total, pending, lead, appointment, callBack, invalid, hungUp, doNotCall,
      totalLeadAmount: leadAgg._sum.leadAmount || 0, totalAdmins,
      allLead, allLeadAmount: allLeadAgg._sum.leadAmount || 0
    };
    res.json(result);
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
    
    // Simplistic queue fetching since we don't have raw aggregate easily typed
    const result = await Promise.all(agents.map(async (a) => {
      const q = { assignedTo: a.id, isDeleted: false };
      const [total, pending, lead, appointment, agg] = await Promise.all([
        prisma.contact.count({ where: q }),
        prisma.contact.count({ where: { ...q, OR: [{ disposition: null }, { disposition: '' }] } }),
        prisma.contact.count({ where: { ...q, disposition: 'Lead', status: 'Converted' } }),
        prisma.contact.count({ where: { ...q, disposition: 'Appointment' } }),
        prisma.contact.aggregate({ where: { ...q, disposition: 'Lead', status: 'Converted' }, _sum: { leadAmount: true } })
      ]);
      let tlName = '—';
      if (a.tlId) {
        const tl = await prisma.user.findUnique({ where: { id: a.tlId } });
        if (tl) tlName = tl.name;
      }
      return {
        agent: { _id: a.id, name: a.name },
        tlName, active: a.active,
        total, pending, lead, appointment, disposed: total - pending,
        totalLeadAmount: agg._sum.leadAmount || 0
      };
    }));

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
      
      await prisma.lead.deleteMany({ where: { contactId: contact.id } });
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

      await prisma.lead.deleteMany({ where: { contactId: contact.id } });
      await prisma.lead.create({
        data: {
          contactId: contact.id, fields: contact.fields || {}, batchId: contact.batchId,
          assignedTo: contact.assignedTo, agentName: contact.agentName || req.user.name,
          leadAmount: update.leadAmount, status: 'Lead', adminId: contact.adminId
        }
      });
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



module.exports = router;
