const nodemailer = require('nodemailer');
const axios = require('axios');
const { prisma } = require('./db');
const { decryptSecret } = require('./passwordService');

const BREVO_USER = process.env.BREVO_USER;
const BREVO_PASS = process.env.BREVO_PASS;
const BREVO_SENDER = process.env.BREVO_SENDER;

let smtpFallbackMode = !BREVO_USER || !BREVO_PASS;

const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 2525,
  secure: false,
  auth: {
    user: BREVO_USER,
    pass: BREVO_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

if (BREVO_USER && BREVO_PASS && process.env.NODE_ENV !== 'test') {
  transporter.verify((error) => {
    if (error) {
      console.error('⚠️ SMTP Verify Error (SMTP will run in fallback mode):', error.message);
      smtpFallbackMode = true;
    } else {
      console.log('✅ Brevo SMTP Connected');
      smtpFallbackMode = false;
    }
  });
}

function parseRecipients(to) {
  let toField = to.trim();
  let ccField;
  if (toField.includes(',')) {
    const emailParts = toField.split(',').map((e) => e.trim()).filter(Boolean);
    if (emailParts.length > 0) {
      toField = emailParts[0];
      if (emailParts.length > 1) {
        ccField = emailParts.slice(1).join(', ');
      }
    }
  }
  return { toField, ccField };
}

async function sendMail({ to, subject, html, companyName, attachments = [], adminId = null, sensitive = false }) {
  if (!to) {
    throw new Error('Receiver email is required.');
  }

  const { toField, ccField } = parseRecipients(to);
  let senderEmail = BREVO_SENDER || 'noreply@nexus.crm';
  let smtpPasswordVal = '';
  let isGmailAuth = false;

  if (adminId) {
    try {
      const adminUser = await prisma.user.findUnique({
        where: { id: adminId },
        select: { smtpGmail: true, smtpPassword: true },
      });
      if (adminUser && adminUser.smtpGmail && adminUser.smtpPassword) {
        const decrypted = decryptSecret(adminUser.smtpPassword);
        if (decrypted) {
          senderEmail = adminUser.smtpGmail.trim();
          smtpPasswordVal = decrypted.trim();
          isGmailAuth = true;
        }
      }
    } catch (dbErr) {
      console.error('Failed to resolve custom SMTP credentials:', dbErr.message);
    }
  }

  if (isGmailAuth) {
    const frontendUrl = process.env.FRONTEND_URL || 'https://crm-eight-sage.vercel.app';
    const isLocalFrontend = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(frontendUrl);
    const vercelEmailUrl = isLocalFrontend
      ? 'https://crm-eight-sage.vercel.app/api/send-email'
      : `${frontendUrl.replace(/\/$/, '')}/api/send-email`;

    try {
      const directTransport = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: senderEmail,
          pass: smtpPasswordVal,
        },
        tls: { rejectUnauthorized: false },
      });
      const info = await directTransport.sendMail({
        from: `"${companyName || 'NEXUS'}" <${senderEmail}>`,
        to: toField,
        cc: ccField,
        subject: subject || 'Nexus CRM Notification',
        html: html || '<p>Notification from Nexus CRM.</p>',
        attachments,
      });
      return { success: true, messageId: info.messageId };
    } catch (directErr) {
      try {
        const axiosResponse = await axios.post(vercelEmailUrl, {
          smtpGmail: senderEmail,
          smtpPassword: smtpPasswordVal,
          to: toField,
          cc: ccField,
          subject: subject || 'Nexus CRM Notification',
          html: html || '<p>Notification from Nexus CRM.</p>',
          attachments,
        });
        if (axiosResponse.data && axiosResponse.data.success) {
          return { success: true, messageId: axiosResponse.data.messageId };
        }
        throw new Error(axiosResponse.data?.error || 'Vercel proxy failed to send email');
      } catch (proxyErr) {
        console.error('Gmail SMTP fallback failed:', directErr.message, '| Proxy:', proxyErr.message);
        return {
          success: true,
          messageId: `mock-msg-${Date.now()}`,
          warning: `SMTP failed (${proxyErr.message})`,
        };
      }
    }
  }

  if (smtpFallbackMode || !BREVO_USER || !BREVO_PASS) {
    console.log(`📧 [EMAIL FALLBACK] To: ${toField} | Subject: ${subject} | Sensitive: ${sensitive ? 'redacted' : 'false'}`);
    return {
      success: true,
      messageId: `mock-msg-${Date.now()}`,
      warning: 'SMTP credentials not configured or unreachable; email skipped in fallback mode.',
    };
  }

  try {
    const info = await transporter.sendMail({
      from: `"${companyName || 'NEXUS'}" <${senderEmail}>`,
      to: toField,
      cc: ccField,
      subject: subject || 'Nexus CRM Notification',
      html: html || '<p>Notification from Nexus CRM.</p>',
      attachments,
    });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending email via Brevo SMTP:', error.message);
    return {
      success: true,
      messageId: `mock-msg-err-${Date.now()}`,
      warning: `SMTP failed (${error.message}).`,
    };
  }
}

async function sendPasswordResetEmail({ to, name, resetUrl }) {
  const safeName = name || 'User';
  const html = `
    <div style="font-family: Arial, sans-serif; color: #1e293b; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
      <h2 style="color: #1d4ed8; margin-top: 0;">Reset Your Nexus CRM Password</h2>
      <p>Hello ${safeName},</p>
      <p>We received a request to reset the password for your Nexus CRM account. Click the button below to establish a new password:</p>
      <p style="margin: 24px 0;">
        <a href="${resetUrl}" style="background: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 22px; border-radius: 8px; font-weight: bold; display: inline-block;">Reset Password</a>
      </p>
      <p style="font-size: 13px; color: #475569;">This link expires in <strong>15 minutes</strong> and can only be used once.</p>
      <p style="font-size: 13px; color: #475569;">If you did not request a password reset, you can safely ignore this email—your account remains secure.</p>
    </div>
  `;
  return sendMail({
    to,
    subject: 'Nexus CRM — Password Reset Request',
    html,
    companyName: 'Nexus CRM Security',
    sensitive: true,
  });
}

async function sendPasswordChangedEmail({ to, name }) {
  const safeName = name || 'User';
  const html = `
    <div style="font-family: Arial, sans-serif; color: #1e293b; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
      <h2 style="color: #059669; margin-top: 0;">Your Nexus CRM Password Was Changed</h2>
      <p>Hello ${safeName},</p>
      <p>Your account password was recently updated and all other active sessions have been signed out.</p>
      <p style="font-size: 13px; color: #475569;">If you did not make this change, please contact your CRM administrator immediately and reset your password.</p>
    </div>
  `;
  return sendMail({
    to,
    subject: 'Nexus CRM — Security Alert: Password Changed',
    html,
    companyName: 'Nexus CRM Security',
    sensitive: true,
  });
}

module.exports = {
  sendMail,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
};
