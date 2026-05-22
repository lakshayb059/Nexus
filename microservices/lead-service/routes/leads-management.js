const router = require('express').Router();
const { prisma } = require('../../shared/db');
const { authorize, verify } = require('../../shared/authMiddleware');
const { consolidateCallbacks, cleanupAllCallbacks } = require('../../shared/callbackUtils');
const { broadcast } = require('../../shared/notificationClient');

async function getQueueStats(agentId) {
  const pending = await prisma.contact.count({
    where: { 
      assignedTo: agentId, 
      isDeleted: false,
      OR: [
        { disposition: null },
        { disposition: 'CallNotAnswered' }
      ]
    }
  });

  const disposed = await prisma.contact.count({
    where: {
      assignedTo: agentId,
      isDeleted: false,
      NOT: [
        { disposition: null },
        { disposition: 'CallNotAnswered' }
      ]
    }
  });

  return { total: pending + disposed, pending, disposed };
}

router.post('/workflow/dispose', verify, authorize(['agent']), async (req, res) => {
  try {
    const { contactId, disposition, remarks, appointmentDt, leadAmount, callBackDt } = req.body;
    
    const query = { id: contactId };
    if (!['superadmin', 'admin', 'tl'].includes(req.user.role)) {
      query.assignedTo = req.user._id || req.user.id;
    }
    const contact = await prisma.contact.findFirst({
      where: query
    });
    
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const update = {
      disposition,
      remarks: remarks || '',
      disposedBy: req.user._id || req.user.id,
      disposedAt: new Date()
    };

    if (disposition === 'Lead') {
      update.leadAmount = parseFloat(leadAmount);
      update.conversionDate = new Date();
      update.queueOrder = 999999;
      
      await prisma.lead.create({
        data: {
          contactId, fields: contact.fields, batchId: contact.batchId,
          assignedTo: req.user._id || req.user.id, agentName: req.user.name,
          leadAmount: parseFloat(leadAmount), status: 'Lead',
          adminId: contact.adminId
        }
      });
    } else if (disposition === 'Appointment') {
      update.appointmentDt = new Date(appointmentDt);
      update.appointmentStatus = 'scheduled';
      update.reminderSent = false;
      update.lateNotified = false;
      update.queueOrder = 999999;
      
      await prisma.appointment.create({
        data: {
          contactId, fields: contact.fields, batchId: contact.batchId,
          assignedTo: req.user._id || req.user.id, agentName: req.user.name,
          appointmentDt: new Date(appointmentDt), remarks: remarks || '',
          adminId: contact.adminId
        }
      });
    } else if (disposition === 'CallBack') {
      update.callBackDt = new Date(callBackDt);
      update.cbReminderSent = false;
      update.lateNotified = false;
      update.queueOrder = 999999;
      
      await prisma.callback.create({
        data: {
          contactId, fields: contact.fields, batchId: contact.batchId,
          assignedTo: req.user._id || req.user.id, agentName: req.user.name,
          callBackDt: new Date(callBackDt), remarks: remarks || '',
          adminId: contact.adminId, source: 'workflow'
        }
      });
    } else if (disposition === 'CallNotAnswered' || disposition === 'HungUp') {
      update.callAttempts = (contact.callAttempts || 0) + 1;
      update.rechurnCount = (contact.rechurnCount || 0) + 1;
      update.lastCallAttempt = new Date();
      if (update.rechurnCount >= 3) {
        update.queueOrder = 999999;
      } else {
        const maxOrderContact = await prisma.contact.findFirst({
          where: { assignedTo: req.user._id || req.user.id, queueOrder: { lt: 999999 } },
          orderBy: { queueOrder: 'desc' }
        });
        update.queueOrder = maxOrderContact ? (maxOrderContact.queueOrder + 1) : 1;
      }
    }

    await prisma.contact.update({
      where: { id: contactId },
      data: update
    });

    const fields = contact.fields || {};
    const phoneNum = fields.Phone || fields.phone || fields.Mobile;
    if (disposition === 'CallBack') await consolidateCallbacks(phoneNum);
    else await cleanupAllCallbacks(phoneNum);

    broadcast('lead_disposed', { contactId, disposition, agentId: req.user._id || req.user.id, agentName: req.user.name, timestamp: new Date() });
    broadcast('dashboard_update');
    broadcast('contacts_updated');

    res.json({ success: true, nextContactAvailable: disposition !== 'CallNotAnswered' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/workflow/next', verify, authorize(['agent']), async (req, res) => {
  try {
    const now = new Date();
    
    const dueCallbacks = await prisma.contact.findMany({
      where: { 
        assignedTo: req.user._id || req.user.id, 
        disposition: 'CallBack', 
        callBackDt: { lte: now }, 
        queueOrder: 999999,
        isDeleted: false
      },
      orderBy: { callBackDt: 'asc' },
      take: 1
    });

    if (dueCallbacks.length > 0) {
      await prisma.contact.update({ 
        where: { id: dueCallbacks[0].id }, 
        data: { queueOrder: 0, callBackDt: null } 
      });
      return res.json({ contact: { ...dueCallbacks[0], _id: dueCallbacks[0].id }, type: 'callback_due' });
    }

    const nextContacts = await prisma.contact.findMany({
      where: { 
        assignedTo: req.user._id || req.user.id, 
        queueOrder: { lt: 999999 }, 
        isDeleted: false,
        OR: [{ disposition: null }, { disposition: 'CallNotAnswered' }] 
      },
      orderBy: [
        { queueOrder: 'asc' },
        { createdAt: 'asc' }
      ],
      take: 1
    });

    const nextContact = nextContacts[0] || null;
    const queueStats = await getQueueStats(req.user._id || req.user.id);

    res.json({ contact: nextContact ? { ...nextContact, _id: nextContact.id } : null, queueStats });
  } catch (err) { 
    console.error(err);
    res.status(500).json({ error: 'Server error' }); 
  }
});

module.exports = router;
