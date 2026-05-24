const { prisma } = require('./db');
const axios = require('axios');

async function triggerConversionEmail(contactId, receiptImageBase64 = null) {
  try {
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) {
      console.log(`[Email Trigger] Contact ${contactId} not found`);
      return { success: false, reason: 'Contact not found' };
    }

    const adminId = contact.adminId;
    if (!adminId) {
      console.log(`[Email Trigger] Contact ${contactId} has no adminId`);
      return { success: false, reason: 'No admin associated with contact' };
    }

    const [admin, agentUser] = await Promise.all([
      prisma.user.findUnique({ where: { id: adminId } }),
      contact.assignedTo ? prisma.user.findUnique({ where: { id: contact.assignedTo } }) : null
    ]);

    if (!admin || !admin.receiverMail) {
      console.log(`[Email Trigger] Admin ${adminId} has no receiverMail configured`);
      return { success: false, reason: 'Admin has no receiver email configured' };
    }

    let mailServiceUrl = process.env.MAIL_SERVICE_URL || 'http://localhost:3000/api/mail/send';
    if (!mailServiceUrl.endsWith('/api/mail/send')) {
      mailServiceUrl = `${mailServiceUrl.replace(/\/$/, '')}/api/mail/send`;
    }

    const amount        = contact.leadAmount || 0;
    const transactionId = contact.transactionId || 'N/A';
    const clientName    = contact.fields?.Name  || contact.fields?.name  || 'Client';
    const agentName     = agentUser?.name || contact.agentName || 'Unknown Agent';

    // Format date strictly as DD-MM-YYYY
    const dateObj = contact.conversionDate ? new Date(contact.conversionDate) : new Date();
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();
    const conversionDateFormatted = `${day}-${month}-${year}`;

    // Handle attachments
    let attachments = [];
    const hasScreenshot = !!receiptImageBase64;
    
    if (hasScreenshot && typeof receiptImageBase64 === 'string') {
      const matches = receiptImageBase64.match(/^data:(.+);base64,(.+)$/);
      if (matches) {
        const contentType = matches[1];
        const base64Data = matches[2];
        const extension = contentType.split('/')[1] || 'png';
        
        attachments.push({
          filename: `transaction_screenshot.${extension}`,
          content: base64Data,
          encoding: 'base64'
        });
      } else {
        attachments.push({
          filename: 'transaction_screenshot.png',
          content: receiptImageBase64,
          encoding: 'base64'
        });
      }
    }

    const html = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px;">
        <p>Dear Team,</p>
        <p>Please share your confirmation on the below mentioned transaction record:</p>
        
        <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; border: 1px solid #ccc; width: 100%; font-size: 14px; margin-top: 15px; margin-bottom: 15px;">
          <thead>
            <tr style="background-color: #f2f2f2; text-align: left;">
              <th style="padding: 10px; border: 1px solid #ccc;">Donor Name</th>
              <th style="padding: 10px; border: 1px solid #ccc;">Amount</th>
              <th style="padding: 10px; border: 1px solid #ccc;">Transaction ID</th>
              <th style="padding: 10px; border: 1px solid #ccc;">Transaction Date</th>
              <th style="padding: 10px; border: 1px solid #ccc;">Agent Name</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding: 10px; border: 1px solid #ccc;">${clientName}</td>
              <td style="padding: 10px; border: 1px solid #ccc;">${amount}</td>
              <td style="padding: 10px; border: 1px solid #ccc; font-family: monospace;">${transactionId}</td>
              <td style="padding: 10px; border: 1px solid #ccc;">${conversionDateFormatted}</td>
              <td style="padding: 10px; border: 1px solid #ccc;">${agentName}</td>
            </tr>
          </tbody>
        </table>
        
        <p style="margin-top: 25px; margin-bottom: 25px;">
          ${hasScreenshot 
            ? 'Transaction screenshot attached.' 
            : 'Donor is not comfortable in sharing the screenshot however he confirmed that his above mentioned donation has been completed, Kindly check.'}
        </p>
        
        <p style="margin-top: 25px;">
          Thanks<br>
          <strong>${admin.name || 'SS Enterprises'}</strong>
        </p>
      </div>
    `;

    const response = await axios.post(mailServiceUrl, {
      to: admin.receiverMail,
      subject: `✅ New Conversion: ₹${amount.toLocaleString('en-IN')} — ${clientName}`,
      html,
      companyName: admin.name || 'SS Enterprises',
      attachments
    });

    console.log(`[Email Trigger] Mail sent successfully to ${admin.receiverMail} for contact ${contactId}`);
    return { success: true, messageId: response.data?.messageId };
  } catch (error) {
    console.error(`[Email Trigger] Failed to send email for contact ${contactId}:`, error.message);
    return { success: false, reason: error.message };
  }
}

module.exports = { triggerConversionEmail };
