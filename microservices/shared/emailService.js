const nodemailer = require('nodemailer');
const dns = require('dns');
const net = require('net');

// More aggressive IPv4 enforcement
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

// Also override dns.resolve to force IPv4
const originalResolve = dns.resolve;
dns.resolve = function(hostname, rrtype, callback) {
  if (rrtype === 'AAAA') {
    // Return empty array for IPv6 queries
    if (typeof callback === 'function') {
      return callback(null, []);
    }
  }
  return originalResolve.apply(dns, arguments);
};

// Create a custom socket that forces IPv4
const createIPv4Socket = () => {
  const socket = new net.Socket();
  socket.on('lookup', (err, address, family, host) => {
    if (family === 6) {
      console.log('IPv6 detected, forcing reconnect to IPv4');
      socket.destroy();
    }
  });
  return socket;
};

const sendConversionEmail = async (senderEmail, appPassword, receiverEmail, companyName, emailDetails) => {
  // Get IPv4 address of smtp.gmail.com
  let smtpHost = 'smtp.gmail.com';
  let smtpPort = 587;
  
  // Try to resolve IPv4 address manually
  try {
    const addresses = await new Promise((resolve, reject) => {
      dns.resolve4('smtp.gmail.com', (err, addresses) => {
        if (err) reject(err);
        else resolve(addresses);
      });
    });
    
    if (addresses && addresses.length > 0) {
      smtpHost = addresses[0]; // Use IP directly to bypass DNS
      console.log(`Resolved smtp.gmail.com to IPv4: ${smtpHost}`);
    }
  } catch (err) {
    console.log('Failed to resolve IPv4, using hostname:', err.message);
  }
  
  // Create transporter with comprehensive IPv4 configuration
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: false,
    family: 4,
    localAddress: '0.0.0.0', // Force IPv4 local address
    auth: {
      user: senderEmail,
      pass: appPassword
    },
    tls: {
      rejectUnauthorized: false,
      ciphers: 'SSLv3',
      minVersion: 'TLSv1'
    },
    socketTimeout: 60000, // Increased timeout
    connectionTimeout: 60000, // Increased timeout
    greetingTimeout: 30000,
    debug: true, // Enable debug to see what's happening
    pool: false,
    maxConnections: 1,
    rateLimit: 0,
    maxMessages: 1
  });

  // Try multiple connection strategies
  const connectionStrategies = [
    async () => {
      // Strategy 1: Direct connection with resolved IP
      console.log('Strategy 1: Direct connection with resolved IPv4');
      await transporter.verify();
      return true;
    },
    async () => {
      // Strategy 2: Use hostname with different port (465)
      console.log('Strategy 2: Using port 465 with SSL');
      const transporter2 = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        family: 4,
        auth: {
          user: senderEmail,
          pass: appPassword
        },
        tls: {
          rejectUnauthorized: false
        },
        socketTimeout: 60000,
        connectionTimeout: 60000
      });
      await transporter2.verify();
      // If successful, reassign transporter
      Object.assign(transporter, transporter2);
      return true;
    },
    async () => {
      // Strategy 3: Use Google's alternative SMTP
      console.log('Strategy 3: Using alt1.gmail-smtp-in.l.google.com');
      const transporter3 = nodemailer.createTransport({
        host: 'alt1.gmail-smtp-in.l.google.com',
        port: 587,
        secure: false,
        family: 4,
        auth: {
          user: senderEmail,
          pass: appPassword
        },
        tls: {
          rejectUnauthorized: false
        }
      });
      await transporter3.verify();
      Object.assign(transporter, transporter3);
      return true;
    }
  ];

  let connected = false;
  for (let i = 0; i < connectionStrategies.length; i++) {
    try {
      await connectionStrategies[i]();
      connected = true;
      console.log(`Successfully connected using strategy ${i + 1}`);
      break;
    } catch (err) {
      console.log(`Strategy ${i + 1} failed:`, err.message);
      if (i === connectionStrategies.length - 1) {
        throw new Error(`All connection strategies failed. Last error: ${err.message}`);
      }
    }
  }

  if (!connected) {
    throw new Error('Could not establish SMTP connection');
  }

  try {
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
    
    transporter.close();
    return true;
  } catch (error) {
    console.error('Error sending conversion email:', error);
    if (error.code === 'ETIMEDOUT') {
      console.error('Connection timeout - Network may be blocking outbound SMTP');
    } else if (error.code === 'EAUTH') {
      console.error('Authentication failed - Check email and app password');
    } else if (error.code === 'ESOCKET' || error.code === 'ENETUNREACH') {
      console.error('Socket/Network error - IPv6 connectivity issue');
    }
    return false;
  }
};

module.exports = { sendConversionEmail };
