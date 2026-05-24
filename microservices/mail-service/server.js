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
    console.error('SMTP Verify Error:', error);
  } else {
    console.log('✅ Brevo SMTP Connected');
  }
});

// API Route to send mail
app.post('/api/mail/send', async (req, res) => {
  try {
    const { to, subject, html } = req.body;

    if (!to) {
      return res.status(400).json({ error: 'Receiver email is required.' });
    }

    const mailOptions = {
      from: `"Spike CRM" <${BREVO_SENDER}>`,
      to,
      subject: subject || 'New Lead Converted',
      html: html || '<p>A new lead has been successfully converted.</p>'
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Message sent: %s', info.messageId);

    return res.json({ success: true, messageId: info.messageId });
  } catch (error) {
    console.error('Error sending email:', error);
    return res.status(500).json({ error: 'Failed to send email', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`📧 Mail Service running on port: ${PORT}`);
});
