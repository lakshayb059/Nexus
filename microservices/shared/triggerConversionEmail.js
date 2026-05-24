const { prisma } = require('./db');
const { sendConversionEmail } = require('./emailService');

async function triggerConversionEmail(contactId, receiptImageBase64 = null) {
  const maxRetries = 2;
  let lastError = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempt ${attempt} to send conversion email for contact ${contactId}`);
      
      if (attempt > 1) {
        const delay = 2000;
        console.log(`Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      const contact = await prisma.contact.findUnique({ where: { id: contactId } });
      if (!contact) {
        console.log(`Contact ${contactId} not found`);
        return { success: false, reason: 'Contact not found' };
      }
      
      console.log(`Contact found: ${contact.id}, status: ${contact.status}`);

      let adminId = contact.adminId;
      if (!adminId && contact.assignedTo) {
        const agent = await prisma.user.findUnique({ where: { id: contact.assignedTo } });
        if (agent) {
          if (agent.role === 'admin') {
            adminId = agent.id;
          } else if (agent.adminId) {
            adminId = agent.adminId;
          } else if (agent.tlId) {
            const tl = await prisma.user.findUnique({ where: { id: agent.tlId } });
            if (tl && tl.adminId) {
              adminId = tl.adminId;
            }
          }
        }
      }

      if (!adminId) {
        console.log(`No admin found for contact ${contactId}`);
        return { success: false, reason: 'No admin configured for this agent' };
      }

      const admin = await prisma.user.findUnique({ where: { id: adminId } });
      if (!admin) {
        console.log(`Admin ${adminId} not found`);
        return { success: false, reason: 'Admin not found' };
      }
      
      console.log(`Admin found successfully (ID: ${admin.id}, Username: ${admin.username || 'N/A'})`);

      // For SendGrid, we need API key instead of app password
      const senderEmail = admin.senderEmail;
      const sendGridApiKey = admin.sendGridApiKey || process.env.SENDGRID_API_KEY; // Add this field to your User model
      const receiverEmail = admin.companyReceiverEmail || admin.notificationEmail;

      if (!senderEmail) {
        console.log(`Missing sender email for admin ${adminId}`);
        return { success: false, reason: 'Admin has no sender email configured' };
      }
      
      if (!sendGridApiKey) {
        console.log(`Missing SendGrid API key for admin ${adminId}`);
        return { success: false, reason: 'SendGrid API key not configured. Please add sendGridApiKey to admin profile.' };
      }
      
      if (!receiverEmail) {
        console.log(`No receiver email for admin ${adminId}`);
        return { success: false, reason: 'Admin has no receiver email configured' };
      }
      
      console.log(`Email configuration: sender=${senderEmail}, receiver=${receiverEmail}`);

      // Get TL and Agent names
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

      // Prepare lead details
      const fields = contact.fields || {};
      const name = fields.Name || fields.name || fields.fullName || 'Unknown Lead';
      const phone = fields.Phone || fields.phone || fields.Mobile || fields.mobile || 'N/A';
      
      const lead = await prisma.lead.findFirst({ 
        where: { contactId }, 
        orderBy: { createdAt: 'desc' } 
      });
      
      const transactionId = (lead && lead.transactionId) ? lead.transactionId : (contact.transactionId || 'N/A');
      const amount = (lead && lead.leadAmount) ? lead.leadAmount : (contact.leadAmount || 0);
      
      console.log(`Lead details: name=${name}, amount=${amount}, transactionId=${transactionId}`);

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

      const result = await sendConversionEmail(
        senderEmail,
        sendGridApiKey,
        receiverEmail,
        admin.companyName || 'Our Company',
        emailDetails
      );
      
      if (result === true) {
        console.log(`Conversion email sent successfully for contact ${contactId} on attempt ${attempt}`);
        return { success: true };
      } else {
        lastError = 'Email sending failed';
        console.log(`Email sending failed on attempt ${attempt}`);
      }
      
    } catch (err) {
      lastError = err.message;
      console.error(`Failed to trigger conversion email (attempt ${attempt}):`, err);
    }
  }
  
  // Don't fail lead conversion if email fails
  return { success: true, warning: `Lead converted but email notification failed: ${lastError || 'Unknown error'}` };
}

module.exports = { triggerConversionEmail };
