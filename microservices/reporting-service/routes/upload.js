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
  return csvSync.parse(buffer.toString('utf-8'), { columns: true, skip_empty_lines: true, trim: true, bom: true });
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
    }

    let records = req.file.originalname.toLowerCase().endsWith('.xlsx') ? parseExcel(req.file.buffer) : parseCSV(req.file.buffer);
    if (!records.length) return res.status(400).json({ error: 'No records found' });

    const batchId = 'batch_' + Date.now();
    const contactsCollection = getCollection('contacts');
    const allUsers = await usersCollection.find({ role: { $in: ['agent', 'tl'] } }).toArray();
    const userMap = allUsers.reduce((acc, u) => { acc[u.name.toLowerCase()] = u; acc[u._id.toString()] = u; return acc; }, {});

    const contacts = records.map(row => {
      let assignedId = selectedAgent?._id;
      const agentCol = Object.keys(row).find(k => k.toLowerCase().includes('agent'));
      if (agentId === 'multi' && agentCol && row[agentCol]) {
        const u = userMap[row[agentCol].toString().toLowerCase()];
        if (u) assignedId = u._id;
      }
      return {
        assignedTo: assignedId ? new ObjectId(assignedId) : null,
        batchId,
        fields: row,
        createdAt: new Date(),
        lastModified: new Date(),
        isDeleted: false,
        disposition: null,
        queueOrder: 0
      };
    }).filter(c => c.assignedTo);

    if (contacts.length === 0) return res.status(400).json({ error: 'No valid assignments' });

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

    res.json({ success: true, batchId, totalUploaded: contacts.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

module.exports = router;
