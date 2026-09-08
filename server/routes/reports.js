const router = require('express').Router();
const { prisma } = require('../shared/db');
const { verify, authorize } = require('../shared/authMiddleware');
const XLSX = require('xlsx');

const DISP_LABELS = {
  Lead: 'Lead',
  Appointment: 'Appointment',
  CallNotAnswered: 'Call Not Answered',
  Invalid: 'Invalid / Wrong No.',
  DoNotCall: 'Do Not Call',
  CallBack: 'Call Back',
  NotInterested: 'Not Interested',
  LanguageBarrier: 'Language Barrier',
};

router.get('/download', verify, authorize(['superadmin', 'admin', 'tl', 'agent']), async (req, res) => {
  try {
    const { format = 'csv', agentId, disposition, batchId, reportType, fromDate, toDate } = req.query;

    if (reportType === 'agent-log') {
      const logWhere = {};
      if (fromDate && toDate) {
        logWhere.loginAt = {
          gte: new Date(fromDate),
          lte: new Date(new Date(toDate).setHours(23, 59, 59, 999))
        };
      }

      if (req.user.role === 'agent') {
        logWhere.userId = req.user._id || req.user.id;
      } else if (req.user.role === 'tl') {
        const agents = await prisma.user.findMany({ where: { role: 'agent', tlId: req.user._id || req.user.id } });
        const agentIds = agents.map(a => a.id);
        if (agentId && agentIds.includes(agentId)) {
          logWhere.userId = agentId;
        } else {
          logWhere.userId = { in: agentIds };
        }
      } else if (req.user.role === 'admin') {
        const agents = await prisma.user.findMany({ where: { role: 'agent', adminId: req.user._id || req.user.id } });
        const agentIds = agents.map(a => a.id);
        if (agentId && agentIds.includes(agentId)) {
          logWhere.userId = agentId;
        } else {
          logWhere.userId = { in: agentIds };
        }
      } else if (req.user.role === 'superadmin') {
        if (agentId) {
          logWhere.userId = agentId;
        }
      }

      const logs = await prisma.agentWorkLog.findMany({
        where: logWhere,
        include: {
          user: {
            select: {
              name: true,
              username: true,
              tlId: true
            }
          }
        },
        orderBy: {
          loginAt: 'desc'
        }
      });

      const tlIds = [...new Set(logs.map(l => l.user.tlId).filter(Boolean))];
      const tlsMap = {};
      if (tlIds.length > 0) {
        const tls = await prisma.user.findMany({
          where: { id: { in: tlIds } },
          select: { id: true, name: true }
        });
        tls.forEach(t => {
          tlsMap[t.id] = t.name;
        });
      }

      const formatSeconds = (secs) => {
        if (!secs || isNaN(secs)) return '00:00:00';
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = secs % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
      };

      const rows = logs.map((log, index) => {
        const totalBreakSeconds = log.lunchDuration + log.bioDuration + log.teaDuration;
        const totalSessionTime = log.logoutAt 
          ? Math.max(0, Math.floor((new Date(log.logoutAt) - new Date(log.loginAt)) / 1000))
          : Math.max(0, Math.floor((new Date(log.lastActiveAt) - new Date(log.loginAt)) / 1000));
        const computedWorkTime = Math.max(0, totalSessionTime - totalBreakSeconds);
        const actualWorkTime = log.logoutAt ? log.totalWorkTime : computedWorkTime;

        return {
          'S.No.': index + 1,
          'Agent Name': log.user.name || 'Unknown',
          'Username/Email': log.user.username || 'N/A',
          'Team Lead': log.user.tlId ? (tlsMap[log.user.tlId] || 'Unknown') : 'None',
          'Login Time': log.loginAt ? new Date(log.loginAt).toLocaleString('en-IN') : 'N/A',
          'Logout Time': log.logoutAt ? new Date(log.logoutAt).toLocaleString('en-IN') : 'Active Session',
          'Last Active At': log.lastActiveAt ? new Date(log.lastActiveAt).toLocaleString('en-IN') : 'N/A',
          'Session Duration': formatSeconds(totalSessionTime),
          'Work Time (HH:MM:SS)': formatSeconds(actualWorkTime),
          'Lunch Break Duration (HH:MM:SS)': formatSeconds(log.lunchDuration),
          'Bio Break Duration (HH:MM:SS)': formatSeconds(log.bioDuration),
          'Tea Break Duration (HH:MM:SS)': formatSeconds(log.teaDuration),
          'Total Break Duration (HH:MM:SS)': formatSeconds(totalBreakSeconds)
        };
      });

      if (format === 'xlsx') {
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Agent Logs Report');
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="agent_logs_report_${Date.now()}.xlsx"`);
        return res.send(buffer);
      }

      const headers = rows.length ? Object.keys(rows[0]) : [];
      const escape = v => {
        const s = String(v ?? '');
        if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };
      const csv = [headers.map(escape).join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n');
      res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="agent_logs_report_${Date.now()}.csv"` });
      return res.send(csv);
    }

    let where = { isDeleted: false };
    
    if (reportType === 'lead') {
      where.disposition = 'Lead';
      if (fromDate && toDate) {
        where.disposedAt = {
          gte: new Date(fromDate),
          lte: new Date(new Date(toDate).setHours(23, 59, 59, 999))
        };
      }
    } else if (reportType === 'converted') {
      where.status = 'Converted';
      if (fromDate && toDate) {
        const start = new Date(fromDate);
        const end = new Date(new Date(toDate).setHours(23, 59, 59, 999));
        where.OR = [
          { conversionDate: { gte: start, lte: end } },
          { conversionDate: null, disposedAt: { gte: start, lte: end } },
          { conversionDate: null, createdAt: { gte: start, lte: end } }
        ];
      }
    } else {
      if (disposition === 'pending') where.disposition = null;
      else if (disposition) where.disposition = disposition;

      if (fromDate && toDate) {
        const start = new Date(fromDate);
        const end = new Date(new Date(toDate).setHours(23, 59, 59, 999));
        where.OR = [
          { disposedAt: { gte: start, lte: end } },
          { disposition: null, createdAt: { gte: start, lte: end } },
          { disposition: '', createdAt: { gte: start, lte: end } }
        ];
      }
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
      ],
      take: 10000
    });

    const assignedUserIds = [...new Set(contacts.map(c => c.assignedTo).filter(Boolean))];
    const users = await prisma.user.findMany({
      where: { id: { in: assignedUserIds } },
      select: { id: true, name: true }
    });
    const userMap = {};
    users.forEach(u => {
      userMap[u.id] = u.name || 'Unknown';
    });

    const fieldCols = [...new Set(contacts.flatMap(c => Object.keys(c.fields || {})))];
    const rows = contacts.map((c, index) => {
      const agentName = c.assignedTo ? (userMap[c.assignedTo] || 'Unknown') : 'Unknown';

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
        const effectiveAmount = (c.isCharityConfirmed && c.charityAmount !== null && c.charityAmount !== undefined)
          ? c.charityAmount
          : (c.leadAmount || '');

        return {
          'Sl No': slNo,
          'Donor Title (Mr/Ms/Mrs/Firm)': 'Mr.',
          'Full Name As per PAN Card(Mandatory)': name,
          'Address (Mandatory)': address,
          'Area': area,
          'Pincode': pincode,
          'Mobile No (Mandatory)': phone,
          'Email ID ( Mandatory)': email,
          'Amount': effectiveAmount,
          'Agent Amount': c.leadAmount || '',
          'Charity Amount': c.charityAmount || '',
          'UTR-Internal': c.transactionId || '',
          'UTR-Charity': c.utrCharity || '',
          'Confirmed by Charity': c.isCharityConfirmed ? 'Yes' : 'No',
          'Charity Confirmed At': c.charityConfirmedAt ? new Date(c.charityConfirmedAt).toLocaleString('en-IN') : '',
          'Charity Confirmed By': c.charityConfirmedBy || '',
          'Transaction No / Cheque No': c.transactionId || '',
          'Updated Transaction No': c.utrCharity || txId,
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
      row['Lead Amount'] = (c.isCharityConfirmed && c.charityAmount !== null && c.charityAmount !== undefined)
        ? c.charityAmount
        : (c.leadAmount || '');
      row['Agent Amount'] = c.leadAmount || '';
      row['Charity Amount'] = c.charityAmount || '';
      row['UTR-Internal'] = c.transactionId || '';
      row['UTR-Charity'] = c.utrCharity || '';
      row['Confirmed by Charity'] = c.isCharityConfirmed ? 'Yes' : 'No';
      row['Lead Status'] = c.status || '';
      row['Other Remarks'] = c.remarks || '';
      row['Agent Remarks'] = c.remarks || '';
      row['Appointment Date & Time'] = c.appointmentDt ? new Date(c.appointmentDt).toLocaleString('en-IN') : '';
      row['Last Modified'] = c.lastModified ? new Date(c.lastModified).toLocaleString('en-IN') : '';
      return row;
    });

    if (format === 'xlsx') {
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'CRM Report');
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="crm_report_${Date.now()}.xlsx"`);
      return res.send(buffer);
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
