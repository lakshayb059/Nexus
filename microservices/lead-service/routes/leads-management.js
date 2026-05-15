const router = require('express').Router();
const { getCollection } = require('../../shared/mongodb');
const { authorize, verify } = require('../../shared/authMiddleware');
const { ObjectId } = require('mongodb');
const { consolidateCallbacks, cleanupAllCallbacks } = require('../../shared/callbackUtils');
const { broadcast } = require('../../shared/notificationClient');

// Helper function to get queue statistics
async function getQueueStats(agentId) {
  const contactsCollection = getCollection('contacts');
  const stats = await contactsCollection.aggregate([
    { $match: { assignedTo: new ObjectId(agentId) } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        pending: {
          $sum: { $cond: [{ $or: [{ $eq: ['$disposition', null] }, { $eq: ['$disposition', 'CallNotAnswered'] }] }, 1, 0] }
        },
        disposed: {
          $sum: { $cond: [{ $and: [{ $ne: ['$disposition', null] }, { $ne: ['$disposition', 'CallNotAnswered'] }] }, 1, 0] }
        }
      }
    }
  ]).toArray();
  return stats[0] || { total: 0, pending: 0, disposed: 0 };
}

// Workflow Disposition
router.post('/workflow/dispose', verify, authorize(['agent']), async (req, res) => {
  try {
    const { contactId, disposition, remarks, appointmentDt, leadAmount, callBackDt } = req.body;
    const contactsCollection = getCollection('contacts');
    const contact = await contactsCollection.findOne({ _id: new ObjectId(contactId), assignedTo: new ObjectId(req.user._id) });
    
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const update = {
      disposition,
      remarks: remarks || '',
      lastModified: new Date(),
      disposedBy: new ObjectId(req.user._id),
      disposedAt: new Date()
    };

    if (disposition === 'Lead') {
      update.leadAmount = parseFloat(leadAmount);
      update.conversionDate = new Date();
      update.queueOrder = 999999;
      const leadsCollection = getCollection('leads');
      await leadsCollection.insertOne({
        contactId: new ObjectId(contactId), fields: contact.fields, batchId: contact.batchId,
        assignedTo: new ObjectId(req.user._id), agentName: req.user.name,
        leadAmount: parseFloat(leadAmount), status: 'Lead', createdAt: new Date(), lastModified: new Date()
      });
    } else if (disposition === 'Appointment') {
      update.appointmentDt = new Date(appointmentDt);
      update.appointmentStatus = 'scheduled';
      update.queueOrder = 999999;
    } else if (disposition === 'CallBack') {
      update.callBackDt = new Date(callBackDt);
      update.queueOrder = 999999;
      const callbacksCollection = getCollection('callbacks');
      await callbacksCollection.insertOne({
        contactId: new ObjectId(contactId), fields: contact.fields, batchId: contact.batchId,
        assignedTo: new ObjectId(req.user._id), agentName: req.user.name,
        callBackDt: new Date(callBackDt), remarks: remarks || '', createdAt: new Date(), lastModified: new Date()
      });
    } else if (disposition === 'CallNotAnswered' || disposition === 'HungUp') {
      const maxOrderContact = await contactsCollection.find({ assignedTo: new ObjectId(req.user._id), queueOrder: { $lt: 999999 } }).sort({ queueOrder: -1 }).limit(1).toArray();
      update.queueOrder = maxOrderContact.length > 0 ? (maxOrderContact[0].queueOrder + 1) : 0;
      update.callAttempts = (contact.callAttempts || 0) + 1;
      update.rechurnCount = (contact.rechurnCount || 0) + 1;
      update.lastCallAttempt = new Date();
    }

    await contactsCollection.updateOne({ _id: new ObjectId(contactId) }, { $set: update });

    const phoneNum = contact.fields?.Phone || contact.fields?.phone || contact.fields?.Mobile;
    if (disposition === 'CallBack') await consolidateCallbacks(phoneNum);
    else await cleanupAllCallbacks(phoneNum);

    broadcast('lead_disposed', { contactId, disposition, agentId: req.user._id, agentName: req.user.name, timestamp: new Date() });
    broadcast('dashboard_update');
    broadcast('contacts_updated');

    res.json({ success: true, nextContactAvailable: disposition !== 'CallNotAnswered' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get next contact
router.get('/workflow/next', verify, authorize(['agent']), async (req, res) => {
  try {
    const contactsCollection = getCollection('contacts');
    const now = new Date();
    
    const dueCallbacks = await contactsCollection.find({ assignedTo: new ObjectId(req.user._id), disposition: 'CallBack', callBackDt: { $lte: now }, queueOrder: 999999 }).sort({ callBackDt: 1 }).limit(1).toArray();

    if (dueCallbacks.length > 0) {
      await contactsCollection.updateOne({ _id: dueCallbacks[0]._id }, { $set: { queueOrder: 0, callBackDt: null } });
      return res.json({ contact: dueCallbacks[0], type: 'callback_due' });
    }

    const nextContact = await contactsCollection.findOne({ assignedTo: new ObjectId(req.user._id), queueOrder: { $lt: 999999 }, $or: [{ disposition: null }, { disposition: 'CallNotAnswered' }] }).sort({ queueOrder: 1, createdAt: 1 });

    res.json({ contact: nextContact || null, queueStats: await getQueueStats(req.user._id) });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
