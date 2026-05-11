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

    // Standardize phone field names
    const phoneHeaders = ['phone', 'mobile', 'contact', 'mobile no', 'contact no', 'phone number', 'mobile number'];
    records = records.map(r => {
      const keys = Object.keys(r);
      const phoneKey = keys.find(k => phoneHeaders.includes(k.toLowerCase()));
      if (phoneKey && phoneKey !== 'Phone') {
        r.Phone = r[phoneKey];
      }
      return r;
    });

    const columns = Object.keys(records[0]);
    const batchId = 'batch_' + Date.now();
    const now = new Date().toISOString();

    // Map of agent names/IDs to their user objects (including role and active status)
    const allUsers = await usersCollection.find({ role: { $in: ['agent', 'tl'] } }).toArray();
    const userMap = {};
    for (const u of allUsers) {
      const uKey = { id: u._id, role: u.role, active: u.active, name: u.name };
      if (u.name) {
        userMap[u.name.toLowerCase()] = uKey;
        userMap[u.name] = uKey;
      }
      if (u.username) {
        userMap[u.username.toLowerCase()] = uKey;
        userMap[u.username] = uKey;
      }
      userMap[u._id.toString()] = uKey;
    }

    const contactsCollection = getCollection('contacts');
    const leadsCollection = getCollection('leads');
    const queueStarts = {};

    // Duplicate Check Logic (Admin only)
    const hasLeads = isLeadUpload === 'true' || isLeadUpload === true || records.some(r => {
      const s = r.Status || r.status;
      return ['Converted', 'Not Interested', 'Call Back', 'Others', 'Appointment', 'Lead'].includes(s);
    });

    if (req.user.role === 'admin' && hasLeads) {
      // 1. Check for duplicates WITHIN the uploaded file
      const seenInFile = {};
      const internalDuplicates = [];

      const filePhoneData = records.map((r, idx) => {
        const p = r.Phone || r.phone || r.Mobile || r.MOBILE || r.PHONE;
        const normalized = normalizePhone(p);
        return { normalized, original: p, row: idx + 2 };
      }).filter(item => item.normalized);

      for (const item of filePhoneData) {
        if (seenInFile[item.normalized]) {
          if (!internalDuplicates.includes(item.original)) {
            internalDuplicates.push(item.original);
          }
        } else {
          seenInFile[item.normalized] = item;
        }
      }

      if (internalDuplicates.length > 0) {
        return res.status(400).json({
          error: `Duplicate leads detected WITHIN the uploaded file! The following phone numbers appear multiple times: ${internalDuplicates.join(', ')}. Please ensure each lead is unique.`
        });
      }

      // 2. Check for duplicates AGAINST THE DATABASE
      const phonesToCheck = Object.keys(seenInFile);
      if (phonesToCheck.length > 0) {
        const duplicatePhones = [];
        for (let i = 0; i < phonesToCheck.length; i += 50) {
          const batch = phonesToCheck.slice(i, i + 50);

          const orConditions = [];
          batch.forEach(phone => {
            if (phone.length >= 10) {
              const regex = new RegExp(phone + '$');
              orConditions.push({ "fields.Phone": { $regex: regex, $options: 'i' } });
              orConditions.push({ "fields.phone": { $regex: regex, $options: 'i' } });
              orConditions.push({ "fields.Mobile": { $regex: regex, $options: 'i' } });
              orConditions.push({ "fields.MOBILE": { $regex: regex, $options: 'i' } });
              orConditions.push({ "fields.PHONE": { $regex: regex, $options: 'i' } });
              orConditions.push({ "fields.Contact": { $regex: regex, $options: 'i' } });
              orConditions.push({ "fields.Mobile No": { $regex: regex, $options: 'i' } });
            }
          });

          if (orConditions.length === 0) continue;

          const [existingLeads, existingContacts] = await Promise.all([
            leadsCollection.find({ isDeleted: { $ne: true }, $or: orConditions }).toArray(),
            contactsCollection.find({ isDeleted: { $ne: true }, $or: orConditions }).toArray()
          ]);

          const allExisting = [...existingLeads, ...existingContacts];

          allExisting.forEach(e => {
            const rawP = e.fields?.Phone || e.fields?.phone || e.fields?.Mobile ||
              e.fields?.MOBILE || e.fields?.PHONE || e.fields?.Contact ||
              e.fields?.['Mobile No'];
            const ep = normalizePhone(rawP);
            if (ep && batch.includes(ep) && !duplicatePhones.includes(ep)) {
              const originalItem = seenInFile[ep];
              if (originalItem) {
                duplicatePhones.push(originalItem.original);
              }
            }
          });
        }

        if (duplicatePhones.length > 0) {
          console.log(`[UPLOAD] Blocking upload due to database duplicates: ${duplicatePhones.join(', ')}`);
          return res.status(400).json({
            error: `Duplicate leads detected! The following phone numbers already exist: ${duplicatePhones.join(', ')}. Please remove them and try again.`
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
    const uploadErrors = [];

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      let rowUserObj = null;

      // Check if row has an Agent column
      const agentCol = Object.keys(row).find(k => {
        const kl = k.toLowerCase();
        return kl === 'agent' || kl === 'agent name' || kl === 'agent id' || kl === 'agent_id' || kl === 'agentid' || kl === 'assign to';
      });

      if (agentCol && row[agentCol]) {
        const val = row[agentCol].toString().trim();
        rowUserObj = userMap[val.toLowerCase()] || userMap[val];
        if (!rowUserObj && ObjectId.isValid(val)) {
          // If not in map but valid ID, look it up in allUsers
          rowUserObj = allUsers.find(u => u._id.toString() === val);
        }
      }

      // Fallback to the dropdown agent if row agent is missing
      if (!rowUserObj) {
        if (agentId !== 'multi') {
          rowUserObj = allUsers.find(u => u._id.toString() === agentId);
        } else {
          uploadErrors.push({
            rowNumber: i + 2,
            name: row.Name || row.name || row.Customer || 'Unknown',
            phone: row.Phone || row.phone || 'No phone',
            error: 'Missing agent assignment'
          });
          continue;
        }
      }

      // VALIDATION: Reject Team Leaders and Inactive Agents
      if (rowUserObj) {
        if (rowUserObj.role === 'tl') {
          uploadErrors.push({
            rowNumber: i + 2,
            name: row.Name || row.name || row.Customer || 'Unknown',
            phone: row.Phone || row.phone || 'No phone',
            error: `Assigned to Team Leader (${rowUserObj.name}). Contacts must be assigned to Agents.`
          });
          continue;
        }
        if (!rowUserObj.active) {
          uploadErrors.push({
            rowNumber: i + 2,
            name: row.Name || row.name || row.Customer || 'Unknown',
            phone: row.Phone || row.phone || 'No phone',
            error: `Assigned to Inactive Agent (${rowUserObj.name}).`
          });
          continue;
        }
      }

      const rowAgentObjectId = rowUserObj ? new ObjectId(rowUserObj._id || rowUserObj.id) : null;

      let disposition = null;
      let queueOrder = await getNextQueueOrder(rowAgentObjectId);
      let leadAmount = null;
      let status = null;
      let statusDetails = null;
      let transactionId = null;
      let callBackDt = null;
      let appointmentDt = null;

      // Extract status from row
      const statusCol = Object.keys(row).find(k => k.toLowerCase() === 'status');
      if (statusCol) status = row[statusCol];

      const s = (status || '').toLowerCase().trim();
      const isLeadStatus = ['converted', 'not interested', 'call back', 'others', 'appointment', 'lead'].includes(s);

      if (isLeadUpload === 'true' || isLeadUpload === true || isLeadStatus) {
        disposition = 'Lead';
        queueOrder = 999999;

        // Map template status to DB status
        if (status === 'Converted') {
          const utrCol = Object.keys(row).find(k => k.toLowerCase().includes('utr') || k.toLowerCase().includes('transaction'));
          if (utrCol) transactionId = row[utrCol];
        } else if (status === 'Call Back') {
          const cbCol = Object.keys(row).find(k => k.toLowerCase().includes('callback') || k.toLowerCase().includes('date'));
          if (cbCol && row[cbCol]) {
            try {
              callBackDt = new Date(row[cbCol]).toISOString();
            } catch (e) { console.error('Invalid callback date:', row[cbCol]); }
          }
        } else if (status === 'Appointment') {
          const apptCol = Object.keys(row).find(k => k.toLowerCase().includes('appointment') && k.toLowerCase().includes('date'));
          if (apptCol && row[apptCol]) {
            try {
              appointmentDt = new Date(row[apptCol]).toISOString();
            } catch (e) { console.error('Invalid appointment date:', row[apptCol]); }
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
        appointmentDt,
        remarks: row.Remarks || row.remarks || '',
        lastModified: now,
        createdAt: now,
        queueOrder,
      };

      contacts.push(contactData);
    }

    if (contacts.length === 0) {
      return res.status(400).json({ 
        error: 'No valid contacts to upload',
        uploadErrors: uploadErrors
      });
    }

    const insertResult = await contactsCollection.insertMany(contacts);

    // Process leads
    const leadContacts = contacts.filter(c => {
      const s = (c.status || '').toLowerCase().trim();
      const leadStatuses = ['converted', 'not interested', 'call back', 'others', 'appointment', 'lead'];
      return (c.disposition === 'Lead') || leadStatuses.includes(s);
    });

    if (leadContacts.length > 0) {
      console.log(`[UPLOAD] Detected ${leadContacts.length} leads. Syncing to leads collection...`);
      const leads = leadContacts.map((c, idx) => {
        const contactIndex = contacts.findIndex(origC => origC === c);
        const contactId = insertResult.insertedIds[contactIndex];

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
          status: c.status || 'Lead',
          statusDetails: c.statusDetails || '',
          transactionId: c.transactionId || '',
          remarks: c.remarks || '[Uploaded via Excel]',
          callBackDt: c.callBackDt,
          appointmentDt: c.appointmentDt,
          createdAt: new Date(now),
          lastModified: new Date(now)
        };
      });
      await leadsCollection.insertMany(leads);
      console.log(`[UPLOAD] Lead sync complete. ${leads.length} records added.`);

      // Sync to appointments and callbacks
      try {
        const appointmentsCollection = getCollection('appointments');
        const callbacksCollection = getCollection('callbacks');

        const apptsToInsert = [];
        const cbsToInsert = [];

        leads.forEach(l => {
          if (l.status === 'Appointment') {
            apptsToInsert.push({
              contactId: l.contactId,
              fields: l.fields,
              batchId: l.batchId,
              assignedTo: l.assignedTo,
              agentName: l.agentName,
              appointmentDt: l.appointmentDt || new Date(),
              remarks: l.remarks || '[Uploaded via Excel]',
              createdAt: new Date(),
              lastModified: new Date()
            });
          } else if (l.status === 'Call Back') {
            cbsToInsert.push({
              contactId: l.contactId,
              fields: l.fields,
              batchId: l.batchId,
              assignedTo: l.assignedTo,
              agentName: l.agentName,
              callBackDt: l.callBackDt || new Date(),
              remarks: l.remarks || '[Uploaded via Excel]',
              status: 'Call Back',
              source: 'lead',
              createdAt: new Date(),
              lastModified: new Date()
            });
          }
        });

        if (apptsToInsert.length > 0) await appointmentsCollection.insertMany(apptsToInsert);
        if (cbsToInsert.length > 0) await callbacksCollection.insertMany(cbsToInsert);
      } catch (syncErr) {
        console.error('Failed to sync uploads to appt/callback collections:', syncErr);
      }
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
      isLeadUpload: hasLeads
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('batch_uploaded', { batchId, agentId, totalUploaded: contacts.length });
      io.emit('dashboard_update');
      io.emit('contacts_updated');
    }

    res.json({
      success: true,
      batchId,
      totalUploaded: contacts.length,
      totalFailed: uploadErrors.length,
      columns,
      agentName: agentId === 'multi' ? 'Multi-Agents' : (selectedAgent?.name || 'Unknown'),
      uploadErrors: uploadErrors
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// GET /upload/template
router.get('/template', verify, authorize(['admin', 'tl']), async (req, res) => {
  try {
    const { format = 'csv', type = 'contact' } = req.query;

    const usersCollection = getCollection('users');
    const contactsCollection = getCollection('contacts');
    const leadsCollection = getCollection('leads');

    // Get agents list based on user role
    let agentsList = [];
    if (req.user.role === 'admin') {
      agentsList = await usersCollection.find({
        role: 'agent',
        active: true
      }).toArray();
    } else if (req.user.role === 'tl') {
      agentsList = await usersCollection.find({
        role: 'agent',
        tlId: new ObjectId(req.user._id),
        active: true
      }).toArray();
    }

    let templateRows = [];
    let headers = [];

    // Get comprehensive field structure from contacts table
    const contactSamples = await contactsCollection.find({ isDeleted: { $ne: true } }).limit(10).toArray();
    const contactFieldsSet = new Set();
    contactSamples.forEach(contact => {
      if (contact.fields) {
        Object.keys(contact.fields).forEach(field => contactFieldsSet.add(field));
      }
    });
    const allContactFields = Array.from(contactFieldsSet);
    console.log(`[TEMPLATE] Found ${allContactFields.length} contact fields:`, allContactFields);

    // Get comprehensive field structure from leads table
    let allLeadFields = [];
    try {
      // Ensure leadsCollection is available
      if (!leadsCollection) {
        throw new Error('leadsCollection not available');
      }
      const leadSamples = await leadsCollection.find({ isDeleted: { $ne: true } }).limit(10).toArray();
      const leadFieldsSet = new Set();
      leadSamples.forEach(lead => {
        if (lead.fields) {
          Object.keys(lead.fields).forEach(field => leadFieldsSet.add(field));
        }
      });
      allLeadFields = Array.from(leadFieldsSet);
      console.log(`[TEMPLATE] Found ${allLeadFields.length} lead fields:`, allLeadFields);
    } catch (error) {
      console.log(`[TEMPLATE] Error getting lead fields:`, error.message);
      allLeadFields = ['Name', 'Phone', 'Email', 'Status', 'Amount', 'Transaction ID'];
    }

    // Base fields that should always be included
    const baseFields = ['Name', 'Phone', 'Email', 'Company', 'City', 'State', 'Product', 'Budget', 'Source', 'Notes'];

    // For contacts: merge existing contact fields with base fields
    const contactAllFields = [...new Set([...baseFields, ...allContactFields])];

    // For leads: merge existing lead fields with base fields
    const leadAllFields = [...new Set([...baseFields, ...allLeadFields])];

    // Filter out system/internal fields for contacts
    const filteredContactFields = contactAllFields.filter(field =>
      !field.toLowerCase().includes('agent') &&
      !field.toLowerCase().includes('status') &&
      !field.toLowerCase().includes('amount') &&
      !field.toLowerCase().includes('transaction') &&
      !field.toLowerCase().includes('callback') &&
      !field.toLowerCase().includes('appointment') &&
      !field.toLowerCase().includes('remark')
    );

    // For leads, keep status field but filter other system fields
    const filteredLeadFields = leadAllFields.filter(field =>
      !field.toLowerCase().includes('agent') &&
      !field.toLowerCase().includes('amount') &&
      !field.toLowerCase().includes('transaction') &&
      !field.toLowerCase().includes('callback') &&
      !field.toLowerCase().includes('appointment') &&
      !field.toLowerCase().includes('remark')
    );

    if (type === 'lead') {
      // LEAD TEMPLATE - Include all lead fields plus lead-specific fields
      headers = [...filteredLeadFields, 'Agent', 'Status', 'Amount', 'Transaction ID / UTR', 'Callback Date', 'Appointment Date', 'Remarks'];

      // Generate sample data for leads using dynamic fields
      const sampleData = {};

      // Add base sample data
      sampleData['Name'] = 'Rahul Sharma';
      sampleData['Phone'] = '9876543210';
      sampleData['Email'] = 'rahul.sharma@email.com';
      sampleData['Company'] = 'Tech Solutions Pvt Ltd';
      sampleData['City'] = 'Mumbai';
      sampleData['State'] = 'Maharashtra';
      sampleData['Product'] = 'Premium Insurance Plan';
      sampleData['Budget'] = '50000';
      sampleData['Source'] = 'Website Inquiry';
      sampleData['Notes'] = 'Interested in comprehensive coverage';

      // Add any additional fields from existing leads in database
      filteredLeadFields.forEach(field => {
        if (!sampleData[field]) {
          sampleData[field] = field.toLowerCase().includes('email') ? 'sample@email.com' :
            field.toLowerCase().includes('phone') ? '9876543210' :
              field.toLowerCase().includes('date') ? '2024-12-25' :
                field.toLowerCase().includes('amount') ? '10000' :
                  field.toLowerCase().includes('budget') ? '25000' :
                    field.toLowerCase().includes('status') ? 'New Lead' :
                      'Sample ' + field;
        }
      });

      templateRows = [
        {
          ...sampleData,
          'Agent': agentsList[0]?.name || 'Agent Name',
          'Status': 'Converted',
          'Amount': '15000',
          'Transaction ID / UTR': 'TRX123456789',
          'Callback Date': '',
          'Appointment Date': '',
          'Remarks': 'Payment confirmed, premium plan purchased'
        },
        {
          ...sampleData,
          'Name': 'Priya Patel',
          'Phone': '9988776655',
          'Agent': agentsList[1]?.name || (agentsList[0]?.name || 'Agent Name'),
          'Status': 'Call Back',
          'Amount': '',
          'Transaction ID / UTR': '',
          'Callback Date': new Date(Date.now() + 86400000).toISOString().slice(0, 16).replace('T', ' '),
          'Appointment Date': '',
          'Remarks': 'Interested but busy, call back tomorrow'
        },
        {
          ...sampleData,
          'Name': 'Amit Singh',
          'Phone': '8877665544',
          'Agent': agentsList[2]?.name || (agentsList[0]?.name || 'Agent Name'),
          'Status': 'Appointment',
          'Amount': '25000',
          'Transaction ID / UTR': '',
          'Callback Date': '',
          'Appointment Date': new Date(Date.now() + 172800000).toISOString().slice(0, 16).replace('T', ' '),
          'Remarks': 'Schedule meeting for policy discussion'
        },
        {
          ...sampleData,
          'Name': 'Neha Gupta',
          'Phone': '7766554433',
          'Agent': agentsList[0]?.name || 'Agent Name',
          'Status': 'Not Interested',
          'Amount': '',
          'Transaction ID / UTR': '',
          'Callback Date': '',
          'Appointment Date': '',
          'Remarks': 'Not interested in current offers'
        },
        {
          ...sampleData,
          'Name': 'Vikram Mehta',
          'Phone': '6655443322',
          'Agent': agentsList[1]?.name || (agentsList[0]?.name || 'Agent Name'),
          'Status': 'Lead',
          'Amount': '',
          'Transaction ID / UTR': '',
          'Callback Date': '',
          'Appointment Date': '',
          'Remarks': 'New inquiry from website'
        }
      ];
    } else {
      // CONTACT TEMPLATE - Include all contact fields from database
      headers = [...filteredContactFields, 'Agent', 'Remarks'];

      // Generate sample data for contacts using dynamic fields
      const sampleData = {};

      // Add base sample data
      sampleData['Name'] = 'Rajesh Kumar';
      sampleData['Phone'] = '9988776655';
      sampleData['Email'] = 'rajesh.k@email.com';
      sampleData['Company'] = 'Global Enterprises';
      sampleData['City'] = 'Bangalore';
      sampleData['State'] = 'Karnataka';
      sampleData['Product'] = 'Basic Insurance Plan';
      sampleData['Budget'] = '25000';
      sampleData['Source'] = 'Referral';
      sampleData['Notes'] = 'Referred by existing client';

      // Add any additional fields from existing contacts in database
      filteredContactFields.forEach(field => {
        if (!sampleData[field]) {
          sampleData[field] = field.toLowerCase().includes('email') ? 'sample@email.com' :
            field.toLowerCase().includes('phone') ? '9988776655' :
              field.toLowerCase().includes('date') ? '2024-12-25' :
                field.toLowerCase().includes('amount') ? '10000' :
                  field.toLowerCase().includes('budget') ? '25000' :
                    field.toLowerCase().includes('status') ? 'New Contact' :
                      'Sample ' + field;
        }
      });

      templateRows = [
        {
          ...sampleData,
          'Agent': agentsList[0]?.name || 'Agent Name',
          'Remarks': 'Fresh inquiry from Facebook Ads'
        },
        {
          ...sampleData,
          'Name': 'Anjali Sharma',
          'Phone': '8877665544',
          'Agent': agentsList[1]?.name || (agentsList[0]?.name || 'Agent Name'),
          'Remarks': 'Existing customer - renewal due next month'
        },
        {
          ...sampleData,
          'Name': 'Suresh Reddy',
          'Phone': '7766554433',
          'Agent': agentsList[2]?.name || (agentsList[0]?.name || 'Agent Name'),
          'Remarks': 'Referred by Mr. Verma'
        }
      ];
    }

    if (format === 'csv') {
      // Create CSV content
      const csvRows = [headers.join(',')];

      for (const row of templateRows) {
        const csvRow = headers.map(header => {
          let value = row[header] || '';
          // Escape quotes and wrap in quotes if contains comma
          if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            value = '"' + value.replace(/"/g, '""') + '"';
          }
          return value;
        }).join(',');
        csvRows.push(csvRow);
      }

      const csvStr = csvRows.join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="crm-${type}-template-${Date.now()}.csv"`);
      res.send(csvStr);
    } else {
      // Create Excel workbook with multiple sheets
      const wb = XLSX.utils.book_new();

      // Main data sheet
      const ws = XLSX.utils.json_to_sheet(templateRows, { header: headers });

      // Auto-size columns
      ws['!cols'] = headers.map(h => ({
        wch: Math.min(Math.max(h.length, 15), 30)
      }));

      XLSX.utils.book_append_sheet(wb, ws, `${type.toUpperCase()} DATA`);

      // Create INSTRUCTIONS sheet
      const instructionData = [
        ['--- CRM DATA UPLOAD GUIDE ---', '', ''],
        ['Template Type:', type.toUpperCase(), type === 'lead' ? 'Detailed Leads Upload' : 'Standard Contacts Upload'],
        ['Upload Mode:', 'Multi-Agent Support', 'YES - You can assign different agents in the "Agent" column'],
        ['', '', ''],
        ['--- IMPORTANT RULES ---', '', ''],
        ['1. Phone Number:', 'Required field', 'Must be 10 digits (Indian mobile numbers)'],
        ['2. Agent Assignment:', 'Required for each row', type === 'lead' ? 'Use Agent names from the list below' : 'Use Agent names from the list below'],
        ['3. Duplicate Check:', 'System checks for duplicates', 'Phone numbers must be unique across Leads & Contacts'],
        ['', '', ''],
      ];

      if (type === 'lead') {
        instructionData.push(
          ['--- LEAD STATUS OPTIONS ---', '', 'Instructions'],
          ['Status', 'Required Fields', 'When to use'],
          ['Converted', 'Amount, Transaction ID / UTR', 'When customer has made payment'],
          ['Call Back', 'Callback Date (YYYY-MM-DD HH:MM)', 'Customer wants to be contacted later'],
          ['Appointment', 'Appointment Date (YYYY-MM-DD HH:MM)', 'Schedule meeting/call with customer'],
          ['Not Interested', 'None', 'Customer declined the offer'],
          ['Lead', 'None', 'Initial interest - requires follow-up'],
          ['', '', ''],
          ['Date Format Example:', '2024-12-25 14:30', 'YYYY-MM-DD HH:MM (24-hour format)'],
          ['', '', '']
        );
      }

      instructionData.push(
        ['--- ACTIVE AGENTS (Use these names in "Agent" column) ---', '', ''],
        ['Agent Name', 'Username', 'Status']
      );

      for (const agent of agentsList) {
        instructionData.push([
          agent.name,
          agent.username || '-',
          agent.active ? 'Active' : 'Inactive'
        ]);
      }

      if (type === 'lead') {
        instructionData.push(
          ['', '', ''],
          ['--- SAMPLE SCENARIOS ---', '', ''],
          ['Scenario 1: Payment Received', '', 'Status: Converted, Amount: 15000, Transaction ID: TRX12345'],
          ['Scenario 2: Future Follow-up', '', 'Status: Call Back, Callback Date: 2024-12-25 10:00'],
          ['Scenario 3: Schedule Meeting', '', 'Status: Appointment, Appointment Date: 2024-12-26 15:30'],
          ['Scenario 4: New Lead', '', 'Status: Lead, No additional fields needed'],
          ['', '', ''],
          ['--- MULTI-AGENT UPLOAD EXAMPLE ---', '', ''],
          ['Row 1: Agent Name "Rahul" - Assigns to Rahul', '', ''],
          ['Row 2: Agent Name "Priya" - Assigns to Priya', '', ''],
          ['Row 3: Empty Agent - Will use dropdown selection or error', '', '']
        );
      }

      const wsInstructions = XLSX.utils.aoa_to_sheet(instructionData);
      wsInstructions['!cols'] = [{ wch: 30 }, { wch: 30 }, { wch: 50 }];

      XLSX.utils.book_append_sheet(wb, wsInstructions, 'INSTRUCTIONS');

      // Add Agents Reference sheet
      const agentsData = [
        ['Agent ID', 'Name', 'Username', 'Email', 'Status'],
        ...agentsList.map(a => [
          a._id.toString(),
          a.name,
          a.username || '-',
          a.email || '-',
          a.active ? 'Active' : 'Inactive'
        ])
      ];
      const wsAgents = XLSX.utils.aoa_to_sheet(agentsData);
      wsAgents['!cols'] = [{ wch: 25 }, { wch: 25 }, { wch: 20 }, { wch: 30 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, wsAgents, 'AGENTS REFERENCE');

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="crm-${type}-template-${Date.now()}.xlsx"`);
      res.send(buffer);
    }
  } catch (err) {
    console.error('Template error:', err);
    res.status(500).json({ error: 'Failed to generate template: ' + err.message });
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
    } else {
      batches = [];
    }

    const enriched = await Promise.all(batches.map(async b => {
      const uploader = await usersCollection.findOne({ _id: new ObjectId(b.uploadedBy) }, { projection: { password: 0 } });
      return { ...b, uploaderName: uploader?.name || 'Unknown' };
    }));
    res.json(enriched);
  } catch (err) {
    console.error('Batches fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
