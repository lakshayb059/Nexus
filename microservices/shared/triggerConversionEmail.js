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

    let mailServiceUrl = process.env.MAIL_SERVICE_URL || 'http://localhost:5006';
    if (!mailServiceUrl.endsWith('/api/mail/send')) {
      mailServiceUrl = `${mailServiceUrl.replace(/\/$/, '')}/api/mail/send`;
    }

    const amount        = contact.leadAmount || 0;
    const transactionId = contact.transactionId || 'N/A';
    const clientPhone   = contact.fields?.Phone || contact.fields?.phone || contact.fields?.Mobile || 'Unknown';
    const clientName    = contact.fields?.Name  || contact.fields?.name  || 'Client';
    const agentName     = agentUser?.name || contact.agentName || 'Unknown Agent';
    const remarks       = contact.remarks || 'N/A';
    const conversionDate = contact.conversionDate
      ? new Date(contact.conversionDate).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
      : new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    // Build extra fields from contact.fields (all custom CRM columns)
    const skipKeys = new Set(['Name', 'name', 'Phone', 'phone', 'Mobile', 'mobile', 'Email', 'email']);
    const extraFieldsHtml = Object.entries(contact.fields || {})
      .filter(([k]) => !skipKeys.has(k))
      .map(([k, v]) => `<tr><td style="padding:6px 12px;font-weight:600;color:#555;white-space:nowrap;">${k}</td><td style="padding:6px 12px;color:#222;">${v}</td></tr>`)
      .join('');

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:24px 32px;">
          <h1 style="color:#fff;margin:0;font-size:22px;letter-spacing:1px;">NEXUS CRM</h1>
          <p style="color:#a0aec0;margin:4px 0 0;font-size:13px;">Lead Conversion Notification</p>
        </div>

        <div style="padding:24px 32px;">
          <div style="background:#f0fff4;border-left:4px solid #38a169;padding:12px 16px;border-radius:4px;margin-bottom:20px;">
            <p style="margin:0;color:#276749;font-weight:700;font-size:15px;">✅ Lead Successfully Converted</p>
          </div>

          <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
            <tr style="background:#f7fafc;">
              <td style="padding:10px 12px;font-weight:700;color:#333;font-size:15px;" colspan="2">Client Details</td>
            </tr>
            <tr>
              <td style="padding:6px 12px;font-weight:600;color:#555;white-space:nowrap;">Client Name</td>
              <td style="padding:6px 12px;color:#222;">${clientName}</td>
            </tr>
            <tr style="background:#f7fafc;">
              <td style="padding:6px 12px;font-weight:600;color:#555;white-space:nowrap;">Phone</td>
              <td style="padding:6px 12px;color:#222;">${clientPhone}</td>
            </tr>
            ${extraFieldsHtml}
          </table>

          <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
            <tr style="background:#f7fafc;">
              <td style="padding:10px 12px;font-weight:700;color:#333;font-size:15px;" colspan="2">Transaction Details</td>
            </tr>
            <tr>
              <td style="padding:6px 12px;font-weight:600;color:#555;white-space:nowrap;">Amount</td>
              <td style="padding:6px 12px;color:#38a169;font-weight:700;font-size:16px;">₹${amount.toLocaleString('en-IN')}</td>
            </tr>
            <tr style="background:#f7fafc;">
              <td style="padding:6px 12px;font-weight:600;color:#555;white-space:nowrap;">Transaction ID</td>
              <td style="padding:6px 12px;color:#222;font-family:monospace;">${transactionId}</td>
            </tr>
            <tr>
              <td style="padding:6px 12px;font-weight:600;color:#555;white-space:nowrap;">Converted On</td>
              <td style="padding:6px 12px;color:#222;">${conversionDate}</td>
            </tr>
          </table>

          <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
            <tr style="background:#f7fafc;">
              <td style="padding:10px 12px;font-weight:700;color:#333;font-size:15px;" colspan="2">Agent Details</td>
            </tr>
            <tr>
              <td style="padding:6px 12px;font-weight:600;color:#555;white-space:nowrap;">Agent Name</td>
              <td style="padding:6px 12px;color:#222;">${agentName}</td>
            </tr>
            <tr style="background:#f7fafc;">
              <td style="padding:6px 12px;font-weight:600;color:#555;white-space:nowrap;">Remarks</td>
              <td style="padding:6px 12px;color:#222;">${remarks}</td>
            </tr>
          </table>
        </div>

        <div style="background:#f7fafc;padding:14px 32px;text-align:center;border-top:1px solid #e0e0e0;">
          <p style="margin:0;color:#a0aec0;font-size:12px;">This is an automated notification from NEXUS CRM. Do not reply to this email.</p>
        </div>
      </div>
    `;

    const response = await axios.post(mailServiceUrl, {
      to: admin.receiverMail,
      subject: `✅ New Conversion: ₹${amount.toLocaleString('en-IN')} — ${clientName}`,
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
