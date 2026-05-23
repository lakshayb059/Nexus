const { prisma } = require('./db');
const { sendConversionEmail } = require('./emailService');

async function triggerConversionEmail(contactId, receiptImageBase64 = null) {
  try {
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) return;

    let adminId = contact.adminId;
    if (!adminId && contact.assignedTo) {
      const agent = await prisma.user.findUnique({ where: { id: contact.assignedTo } });
      if (agent) {
        if (agent.role === 'admin') {
          adminId = agent.id;
        } else if (agent.adminId) {
          adminId = agent.adminId;
        }
      }
    }

    if (!adminId) return;

    const admin = await prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || !admin.notificationEmail) return; // No email configured

    // Get TL and Agent names
    let agentName = contact.agentName || 'Unknown Agent';
    let tlName = 'N/A';

    if (contact.assignedTo) {
      const agent = await prisma.user.findUnique({ where: { id: contact.assignedTo } });
      if (agent) {
        agentName = agent.name;
        if (agent.tlId) {
          const tl = await prisma.user.findUnique({ where: { id: agent.tlId } });
          if (tl) tlName = tl.name;
        }
      }
    }

    // Prepare lead details
    const fields = contact.fields || {};
    const name = fields.Name || fields.name || 'Unknown Lead';
    const phone = fields.Phone || fields.phone || fields.Mobile || 'N/A';
    
    // Find lead to get transactionId if any
    const lead = await prisma.lead.findFirst({ where: { contactId }, orderBy: { createdAt: 'desc' } });
    const transactionId = (lead && lead.transactionId) ? lead.transactionId : (contact.transactionId || 'N/A');
    const amount = (lead && lead.leadAmount) ? lead.leadAmount : (contact.leadAmount || 0);

    const emailDetails = {
      leadName: name,
      contact: phone,
      agentName,
      tlName,
      adminName: admin.name,
      amount: amount,
      transactionId: transactionId,
      receiptImageBase64: receiptImageBase64
    };

    await sendConversionEmail(
      admin.notificationEmail,
      admin.companyName || 'Our Company',
      emailDetails
    );

    console.log(`Conversion email sent successfully to ${admin.notificationEmail} for lead ${name}`);
  } catch (err) {
    console.error('Failed to trigger conversion email:', err);
  }
}

module.exports = { triggerConversionEmail };
