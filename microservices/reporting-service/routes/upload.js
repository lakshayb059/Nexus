const router = require('express').Router();
const multer = require('multer');
const csvSync = require('csv-parse/sync');
const XLSX = require('xlsx');
const { getCollection } = require('../../shared/mongodb');
const { authorize, verify } = require('../../shared/authMiddleware');
const { ObjectId } = require('mongodb');
const { normalizePhone } = require('../../shared/callbackUtils');
const { broadcast } = require('../../shared/notificationClient');

const upload = multer({ storage: multer.memoryStorage() });

function parseCSV(buffer) {
  return csvSync.parse(buffer.toString('utf-8'), { columns: true, skip_empty_lines: true, trim: true, bom: true, relax_column_count: true });
}

function parseExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

router.post('/', verify, authorize(['admin', 'tl', 'agent']), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { agentId, batchName, isLeadUpload } = req.body;
    if (!agentId) return res.status(400).json({ error: 'Agent ID required' });

    const usersCollection = getCollection('users');
    let selectedAgent = null;
    if (agentId !== 'multi') {
      selectedAgent = await usersCollection.findOne({ _id: new ObjectId(agentId) });
      if (!selectedAgent) return res.status(404).json({ error: 'Selected agent not found' });
      if (selectedAgent.active === false || selectedAgent.isDeleted) return res.status(400).json({ error: 'Selected agent is inactive or deleted' });
      if (selectedAgent.role === 'tl') return res.status(400).json({ error: 'Selected user is a Team Leader (only Agents can be assigned contacts)' });
    }

    let records = req.file.originalname.toLowerCase().endsWith('.xlsx') ? parseExcel(req.file.buffer) : parseCSV(req.file.buffer);
    if (!records.length) return res.status(400).json({ error: 'No records found' });

    const batchId = 'batch_' + Date.now();
    const contactsCollection = getCollection('contacts');
    const allUsers = await usersCollection.find({ role: { $in: ['agent', 'tl'] }, active: { $ne: false }, isDeleted: { $ne: true } }).toArray();
    const userMap = allUsers.reduce((acc, u) => { acc[u.name.toLowerCase()] = u; acc[u._id.toString()] = u; return acc; }, {});

    const isLead = String(isLeadUpload) === 'true';

    const contacts = [];
    const uploadErrors = [];

    records.forEach((row, index) => {
      let assignedId = selectedAgent?._id;
      const agentCol = Object.keys(row).find(k => k.toLowerCase().includes('agent'));
      
      let errorReason = null;

      if (agentId === 'multi') {
        if (agentCol && row[agentCol]) {
          const agentNameStr = row[agentCol].toString().toLowerCase().trim();
          const u = userMap[agentNameStr];
          if (u) {
            if (u.role === 'tl') {
              errorReason = `User '${row[agentCol]}' is a Team Leader (only Agents can be assigned contacts).`;
            } else {
              assignedId = u._id;
            }
          } else {
            errorReason = `Agent '${row[agentCol]}' not found or inactive.`;
          }
        } else {
          errorReason = 'Agent column missing or empty.';
        }
      }

      if (!assignedId && !errorReason) {
         errorReason = 'No valid agent assignment.';
      }

      if (errorReason) {
        uploadErrors.push({
          rowNumber: index + 2,
          name: row.Name || row.name || 'Unknown',
          phone: row.Phone || row.Mobile || row.phone || row.mobile || 'N/A',
          error: errorReason
        });
        return;
      }
      
      const contactDoc = {
        assignedTo: new ObjectId(assignedId),
        batchId,
        fields: row,
        createdAt: new Date(),
        lastModified: new Date(),
        isDeleted: false,
        disposition: isLead ? 'Lead' : null,
        queueOrder: 0
      };

      if (isLead) {
        contactDoc.status = row.Status || row.status || 'Converted';
        contactDoc.leadAmount = Number(row.LeadAmount || row.leadAmount || row.Amount || 0);
        contactDoc.transactionId = row.TransactionId || row.transactionId || '';
        contactDoc.remarks = row.Remarks || row.remarks || 'Uploaded via Lead Template';
      }

      contacts.push(contactDoc);
    });

    if (contacts.length === 0) {
      if (uploadErrors.length > 0) {
        return res.status(400).json({ success: false, error: 'All records failed to upload.', totalUploaded: 0, totalFailed: uploadErrors.length, uploadErrors });
      }
      return res.status(400).json({ error: 'No valid assignments could be created from the uploaded file.' });
    }

    await contactsCollection.insertMany(contacts);
    
    const batchesCollection = getCollection('batches');
    await batchesCollection.insertOne({
      _id: batchId,
      name: batchName || `Upload - ${new Date().toLocaleDateString()}`,
      uploadedBy: new ObjectId(req.user._id),
      uploadedAt: new Date(),
      totalContacts: contacts.length,
      fileName: req.file.originalname
    });

    broadcast('batch_uploaded', { batchId, totalUploaded: contacts.length });
    broadcast('dashboard_update');

    res.json({ success: true, batchId, totalUploaded: contacts.length, totalFailed: uploadErrors.length, uploadErrors });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// GET /upload/batches - Fetch historical data uploads
router.get('/batches', verify, authorize(['admin', 'tl']), async (req, res) => {
  try {
    const batchesCollection = getCollection('batches');
    const batches = await batchesCollection.find().sort({ uploadedAt: -1 }).toArray();
    res.json(batches);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch batches' });
  }
});

// GET /upload/template - Download upload templates
router.get('/template', verify, authorize(['admin', 'tl', 'agent']), async (req, res) => {
  const format = req.query.format || 'csv';
  const type = req.query.type || 'contacts';
  
  let headers = [];
  let sampleRow = [];

  if (type === 'leads') {
    headers = ['Name', 'Phone', 'Email', 'LeadAmount', 'Status', 'Remarks', 'TransactionId', 'Agent'];
    sampleRow = ['John Doe', '9876543210', 'john@example.com', '5000', 'Converted', 'Interested in premium plan', 'TXN123456', 'Priya (Agent)'];
  } else {
    headers = ['Name', 'Phone', 'Email', 'City', 'Source', 'Agent'];
    sampleRow = ['Jane Smith', '9123456780', 'jane@example.com', 'Mumbai', 'Website', 'Amit (Agent)'];
  }

  if (format === 'csv') {
    const csvContent = [headers.join(','), sampleRow.join(',')].join('\n');
    res.header('Content-Type', 'text/csv');
    res.attachment(`crm-${type}-template.csv`);
    return res.send(csvContent);
  } else if (format === 'xlsx') {
    const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');

    try {
      const usersCollection = getCollection('users');
      const agents = await usersCollection.find({ role: 'agent', isDeleted: { $ne: true } }).toArray();
      const referenceData = [['Agents available for assignment (Use exact name in Agent column)']];
      agents.forEach(a => referenceData.push([a.name]));
      
      referenceData.push([]);
      referenceData.push(['Valid Status/Dispositions (Use exact text)']);
      const statuses = ['Lead', 'Appointment', 'Call Not Answered', 'Hung Up', 'Invalid', 'Do Not Call', 'Call Back', 'Converted', 'Not Interested', 'DNC/DND', 'Others'];
      statuses.forEach(s => referenceData.push([s]));
      
      const wsRef = XLSX.utils.aoa_to_sheet(referenceData);
      XLSX.utils.book_append_sheet(wb, wsRef, 'Reference Data');
    } catch(err) {
      console.error('Failed to append reference data sheet', err);
    }

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.attachment(`crm-${type}-template.xlsx`);
    return res.send(buffer);
  } else {
    return res.status(400).json({ error: 'Invalid format requested' });
  }
});

module.exports = router;
