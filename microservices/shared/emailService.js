const nodemailer = require('nodemailer');
const dns = require('dns');

// Force IPv4 for DNS resolution to prevent ENETUNREACH on Render's IPv6-less network
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const sendConversionEmail = async (senderEmail, appPassword, receiverEmail, companyName, emailDetails) => {
  const transporter = nodemailer.createTransport({
    pool: true,
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // use TLS
    requireTLS: true,
    auth: {
      user: senderEmail,
      pass: appPassword
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  try {
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

    const mailOptions = {
      from: `"${companyName || 'CRM System'}" <${senderEmail}>`,
      to: receiverEmail,
      subject: `Lead Converted: ${leadName} (Amount: ₹${amount})`,
      html: htmlContent
    };

    if (receiptImageBase64) {
      const base64Data = receiptImageBase64.replace(/^data:image\/\w+;base64,/, "");
      mailOptions.attachments = [
        {
          filename: 'receipt.png',
          content: base64Data,
          encoding: 'base64'
        }
      ];
    }

    const info = await transporter.sendMail(mailOptions);
    console.log('Conversion email sent: ' + info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending conversion email:', error);
    return false;
  }
};

module.exports = { sendConversionEmail };
