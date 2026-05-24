// Force IPv4 at the process level
process.env.NODE_OPTIONS = '--dns-result-order=ipv4first';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.MAIL_SERVICE_PORT || process.env.PORT || 5006;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Default Mail Config
const BREVO_USER = process.env.BREVO_USER;
const BREVO_PASS = process.env.BREVO_PASS;
const BREVO_SENDER = process.env.BREVO_SENDER;

// Health Check Endpoints
app.get('/health', (req, res) => res.json({ status: 'Mail service is up', timestamp: new Date() }));
app.get('/', (req, res) => res.json({ status: 'Mail service is active', timestamp: new Date() }));

let useFallback = false;

const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 2525,
  secure: false,
  auth: {
    user: BREVO_USER,
    pass: BREVO_PASS
  },
  tls: {
    rejectUnauthorized: false
  }
});

transporter.verify((error, success) => {
  if (error) {
    console.error('SMTP Verify Error (SMTP will run in fallback mode):', error.message);
    useFallback = true;
  } else {
    console.log('✅ Brevo SMTP Connected');
    useFallback = false;
  }
});

// API Route to send mail
app.post('/api/mail/send', async (req, res) => {
  try {
    const { to, subject, html, companyName, attachments } = req.body;

    if (!to) {
      return res.status(400).json({ error: 'Receiver email is required.' });
    }

    const mailOptions = {
      from: `"${companyName || 'NEXUS'}" <${BREVO_SENDER || 'noreply@nexus.crm'}>`,
      to,
      subject: subject || 'New Lead Converted',
      html: html || '<p>A new lead has been successfully converted.</p>',
      attachments: attachments || []
    };

    // If verification failed on startup or credentials are not configured, use fallback console logging
    if (useFallback || !BREVO_USER || !BREVO_PASS) {
      console.log('\n============================================================');
      console.log(`📧 [MOCK EMAIL LOG - SMTP FALLBACK ENABLED]`);
      console.log(`From:    "${companyName || 'NEXUS'}" <${BREVO_SENDER || 'noreply@nexus.crm'}>`);
      console.log(`To:      ${to}`);
      console.log(`Subject: ${subject}`);
      console.log(`Time:    ${new Date().toISOString()}`);
      console.log(`Attachments Count: ${attachments ? attachments.length : 0}`);
      console.log('------------------------------------------------------------');
      console.log('HTML Body Preview (First 500 chars):');
      console.log(html ? html.substring(0, 500) + '...' : 'None');
      console.log('============================================================\n');

      return res.json({ 
        success: true, 
        messageId: `mock-msg-${Date.now()}`,
        warning: 'SMTP authentication failed or credentials not configured. Email logged to console.'
      });
    }

    const info = await transporter.sendMail(mailOptions);
    console.log('Message sent: %s', info.messageId);

    return res.json({ success: true, messageId: info.messageId });
  } catch (error) {
    console.error('Error sending email via SMTP, falling back to console log:', error);

    // As a second line of defense, log the email if transporter fails at runtime
    console.log('\n============================================================');
    console.log(`📧 [MOCK EMAIL LOG - SMTP RUNTIME ERROR FALLBACK]`);
    console.log(`From:    "${companyName || 'NEXUS'}" <${BREVO_SENDER || 'noreply@nexus.crm'}>`);
    console.log(`To:      ${req.body.to}`);
    console.log(`Subject: ${req.body.subject}`);
    console.log(`Error:   ${error.message}`);
    console.log(`Attachments Count: ${req.body.attachments ? req.body.attachments.length : 0}`);
    console.log('------------------------------------------------------------');
    console.log('HTML Body Preview (First 500 chars):');
    console.log(req.body.html ? req.body.html.substring(0, 500) + '...' : 'None');
    console.log('============================================================\n');

    return res.json({ 
      success: true, 
      messageId: `mock-msg-err-${Date.now()}`,
      warning: `SMTP failed (${error.message}). Email logged to console.`
    });
  }
});

app.listen(PORT, () => {
  console.log(`📧 Mail Service running on port: ${PORT}`);
});
