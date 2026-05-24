const sgMail = require('@sendgrid/mail');
const dns = require('dns');

// Force IPv4 for any DNS lookups
const originalLookup = dns.lookup;
dns.lookup = function(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = { family: 4, hints: dns.ADDRCONFIG };
  } else if (typeof options === 'object') {
    options.family = 4;
    options.hints = dns.ADDRCONFIG;
  } else {
    options = { family: 4, hints: dns.ADDRCONFIG };
  }
  return originalLookup(hostname, options, callback);
};

const sendConversionEmail = async (senderEmail, apiKey, receiverEmail, companyName, emailDetails) => {
  // Initialize SendGrid with API key
  sgMail.setApiKey(apiKey);
  
  const { leadName, contact, agentName, tlName, adminName, amount, transactionId, receiptImageBase64 } = emailDetails;
  
  let htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 8px;">
      <h2 style="color: #4CAF50; text-align: center;">🎉 Lead Successfully Converted!</h2>
      <p>Hello,</p>
      <p>A lead has been successfully converted and the transaction details have been logged.</p>
      
      <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
        <tr style="background-color: #f9f9f9;"><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Lead Name</td><td style="padding: 10px; border: 1px solid #ddd;">${leadName}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Contact</td><td style="padding: 10px; border: 1px solid #ddd;">${contact}</td></tr>
        <tr style="background-color: #f9f9f9;"><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Amount</td><td style="padding: 10px; border: 1px solid #ddd;">₹${amount}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Transaction ID</td><td style="padding: 10px; border: 1px solid #ddd;">${transactionId || 'N/A'}</td></tr>
        <tr style="background-color: #f9f9f9;"><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Agent Name</td><td style="padding: 10px; border: 1px solid #ddd;">${agentName}</td></tr>
        <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">TL Name</td><td style="padding: 10px; border: 1px solid #ddd;">${tlName}</td></tr>
        <tr style="background-color: #f9f9f9;"><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Admin Name</td><td style="padding: 10px; border: 1px solid #ddd;">${adminName}</td></tr>
      </table>
      
      <p style="margin-top: 20px; font-size: 0.9em; color: #555;">Sent via <strong>${companyName || 'CRM System'}</strong></p>
    </div>
  `;

  const msg = {
    to: receiverEmail,
    from: senderEmail, // Must be a verified sender in SendGrid
    subject: `Lead Converted: ${leadName} (Amount: ₹${amount})`,
    html: htmlContent,
  };

  if (receiptImageBase64) {
    const base64Data = receiptImageBase64.replace(/^data:image\/\w+;base64,/, "");
    msg.attachments = [
      {
        content: base64Data,
        filename: 'receipt.png',
        type: 'image/png',
        disposition: 'attachment'
      }
    ];
  }

  try {
    const response = await sgMail.send(msg);
    console.log('Conversion email sent successfully via SendGrid');
    return true;
  } catch (error) {
    console.error('Error sending conversion email via SendGrid:', error);
    if (error.response) {
      console.error('SendGrid error details:', error.response.body);
    }
    return false;
  }
};

module.exports = { sendConversionEmail };
