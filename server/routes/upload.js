const router = require('express').Router();
const multer = require('multer');
const csvSync = require('csv-parse/sync');
const XLSX = require('xlsx');
const { getCollection } = require('../mongodb');
const { authorize, verify } = require('../middleware/auth');
const { ObjectId } = require('mongodb');
const { normalizePhone } = require('../utils/callbackUtils');

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['text/csv', 'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain'];
    if (allowed.includes(file.mimetype) ||
        file.originalname.match(/\.(csv|xlsx|xls)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files allowed'));
    }
  }
});

function parseCSV(buffer) {
  const text = buffer.toString('utf-8');
  const records = csvSync.parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });
  return records;
}

function parseExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

// POST /upload
router.post('/', verify, authorize(['admin', 'tl', 'agent']), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { agentId, batchName, isLeadUpload } = req.body;
    if (!agentId) return res.status(400).json({ error: 'Agent ID required' });

    const usersCollection = getCollection('users');
    let selectedAgent = null;
    
    // Validate the main agentId if it's not "multi"
    if (agentId !== 'multi') {
      if (!ObjectId.isValid(agentId)) {
        return res.status(400).json({ error: 'Invalid Agent ID selected' });
      }
      selectedAgent = await usersCollection.findOne({ _id: new ObjectId(agentId), role: { $in: ['agent', 'tl'] } });
      if (!selectedAgent) return res.status(404).json({ error: 'Selected agent not found' });
    }

    let records;
    const fname = req.file.originalname.toLowerCase();
    if (fname.endsWith('.xlsx') || fname.endsWith('.xls')) {
      records = parseExcel(req.file.buffer);
    } else {
      records = parseCSV(req.file.buffer);
    }

    if (!records.length) return res.status(400).json({ error: 'No records found in file' });

    const columns = Object.keys(records[0]);
    const batchId = 'batch_' + Date.now();
    const now = new Date().toISOString();

    // Map of agent names/IDs to their ObjectIds
    const allAgents = await usersCollection.find({ role: { $in: ['agent', 'tl'] } }).toArray();
    const agentMap = {};
    for (const a of allAgents) {
      if (a.name) {
        agentMap[a.name.toLowerCase()] = a._id;
      }
      agentMap[a._id.toString()] = a._id;
    }

    const contactsCollection = getCollection('contacts');
    const leadsCollection = getCollection('leads');
    const queueStarts = {};

    // Duplicate Check Logic (Admin only, Lead upload only)
    if (req.user.role === 'admin' && (isLeadUpload === 'true' || isLeadUpload === true)) {
      const phonesToCheck = records.map(r => {
        const p = r.Phone || r.phone || r.Mobile || r.MOBILE || r.PHONE;
        return normalizePhone(p);
      }).filter(Boolean);

      if (phonesToCheck.length > 0) {
        const duplicatePhones = [];
        // Check in batches of 50 to avoid massive $or queries or slow loops
        for (let i = 0; i < phonesToCheck.length; i += 50) {
          const batch = phonesToCheck.slice(i, i + 50);
          const orConditions = batch.flatMap(phone => [
            { "fields.Phone": { $regex: new RegExp(phone + '$') } },
            { "fields.phone": { $regex: new RegExp(phone + '$') } },
            { "fields.Mobile": { $regex: new RegExp(phone + '$') } },
            { "fields.MOBILE": { $regex: new RegExp(phone + '$') } },
            { "fields.PHONE": { $regex: new RegExp(phone + '$') } }
          ]);

          const existing = await leadsCollection.find({ $or: orConditions }).toArray();
          if (existing.length > 0) {
            existing.forEach(e => {
              const ep = normalizePhone(e.fields?.Phone || e.fields?.phone || e.fields?.Mobile || e.fields?.MOBILE || e.fields?.PHONE);
              if (batch.includes(ep) && !duplicatePhones.includes(ep)) {
                duplicatePhones.push(ep);
              }
            });
          }
        }

        if (duplicatePhones.length > 0) {
          return res.status(400).json({ 
            error: `Duplicate leads detected! The following phone numbers already exist in the system: ${duplicatePhones.join(', ')}. Please remove them and try again.` 
          });
        }
      }
    }
    
    const getNextQueueOrder = async (assignedId) => {
      const idStr = assignedId.toString();
      if (queueStarts[idStr] !== undefined) {
        return queueStarts[idStr]++;
      }
      const existing = await contactsCollection.find({ 
        assignedTo: assignedId,
        queueOrder: { $lt: 999999 }
      }).sort({ queueOrder: -1 }).limit(1).toArray();
      let start = existing.length ? (existing[0].queueOrder + 1) : 0;
      queueStarts[idStr] = start + 1;
      return start;
    };

    const contacts = [];
    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      let rowAgentObjectId = null;

      // 1. Check if row has an Agent column
      const agentCol = Object.keys(row).find(k => {
        const kl = k.toLowerCase();
        return kl === 'agent' || kl === 'agent name' || kl === 'agent id' || kl === 'agent_id' || kl === 'agentid';
      });
      
      if (agentCol && row[agentCol]) {
        const val = row[agentCol].toString().trim().toLowerCase();
        if (agentMap[val]) {
          rowAgentObjectId = agentMap[val];
        } else if (ObjectId.isValid(row[agentCol].toString().trim())) {
          rowAgentObjectId = new ObjectId(row[agentCol].toString().trim());
        }
      }

      // 2. Fallback to the dropdown agent if row agent is missing
      if (!rowAgentObjectId) {
        if (agentId === 'multi') {
          return res.status(400).json({ 
            error: `Row ${i + 1} (${row.Name || row.name || 'Unknown'}) is missing a valid Agent. Since you chose "Multi-Agents", every row must have an agent name or ID.` 
          });
        }
        rowAgentObjectId = new ObjectId(agentId);
      }

      let disposition = null;
      let queueOrder = await getNextQueueOrder(rowAgentObjectId);
      let leadAmount = null;
      let status = null;
      let statusDetails = null;
      let transactionId = null;
      let callBackDt = null;

      if (isLeadUpload === 'true' || isLeadUpload === true) {
        disposition = 'Lead';
        queueOrder = 999999;
        
        // Extract status from row
        const statusCol = Object.keys(row).find(k => k.toLowerCase() === 'status');
        if (statusCol) status = row[statusCol];

        // Map template status to DB status
        if (status === 'Converted') {
          const utrCol = Object.keys(row).find(k => k.toLowerCase().includes('utr') || k.toLowerCase().includes('transaction'));
          if (utrCol) transactionId = row[utrCol];
        } else if (status === 'Call Back') {
          const cbCol = Object.keys(row).find(k => k.toLowerCase().includes('callback') || k.toLowerCase().includes('date'));
          if (cbCol && row[cbCol]) {
            try { callBackDt = new Date(row[cbCol]).toISOString(); } catch(e) {}
          }
        } else if (status === 'Others') {
          const detCol = Object.keys(row).find(k => k.toLowerCase().includes('detail') || k.toLowerCase().includes('info'));
          if (detCol) statusDetails = row[detCol];
        }

        const amountCol = Object.keys(row).find(k => k.toLowerCase().includes('amount') || k.toLowerCase() === 'revenue');
        if (amountCol) {
          leadAmount = parseFloat(row[amountCol]) || null;
        }
      }

      const contactData = {
        assignedTo: rowAgentObjectId,
        uploadedBy: new ObjectId(req.user._id),
        batchId,
        fields: row,
        disposition,
        leadAmount,
        status,
        statusDetails,
        transactionId,
        callBackDt,
        remarks: row.Remarks || row.remarks || '',
        appointmentDt: null,
        lastModified: now,
        createdAt: now,
        queueOrder,
      };

      contacts.push(contactData);
    }

    const insertResult = await contactsCollection.insertMany(contacts);

    // If it's a lead upload, also insert into the leads collection
    if (isLeadUpload === 'true' || isLeadUpload === true) {
      const leads = contacts.map((c, index) => {
        const contactId = insertResult.insertedIds[index];
        // Get agent name for the lead record
        let agentName = 'Unknown';
        const agentIdStr = c.assignedTo.toString();
        const agentObj = allAgents.find(a => a._id.toString() === agentIdStr);
        if (agentObj) agentName = agentObj.name;

        return {
          contactId,
          fields: c.fields,
          batchId: c.batchId,
          assignedTo: c.assignedTo,
          agentName: agentName,
          leadAmount: c.leadAmount || 0,
          status: c.status || 'Pending',
          statusDetails: c.statusDetails || '',
          transactionId: c.transactionId || '',
          remarks: c.remarks || '[Uploaded via Excel]',
          callBackDt: c.callBackDt,
          appointmentDt: null,
          createdAt: new Date(now),
          lastModified: new Date(now)
        };
      });
      await leadsCollection.insertMany(leads);
    }

    const batchesCollection = getCollection('batches');
    await batchesCollection.insertOne({
      _id: batchId,
      name: batchName || `Upload - ${new Date().toLocaleDateString('en-IN')}`,
      uploadedBy: new ObjectId(req.user._id),
      uploadedAt: new Date(now),
      columns,
      totalContacts: contacts.length,
      agentId: agentId === 'multi' ? null : new ObjectId(agentId),
      agentName: agentId === 'multi' ? 'Multi-Agents' : (selectedAgent?.name || 'Unknown'),
      fileName: req.file.originalname,
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('batch_uploaded', { batchId, agentId, totalUploaded: contacts.length });
    }

    res.json({
      success: true,
      batchId,
      totalUploaded: contacts.length,
      columns,
      agentName: agentId === 'multi' ? 'Multi-Agents' : (selectedAgent?.name || 'Unknown'),
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// GET /upload/template
router.get('/template', verify, authorize(['admin', 'tl']), async (req, res) => {
  try {
    const { format = 'csv' } = req.query;
    
    // Detailed template with sample data for different statuses
    const templateData = [
      {
        'Name': 'John Smith (Converted)',
        'Agent': 'Abhishek',
        'Phone': '9876543210',
        'Status': 'Converted',
        'Amount': '5000',
        'Transaction ID / UTR': 'TRX123456789',
        'Callback Date': '',
        'Status Details': '',
        'Remarks': 'Successfully converted lead'
      },
      {
        'Name': 'Jane Doe (Callback)',
        'Agent': 'Abhishek',
        'Phone': '8877665544',
        'Status': 'Call Back',
        'Amount': '',
        'Transaction ID / UTR': '',
        'Callback Date': new Date(Date.now() + 86400000).toISOString().slice(0, 16),
        'Status Details': '',
        'Remarks': 'Interested but busy, call tomorrow'
      },
      {
        'Name': 'Robert Fox (Others)',
        'Agent': 'Abhishek',
        'Phone': '7766554433',
        'Status': 'Others',
        'Amount': '',
        'Transaction ID / UTR': '',
        'Callback Date': '',
        'Status Details': 'Needs special approval',
        'Remarks': 'Waiting for manager approval'
      }
    ];

    const headers = Object.keys(templateData[0]);
    
    if (format === 'csv') {
      const csvContent = [
        headers.join(','),
        ...templateData.map(row => headers.map(h => `"${row[h] || ''}"`).join(','))
      ].join('\n');
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="crm-leads-template-${Date.now()}.csv"`);
      res.send(csvContent);
    } else {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(templateData);
      
      // Auto-size columns
      ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length, 20) }));
      
      XLSX.utils.book_append_sheet(wb, ws, 'Leads Template');

      // Add Comprehensive Reference Sheet (Agents + Statuses)
      const usersCollection = getCollection('users');
      let agentsList = [];
      if (req.user.role === 'admin') {
        agentsList = await usersCollection.find({ role: 'agent' }).toArray();
      } else if (req.user.role === 'tl') {
        agentsList = await usersCollection.find({ role: 'agent', tlId: new ObjectId(req.user._id) }).toArray();
      }

      // Combine Agents and Status Info into one Reference Sheet
      const referenceData = [
        ['--- ACTIVE AGENTS ---', '', ''],
        ['Agent Name', 'Username', 'Status'],
        ...agentsList.map(a => [a.name, a.username, a.active ? 'Active' : 'Inactive']),
        ['', '', ''],
        ['--- LEAD STATUS OPTIONS ---', '', ''],
        ['Status Option', 'Required Additional Info', 'Instructions / Info'],
        ['Converted', 'Transaction ID / UTR', 'MUST enter valid payment ID and Amount'],
        ['Call Back', 'Callback Date', 'Format: YYYY-MM-DD HH:MM (e.g. 2026-05-10 14:00)'],
        ['Others', 'Status Details', 'Options: Language Barrier, Already Using Competitor, Price Too High, Not Eligible, Wrong Number, Busy/No Answer, Invalid Profile, Customer Request Close, Follow up Needed, Other Reason'],
        ['Not Interested', 'None', 'Standard rejection - no extra info needed'],
        ['DNC/DND', 'None', 'Permanently remove from calling queue'],
        ['Lead', 'None', 'Initial interest - moves to My Leads queue']
      ];

      const wsRef = XLSX.utils.aoa_to_sheet(referenceData);
      wsRef['!cols'] = [{ wch: 30 }, { wch: 30 }, { wch: 45 }];
      
      XLSX.utils.book_append_sheet(wb, wsRef, 'Agents & Status Info');

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: format === 'xls' ? 'xls' : 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="crm-leads-template-${Date.now()}.${format}"`);
      res.send(buffer);
    }
  } catch (err) {
    console.error('Template generation error:', err);
    res.status(500).json({ error: 'Template generation failed' });
  }
});

// GET /upload/batches
router.get('/batches', verify, authorize(['admin', 'tl']), async (req, res) => {
  try {
    const batchesCollection = getCollection('batches');
    const usersCollection = getCollection('users');
    
    let batches;
    if (req.user.role === 'admin') {
      batches = await batchesCollection.find({}).sort({ uploadedAt: -1 }).toArray();
    } else if (req.user.role === 'tl') {
      const tlId = new ObjectId(req.user._id);
      const agents = await usersCollection.find({ role: 'agent', tlId }).toArray();
      const agentIds = agents.map(a => a._id);
      batches = await batchesCollection.find({ 
        $or: [
          { uploadedBy: tlId },
          { agentId: { $in: agentIds } }
        ] 
      }).sort({ uploadedAt: -1 }).toArray();
    }
    
    const enriched = await Promise.all(batches.map(async b => {
      const uploader = await usersCollection.findOne({ _id: new ObjectId(b.uploadedBy) }, { projection: { password: 0 } });
      return { ...b, uploaderName: uploader?.name || 'Unknown' };
    }));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
