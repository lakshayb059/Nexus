const nodemailer = require('nodemailer');
const dns = require('dns');

// Force IPv4 for DNS resolution to prevent ENETUNREACH on Render's IPv6-less network
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const sendConversionEmail = async (senderEmail, appPassword, receiverEmail, companyName, emailDetails) => {
  // Create transporter with better configuration for Render environment
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // use SSL
    family: 4, // Force IPv4 to avoid IPv6 issues on Render
    auth: {
      user: senderEmail,
      pass: appPassword
    },
    tls: {
      rejectUnauthorized: false,
      ciphers: 'SSLv3'
    },
    socketTimeout: 30000, // 30 seconds socket timeout
    connectionTimeout: 30000, // 30 seconds connection timeout
    debug: false, // Set to true for debugging
    pool: false // Disable connection pooling to avoid hanging connections
  });

  try {
    // Verify connection configuration before sending
    await transporter.verify();
    console.log('SMTP connection verified successfully');
    
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
    console.log('Conversion email sent successfully: ' + info.messageId);
    
    // Close the transporter connection
    transporter.close();
    return true;
  } catch (error) {
    console.error('Error sending conversion email:', error);
    // Log more details about the error
    if (error.code === 'ETIMEDOUT') {
      console.error('Connection timeout - Check if Gmail SMTP is accessible from this network');
    } else if (error.code === 'EAUTH') {
      console.error('Authentication failed - Check email and app password');
    } else if (error.code === 'ESOCKET') {
      console.error('Socket error - Network connectivity issue');
    }
    return false;
  }
};

module.exports = { sendConversionEmail };
