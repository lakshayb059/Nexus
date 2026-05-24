const { prisma } = require('./db');
const { sendConversionEmail } = require('./emailService');

async function triggerConversionEmail(contactId, receiptImageBase64 = null) {
  try {
    console.log(`Attempting to send conversion email for contact ${contactId}`);
    
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) {
      return { success: false, reason: 'Contact not found' };
    }

    let adminId = contact.adminId;
    if (!adminId && contact.assignedTo) {
      const agent = await prisma.user.findUnique({ where: { id: contact.assignedTo } });
      if (agent) {
        if (agent.role === 'admin') adminId = agent.id;
        else if (agent.adminId) adminId = agent.adminId;
        else if (agent.tlId) {
          const tl = await prisma.user.findUnique({ where: { id: agent.tlId } });
          if (tl && tl.adminId) adminId = tl.adminId;
        }
      }
    }

    if (!adminId) return { success: false, reason: 'No admin configured for this agent' };

    const admin = await prisma.user.findUnique({ where: { id: adminId } });
    if (!admin) return { success: false, reason: 'Admin not found' };

    // HARDCODED CREDENTIALS PER USER REQUEST
    const senderEmail = 'garg.abhi999@gmail.com';
    const appPassword = 'wfwoqaqetzjgrcej'; // spaces removed for safety
    const receiverEmail = admin.companyReceiverEmail || admin.notificationEmail;

    if (!receiverEmail) {
      return { success: false, reason: 'Admin has no receiver email configured' };
    }
    
    let agentName = contact.agentName || 'Unknown Agent';
    let tlName = 'N/A';
    if (contact.assignedTo) {
      const agent = await prisma.user.findUnique({ where: { id: contact.assignedTo } });
      if (agent) {
        agentName = agent.name || agentName;
        if (agent.tlId) {
          const tl = await prisma.user.findUnique({ where: { id: agent.tlId } });
          if (tl) tlName = tl.name || tlName;
        }
      }
    }

    const fields = contact.fields || {};
    const name = fields.Name || fields.name || fields.fullName || 'Unknown Lead';
    const phone = fields.Phone || fields.phone || fields.Mobile || fields.mobile || 'N/A';
    
    const lead = await prisma.lead.findFirst({ 
      where: { contactId }, 
      orderBy: { createdAt: 'desc' } 
    });
    
    const transactionId = (lead && lead.transactionId) ? lead.transactionId : (contact.transactionId || 'N/A');
    const amount = (lead && lead.leadAmount) ? lead.leadAmount : (contact.leadAmount || 0);

    const emailDetails = {
      leadName: name,
      contact: phone,
      agentName,
      tlName,
      adminName: admin.name || admin.username || 'Admin',
      amount: amount,
      transactionId: transactionId,
      receiptImageBase64: receiptImageBase64
    };

    const emailPromise = sendConversionEmail(
      senderEmail,
      appPassword,
      receiverEmail,
      admin.companyName || 'Our Company',
      emailDetails
    );
    
    // Increased single timeout to 60s
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(false), 60000));
    const result = await Promise.race([emailPromise, timeoutPromise]);
    
    if (result === true) {
      console.log(`Conversion email sent successfully for ${contactId}`);
      return { success: true };
    } else {
      console.log(`Email sending failed for ${contactId}`);
      return { success: true, warning: 'Lead converted but email notification failed' };
    }
  } catch (err) {
    console.error(`Failed to trigger conversion email:`, err);
    return { success: true, warning: `Lead converted but email notification failed: ${err.message}` };
  }
}

module.exports = { triggerConversionEmail };
