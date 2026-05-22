const router = require('express').Router();
const { prisma } = require('../../shared/db');
const { verify, authorize } = require('../../shared/authMiddleware');
const XLSX = require('xlsx');

const DISP_LABELS = {
  Lead: 'Lead',
  Appointment: 'Appointment',
  CallNotAnswered: 'Call Not Answered',
  Invalid: 'Invalid / Wrong No.',
  DoNotCall: 'Do Not Call',
  CallBack: 'Call Back',
};

router.get('/download', verify, authorize(['superadmin', 'admin', 'tl', 'agent']), async (req, res) => {
  try {
    const { format = 'csv', agentId, disposition, batchId, reportType } = req.query;
    let where = { isDeleted: false };
    
    if (reportType === 'lead') where.disposition = 'Lead';
    else {
      if (disposition === 'pending') where.disposition = null;
      else if (disposition) where.disposition = disposition;
    }
    if (batchId) where.batchId = batchId;

    if (req.user.role === 'tl') {
      const agents = await prisma.user.findMany({ where: { role: 'agent', tlId: req.user._id || req.user.id } });
      const agentIds = agents.map(a => a.id);
      if (agentId && agentIds.includes(agentId)) {
        where.assignedTo = agentId;
      } else {
        where.assignedTo = { in: agentIds };
      }
    } else if (req.user.role === 'agent') {
      where.assignedTo = req.user._id || req.user.id;
    } else if (req.user.role === 'admin') {
      where.adminId = req.user._id || req.user.id;
      if (agentId) where.assignedTo = agentId;
    } else if (req.user.role === 'superadmin') {
      if (agentId) where.assignedTo = agentId;
    }

    const contacts = await prisma.contact.findMany({
      where,
      orderBy: [
        { assignedTo: 'asc' },
        { queueOrder: 'asc' }
      ]
    });

    const fieldCols = [...new Set(contacts.flatMap(c => Object.keys(c.fields || {})))];
    const userCache = {};
    const rows = await Promise.all(contacts.map(async c => {
      let agentName = 'Unknown';
      if (c.assignedTo) {
        if (!userCache[c.assignedTo]) {
          userCache[c.assignedTo] = await prisma.user.findUnique({ where: { id: c.assignedTo } });
        }
        agentName = userCache[c.assignedTo]?.name || 'Unknown';
      }
      const row = { 'Agent': agentName };
      fieldCols.forEach(col => { row[col] = c.fields?.[col] || ''; });
      row['Disposition'] = c.disposition ? (DISP_LABELS[c.disposition] || c.disposition) : 'Pending';
      row['Lead Amount'] = c.leadAmount || '';
      row['Lead Status'] = c.status || '';
      row['Other Remarks'] = c.remarks || ''; // Map statusDetails/remarks appropriately
      row['Agent Remarks'] = c.remarks || '';
      row['Appointment Date & Time'] = c.appointmentDt ? new Date(c.appointmentDt).toLocaleString('en-IN') : '';
      row['Last Modified'] = c.lastModified ? new Date(c.lastModified).toLocaleString('en-IN') : '';
      return row;
    }));

    if (format === 'xlsx') {
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'CRM Report');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="crm_report_${Date.now()}.xlsx"`);
      return res.send(buf);
    }

    const headers = rows.length ? Object.keys(rows[0]) : [];
    const escape = v => {
      const s = String(v ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const csv = [headers.map(escape).join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n');
    res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="crm_report_${Date.now()}.csv"` });
    return res.send(csv);
  } catch (err) { res.status(500).json({ error: 'Report generation failed' }); }
});

module.exports = router;
