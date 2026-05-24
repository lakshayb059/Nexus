const { prisma } = require('./db');
const { sendConversionEmail } = require('./emailService');

async function triggerConversionEmail(contactId, receiptImageBase64 = null) {
  // Add retry logic with better backoff
  const maxRetries = 3;
  let lastError = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempt ${attempt} to send conversion email for contact ${contactId}`);
      
      // Exponential backoff with jitter
      if (attempt > 1) {
        const baseDelay = Math.pow(2, attempt - 1) * 1000;
        const jitter = Math.random() * 1000;
        const delay = baseDelay + jitter;
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

      const senderEmail = admin.senderEmail;
      const appPassword = admin.appPassword ? admin.appPassword.replace(/\s+/g, '') : null;
      const receiverEmail = admin.companyReceiverEmail || admin.notificationEmail;

      if (!senderEmail || !appPassword) {
        console.log(`Missing email credentials for admin ${adminId}`);
        return { success: false, reason: 'Admin has no sender email or app password configured' };
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
      
      // Find lead to get transaction details
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

      // Send email with Promise.race for timeout
      const emailPromise = sendConversionEmail(
        senderEmail,
        appPassword,
        receiverEmail,
        admin.companyName || 'Our Company',
        emailDetails
      );
      
      // Longer timeout for email operation
      const timeoutPromise = new Promise((resolve) => {
        setTimeout(() => resolve({ success: false, reason: 'Email timeout after 90 seconds' }), 90000);
      });
      
      const result = await Promise.race([emailPromise, timeoutPromise]);
      
      if (result === true || (result && result.success === true)) {
        console.log(`Conversion email sent successfully for contact ${contactId} on attempt ${attempt}`);
        return { success: true };
      } else if (result === false) {
        lastError = 'Email sending failed';
        console.log(`Email sending failed on attempt ${attempt}`);
        if (attempt === maxRetries) {
          // Don't fail the entire operation - log but return success for lead conversion
          console.error(`Failed to send email after ${maxRetries} attempts, but lead conversion is successful`);
          return { success: true, warning: 'Lead converted but email notification failed' };
        }
      } else if (result && result.reason) {
        lastError = result.reason;
        console.log(`Email error on attempt ${attempt}: ${result.reason}`);
        if (attempt === maxRetries) {
          return { success: true, warning: `Lead converted but email failed: ${result.reason}` };
        }
      }
      
    } catch (err) {
      lastError = err.message;
      console.error(`Failed to trigger conversion email (attempt ${attempt}):`, err);
      if (attempt === maxRetries) {
        // Don't fail lead conversion because email failed
        return { success: true, warning: `Lead converted but email notification failed: ${err.message}` };
      }
    }
  }
  
  return { success: true, warning: `Lead converted but email notification had issues: ${lastError || 'Unknown error'}` };
}

module.exports = { triggerConversionEmail };
