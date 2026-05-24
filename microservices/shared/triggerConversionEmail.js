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

    const admin = await prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || !admin.receiverMail) {
      console.log(`[Email Trigger] Admin ${adminId} has no receiverMail configured`);
      return { success: false, reason: 'Admin has no receiver email configured' };
    }

    let mailServiceUrl = process.env.MAIL_SERVICE_URL || 'http://localhost:5006';
    if (!mailServiceUrl.endsWith('/api/mail/send')) {
      mailServiceUrl = `${mailServiceUrl.replace(/\/$/, '')}/api/mail/send`;
    }
    const amount = contact.leadAmount || 0;
    const transactionId = contact.transactionId || 'N/A';
    const clientPhone = contact.fields?.Phone || contact.fields?.phone || contact.fields?.Mobile || 'Unknown';
    const clientName = contact.fields?.Name || contact.fields?.name || 'Client';

    const html = `
      <h2>New Lead Converted Successfully</h2>
      <p><strong>Client Name:</strong> ${clientName}</p>
      <p><strong>Client Phone:</strong> ${clientPhone}</p>
      <p><strong>Transaction ID:</strong> ${transactionId}</p>
      <p><strong>Amount:</strong> ₹${amount}</p>
      <br>
      <p>This lead was converted and closed successfully.</p>
    `;

    const response = await axios.post(mailServiceUrl, {
      to: admin.receiverMail,
      subject: `New Conversion: ₹${amount} - ${clientName}`,
      html
    });

    console.log(`[Email Trigger] Mail sent successfully to ${admin.receiverMail} for contact ${contactId}`);
    return { success: true, messageId: response.data?.messageId };
  } catch (error) {
    console.error(`[Email Trigger] Failed to send email for contact ${contactId}:`, error.message);
    return { success: false, reason: error.message };
  }
}

module.exports = { triggerConversionEmail };
