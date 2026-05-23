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
    const { format = 'csv', agentId, disposition, batchId, reportType, fromDate, toDate } = req.query;
    let where = { isDeleted: false };
    
    if (reportType === 'lead') where.disposition = 'Lead';
    else if (reportType === 'converted') {
      where.status = 'Converted';
      if (fromDate && toDate) {
        where.createdAt = {
          gte: new Date(fromDate),
          lte: new Date(new Date(toDate).setHours(23, 59, 59, 999))
        };
      }
    }
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
    const rows = await Promise.all(contacts.map(async (c, index) => {
      let agentName = 'Unknown';
      if (c.assignedTo) {
        if (!userCache[c.assignedTo]) {
          userCache[c.assignedTo] = await prisma.user.findUnique({ where: { id: c.assignedTo } });
        }
        agentName = userCache[c.assignedTo]?.name || 'Unknown';
      }

      if (reportType === 'converted') {
        const leadDate = c.createdAt ? new Date(c.createdAt) : new Date();
        const yy = String(leadDate.getFullYear()).slice(-2);
        const mm = String(leadDate.getMonth() + 1).padStart(2, '0');
        const seq = String(index + 1).padStart(3, '0');
        const slNo = `SS${yy}${mm}-${seq}`;
        
        const f = c.fields || {};
        const name = f.Name || f.name || f['Full Name'] || '';
        const phone = f.Phone || f.phone || f.Mobile || '';
        const email = f.Email || f.email || '';
        const address = f.Address || f.address || '';
        const area = f.Area || f.area || '';
        const pincode = f.Pincode || f.pincode || '';
        
        let txId = '';
        if (c.remarks && c.remarks.includes('Transaction ID:')) {
           const match = c.remarks.match(/Transaction ID:\s*([^\s)]+)/);
           if (match) txId = match[1];
        }
        
        const txDate = c.lastModified ? new Date(c.lastModified).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }).replace(/ /g, '-') : '';

        return {
          'Sl No': slNo,
          'Donor Title (Mr/Ms/Mrs/Firm)': 'Mr.',
          'Full Name As per PAN Card(Mandatory)': name,
          'Address (Mandatory)': address,
          'Area': area,
          'Pincode': pincode,
          'Mobile No (Mandatory)': phone,
          'Email ID ( Mandatory)': email,
          'Amount': c.leadAmount || '',
          'Transaction No / Cheque No': '',
          'Updated Transaction No': txId,
          'Transaction / Cheque Date': txDate,
          'Bank Name': '',
          'Mode Of Payment': 'Online',
          'Deposit Date': '',
          'BANK NAME': '',
          'Remarks': c.remarks || '',
          'BC': '',
          'BC DATE': '',
          'TALLY': 'Y',
          'BANK': '',
          'Acquisition': '',
          'Retention': '',
          '80G': '',
          'Agent': agentName,
          'Status': 'Confirmed'
        };
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
