const router = require('express').Router();
const multer = require('multer');
const csvSync = require('csv-parse/sync');
const XLSX = require('xlsx');
const { getCollection } = require('../mongodb');
const { authorize, verify } = require('../middleware/auth');
const { ObjectId } = require('mongodb');

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
router.post('/', verify, authorize(['admin', 'tl']), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { agentId, batchName } = req.body;
    if (!agentId) return res.status(400).json({ error: 'Agent ID required' });

    const usersCollection = getCollection('users');
    const agent = await usersCollection.findOne({ _id: new ObjectId(agentId), role: { $in: ['agent', 'tl'] } });
    if (!agent) return res.status(404).json({ error: 'Assignee not found' });

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

    // Get current max queueOrder for agent
    const contactsCollection = getCollection('contacts');
    const existing = await contactsCollection.find({ 
      assignedTo: new ObjectId(agentId),
      queueOrder: { $lt: 999999 }
    }).sort({ queueOrder: -1 }).limit(1).toArray();
    let queueStart = existing.length ? (existing[0].queueOrder + 1) : 0;

    const contacts = records.map((row, i) => ({
      assignedTo: new ObjectId(agentId),
      uploadedBy: new ObjectId(req.user._id),
      batchId,
      fields: row,
      disposition: null,
      remarks: '',
      appointmentDt: null,
      lastModified: now,
      createdAt: now,
      queueOrder: queueStart + i,
    }));

    await contactsCollection.insertMany(contacts);

    const batchesCollection = getCollection('batches');
    await batchesCollection.insertOne({
      _id: batchId,
      name: batchName || `Upload - ${new Date().toLocaleDateString('en-IN')}`,
      uploadedBy: new ObjectId(req.user._id),
      uploadedAt: new Date(now),
      columns,
      totalContacts: contacts.length,
      agentId: new ObjectId(agentId),
      agentName: agent.name,
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
      agentName: agent.name,
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
    const validFormats = ['csv', 'xlsx', 'xls'];
    if (!validFormats.includes(format)) {
      return res.status(400).json({ error: 'Invalid format. Use csv, xlsx, or xls' });
    }

    // Template structure with headers and sample data (Meesho-style template)
    const templateData = [
      {
        'Name': 'John Doe',
        'Phone': '9876543210',
        'Email': 'john.doe@example.com',
        'Company': 'Tech Solutions Ltd',
        'City': 'Mumbai',
        'State': 'Maharashtra',
        'Product': 'Premium Package',
        'Budget': '50000',
        'Source': 'Website',
        'Status': 'Hot Lead',
        'Notes': 'Interested in premium features'
      },
      {
        'Name': 'Jane Smith',
        'Phone': '9123456789',
        'Email': 'jane.smith@company.com',
        'Company': 'Global Industries',
        'City': 'Bangalore',
        'State': 'Karnataka',
        'Product': 'Basic Package',
        'Budget': '25000',
        'Source': 'Referral',
        'Status': 'Warm Lead',
        'Notes': 'Follow up next week'
      },
      {
        'Name': 'Rahul Kumar',
        'Phone': '8899776655',
        'Email': 'rahul.k@startup.in',
        'Company': 'Startup Hub',
        'City': 'Delhi',
        'State': 'Delhi',
        'Product': 'Enterprise Solution',
        'Budget': '100000',
        'Source': 'Cold Call',
        'Status': 'New Lead',
        'Notes': 'Decision maker, schedule demo'
      }
    ];

    const headers = Object.keys(templateData[0]);
    
    if (format === 'csv') {
      const csvContent = [
        headers.join(','),
        ...templateData.map(row => headers.map(h => `"${row[h]}"`).join(','))
      ].join('\n');
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="crm-template-${Date.now()}.csv"`);
      res.send(csvContent);
    } else {
      // Excel format (XLSX/XLS)
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(templateData);
      
      // Add column width for better readability
      const colWidths = headers.map(() => ({ wch: 15 }));
      ws['!cols'] = colWidths;
      
      XLSX.utils.book_append_sheet(wb, ws, 'CRM Template');
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: format === 'xls' ? 'xls' : 'xlsx' });
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="crm-template-${Date.now()}.${format}"`);
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
