const nodemailer = require('nodemailer');
const dns = require('dns');

const sendConversionEmail = async (senderEmail, appPassword, receiverEmail, companyName, emailDetails) => {
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

  // 1) Force resolve IPv4 address for Gmail SMTP to completely bypass Render's IPv6 ENETUNREACH issues
  let ipv4Host = 'smtp.gmail.com';
  try {
    const addresses = await new Promise((resolve, reject) => {
      dns.resolve4('smtp.gmail.com', (err, addresses) => {
        if (err) reject(err);
        else resolve(addresses);
      });
    });
    if (addresses && addresses.length > 0) {
      ipv4Host = addresses[0];
      console.log(`Resolved smtp.gmail.com to IPv4: ${ipv4Host}`);
    }
  } catch (err) {
    console.log('DNS Resolution failed, falling back to hostname:', err.message);
  }

  // 2) Use Port 465 (SMTPS) which is fully encrypted from start to finish
  const transporter = nodemailer.createTransport({
    host: ipv4Host,
    port: 465,
    secure: true,
    family: 4, // Explicitly enforce IPv4
    auth: {
      user: senderEmail,
      pass: appPassword
    },
    tls: {
      // Must provide servername so the SSL certificate matches 'smtp.gmail.com' rather than the raw IP
      servername: 'smtp.gmail.com',
      rejectUnauthorized: false
    },
    socketTimeout: 45000,
    connectionTimeout: 45000,
    logger: true,
    debug: true
  });

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

  try {
    console.log(`Attempting to send email via SMTP (${ipv4Host}:465) for ${leadName}`);
    const info = await transporter.sendMail(mailOptions);
    console.log('Conversion email sent successfully: ' + info.messageId);
    transporter.close();
    return true;
  } catch (error) {
    console.error('Error sending conversion email:', error);
    if (error.code === 'ETIMEDOUT') {
      console.error('Connection timeout - Network may be blocking outbound SMTP');
    } else if (error.code === 'EAUTH') {
      console.error('Authentication failed - Check email and app password');
    }
    transporter.close();
    return false;
  }
};

module.exports = { sendConversionEmail };
