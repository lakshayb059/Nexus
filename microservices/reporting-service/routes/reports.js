const router = require('express').Router();
const { getCollection } = require('../../shared/mongodb');
const { verify, authorize } = require('../../shared/authMiddleware');
const { ObjectId } = require('mongodb');
const XLSX = require('xlsx');

const DISP_LABELS = {
  Lead: 'Lead',
  Appointment: 'Appointment',
  CallNotAnswered: 'Call Not Answered',
  Invalid: 'Invalid / Wrong No.',
  DoNotCall: 'Do Not Call',
  CallBack: 'Call Back',
};

router.get('/download', verify, authorize(['admin', 'tl', 'agent']), async (req, res) => {
  try {
    const { format = 'csv', agentId, disposition, batchId, reportType } = req.query;
    const query = {};
    if (reportType === 'lead') query.disposition = 'Lead';
    else {
      if (disposition === 'pending') query.disposition = null;
      else if (disposition) query.disposition = disposition;
    }
    if (batchId) query.batchId = batchId;

    const usersCollection = getCollection('users');
    if (req.user.role === 'tl') {
      const agents = await usersCollection.find({ role: 'agent', tlId: new ObjectId(req.user._id) }).toArray();
      const agentIds = agents.map(a => a._id);
      if (agentId && agentIds.some(id => id.equals(new ObjectId(agentId)))) query.assignedTo = new ObjectId(agentId);
      else query.assignedTo = { $in: agentIds };
    } else if (req.user.role === 'agent') query.assignedTo = new ObjectId(req.user._id);
    else if (agentId) query.assignedTo = new ObjectId(agentId);

    const contactsCollection = getCollection('contacts');
    const contacts = await contactsCollection.find(query).sort({ assignedTo: 1, queueOrder: 1 }).toArray();

    const fieldCols = [...new Set(contacts.flatMap(c => Object.keys(c.fields || {})))];
    const userCache = {};
    const rows = await Promise.all(contacts.map(async c => {
      let agentName = 'Unknown';
      if (c.assignedTo) {
        if (!userCache[c.assignedTo]) userCache[c.assignedTo] = await usersCollection.findOne({ _id: new ObjectId(c.assignedTo) });
        agentName = userCache[c.assignedTo]?.name || 'Unknown';
      }
      const row = { 'Agent': agentName };
      fieldCols.forEach(col => { row[col] = c.fields?.[col] || ''; });
      row['Disposition'] = c.disposition ? (DISP_LABELS[c.disposition] || c.disposition) : 'Pending';
      row['Lead Amount'] = c.leadAmount || '';
      row['Lead Status'] = c.status || '';
      row['Other Remarks'] = c.statusDetails || '';
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
