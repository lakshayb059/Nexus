require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.MAIL_SERVICE_PORT || process.env.PORT || 5006;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Default Mail Config
const MAIL_USER = process.env.MAIL_USER || 'garg.abhi999@gmail.com';
const MAIL_PASS = process.env.MAIL_PASS || 'wfwo qaqe tzjg rcej';

// Health Check Endpoints
app.get('/health', (req, res) => res.json({ status: 'Mail service is up', timestamp: new Date() }));
app.get('/', (req, res) => res.json({ status: 'Mail service is active', timestamp: new Date() }));

// Nodemailer Transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: MAIL_USER,
    pass: MAIL_PASS
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
      from: `"Spike CRM" <${MAIL_USER}>`,
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
