// Force IPv4 at the process level
process.env.NODE_OPTIONS = '--dns-result-order=ipv4first';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

process.on('unhandledRejection', (reason) => {
  console.warn('⚠️ [Unhandled Rejection Handled]:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('❌ [Uncaught Exception Handled]:', err?.message || err);
});
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const axios = require('axios');
const { execSync } = require('child_process');
const path = require('path');

const { connect, prisma } = require('./shared/db');
const { sign, verify, authorize } = require('./shared/authMiddleware');
const { startEmailReplyWorker } = require('./shared/emailReplyWorker');
const { initRedisSocketAdapter, isRedisConnected } = require('./shared/redis');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Initialize Redis adapter for multi-worker Socket.io real-time cluster scale
initRedisSocketAdapter(io);

const PORT = process.env.PORT || 3000;

// Set up internal self-looping URL defaults for monolithic service resolution
if (!process.env.NOTIFICATION_SERVICE_URL) {
  process.env.NOTIFICATION_SERVICE_URL = `http://localhost:${PORT}/api`;
}
if (!process.env.MAIL_SERVICE_URL) {
  process.env.MAIL_SERVICE_URL = `http://localhost:${PORT}/api/mail/send`;
}

// Explicitly allowed origins for CORS
const ALLOWED_ORIGINS = [
  'https://crm-eight-sage.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  process.env.FRONTEND_URL
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    if (origin.endsWith('.vercel.app')) return callback(null, true);
    return callback(null, true); // Allow all for now
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-requested-with']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(morgan('dev'));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ limit: '15mb', extended: true }));
app.use(cookieParser());

// --- Database Sync (Prisma Migrations & Schema) ---
function syncDatabase() {
  if (!process.env.DATABASE_URL) {
    console.warn("⚠️ DATABASE_URL is not set. Skipping Prisma schema synchronization.");
    return;
  }
  try {
    console.log('🔄 Applying Prisma migrations...');
    const isLocal = process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1');
    let dbUrl = process.env.DATABASE_URL;
    if (!isLocal && !dbUrl.includes('sslmode=')) {
      dbUrl = dbUrl.includes('?') 
        ? `${dbUrl}&sslmode=require` 
        : `${dbUrl}?sslmode=require`;
    }
    
    const serverPath = __dirname;
    const execEnv = { 
      ...process.env, 
      DATABASE_URL: dbUrl, 
      NODE_OPTIONS: '--dns-result-order=ipv4first' 
    };
    try {
      execSync(`npx prisma migrate deploy`, { 
        cwd: serverPath,
        stdio: 'inherit',
        env: execEnv
      });
      console.log('✅ Prisma migrations deployed successfully.');
    } catch (migErr) {
      console.warn('⚠️ Migration deploy warning, ensuring schema sync via prisma db push:', migErr.message);
      execSync(`npx prisma db push --accept-data-loss`, { 
        cwd: serverPath,
        stdio: 'inherit',
        env: execEnv
      });
    }
  } catch (err) {
    console.error('❌ Failed to synchronize Prisma schema:', err.message);
  }
}

// --- Mailer SMTP Config & Verify ---
const BREVO_USER = process.env.BREVO_USER;
const BREVO_PASS = process.env.BREVO_PASS;
const BREVO_SENDER = process.env.BREVO_SENDER;
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
    console.error('⚠️ SMTP Verify Error (SMTP will run in fallback mode):', error.message);
    useFallback = true;
  } else {
    console.log('✅ Brevo SMTP Connected');
    useFallback = false;
  }
});

// --- Auth Router Definition ---
const authRouter = express.Router();
authRouter.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const user = await prisma.user.findUnique({
      where: { username: username.trim().toLowerCase() },
      select: { password: true, active: true, id: true, username: true, name: true, role: true, tlId: true, adminId: true, receiverMail: true }
    });

    if (!user) return res.json({ error: 'Invalid credentials' });
    if (!user.active) return res.json({ error: 'Your ID is inactive. Please contact admin.' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.json({ error: 'Invalid credentials' });

    const tokenPayload = {
      _id: user.id,
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      tlId: user.tlId,
      adminId: user.adminId,
      receiverMail: user.receiverMail
    };
    const token = sign(tokenPayload);

    // Close dangling agent sessions and start a new one
    if (user.role === 'agent') {
      try {
        const danglingSessions = await prisma.agentWorkLog.findMany({
          where: {
            userId: user.id,
            logoutAt: null
          }
        });
        for (const session of danglingSessions) {
          const logoutAt = new Date();
          const loginAt = new Date(session.loginAt);
          let lunchDuration = session.lunchDuration;
          let bioDuration = session.bioDuration;
          let teaDuration = session.teaDuration;
          if (session.activeBreakType && session.activeBreakStart) {
            const breakStart = new Date(session.activeBreakStart);
            const durationSeconds = Math.max(0, Math.floor((logoutAt - breakStart) / 1000));
            if (session.activeBreakType === 'lunch') lunchDuration += durationSeconds;
            if (session.activeBreakType === 'bio') bioDuration += durationSeconds;
            if (session.activeBreakType === 'tea') teaDuration += durationSeconds;
          }
          const totalSessionTime = Math.max(0, Math.floor((logoutAt - loginAt) / 1000));
          const totalWorkTime = Math.max(0, totalSessionTime - (lunchDuration + bioDuration + teaDuration));
          await prisma.agentWorkLog.update({
            where: { id: session.id },
            data: {
              logoutAt,
              lunchDuration,
              bioDuration,
              teaDuration,
              activeBreakType: null,
              activeBreakStart: null,
              totalWorkTime
            }
          });
        }

        await prisma.agentWorkLog.create({
          data: {
            userId: user.id,
            loginAt: new Date(),
            lastActiveAt: new Date()
          }
        });
        console.log(`🔑 Login: Started new work session for agent ${user.id}`);
      } catch (logErr) {
        console.error('⚠️ Failed to create login work log:', logErr.message);
      }
    }

    res.cookie('crm_session', token, {
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: 2 * 60 * 60 * 1000,
      secure: process.env.NODE_ENV === 'production'
    });

    res.json({
      token,
      user: { _id: user.id, username: user.username, name: user.name, role: user.role, tlId: user.tlId, adminId: user.adminId, receiverMail: user.receiverMail }
    });
  } catch (err) {
    console.error(`❌ [AUTH LOGIN FATAL ERROR]:`, err);
    res.status(500).json({ error: `Server error: ${err.message}` });
  }
});

// --- Users Router Definition ---
const usersRouter = express.Router();
usersRouter.get('/', verify, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    let where = { isDeleted: false };
    if (req.user.role === 'admin') {
      where.OR = [
        { id: req.user._id || req.user.id },
        { adminId: req.user._id || req.user.id }
      ];
    }
    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        tlId: true,
        adminId: true,
        receiverMail: true,
        smtpGmail: true,
        smtpPassword: true,
        active: true,
        isDeleted: true,
        createdAt: true,
        updatedAt: true,
      }
    });
    res.json(users.map(u => ({ ...u, _id: u.id })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

usersRouter.get('/my-agents', verify, authorize('tl'), async (req, res) => {
  try {
    const agents = await prisma.user.findMany({ 
      where: {
        role: 'agent', 
        tlId: req.user._id || req.user.id,
        isDeleted: false
      },
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        tlId: true,
        adminId: true,
        active: true,
        isDeleted: true,
        createdAt: true,
        updatedAt: true,
      }
    });
    res.json(agents.map(a => ({ ...a, _id: a.id })));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

usersRouter.post('/', verify, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const { username, password, name, role, tlId, receiverMail, smtpGmail, smtpPassword } = req.body;
    
    if (role === 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Only Super Admin can create Admin users' });
    }
    if (req.user.role === 'superadmin' && role !== 'admin') {
      return res.status(403).json({ error: 'Super Admin can only create Admin users from the dashboard' });
    }

    const existingUsername = await prisma.user.findUnique({ where: { username: username.trim().toLowerCase() } });
    if (existingUsername) return res.status(409).json({ error: 'Username already exists. Please use a unique username.' });

    const existingName = await prisma.user.findFirst({
      where: {
        name: {
          equals: name.trim(),
          mode: 'insensitive'
        },
        isDeleted: false
      }
    });
    if (existingName) {
      return res.status(409).json({ error: 'Name already exists. Please use a unique name.' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const userData = {
      username: username.trim().toLowerCase(),
      password: hashed,
      name: name.trim(),
      role,
      tlId: role === 'agent' ? (tlId ? tlId : null) : null,
      adminId: req.user.role === 'admin' ? (req.user._id || req.user.id) : null,
      active: true,
      isDeleted: false,
    };

    if (role === 'admin') {
      userData.receiverMail = receiverMail ? receiverMail.trim() : null;
      userData.smtpGmail = smtpGmail ? smtpGmail.trim() : null;
      userData.smtpPassword = smtpPassword ? smtpPassword.trim() : null;
    }
    
    const result = await prisma.user.create({ data: userData });
    io.emit('users_updated');
    const { password: _, ...userWithoutPassword } = result;
    res.status(201).json({ ...userWithoutPassword, _id: result.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

usersRouter.put('/:id', verify, authorize(['superadmin', 'admin']), async (req, res) => {
  try {
    const { name, password, active, tlId, agentAction, newTlId, reactivateAgents } = req.body;
    const userId = req.params.id;
    
    const existingUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!existingUser) return res.status(404).json({ error: 'User not found' });

    const updateData = {};
    if (name) {
      const existingName = await prisma.user.findFirst({
        where: {
          name: {
            equals: name.trim(),
            mode: 'insensitive'
          },
          isDeleted: false,
          id: { not: userId }
        }
      });
      if (existingName) {
        return res.status(409).json({ error: 'Name already exists. Please use a unique name.' });
      }
      updateData.name = name.trim();
    }
    if (active !== undefined) updateData.active = !!active;
    if (tlId !== undefined) updateData.tlId = tlId ? tlId : null;
    if (password) updateData.password = await bcrypt.hash(password, 10);
    if (req.body.receiverMail !== undefined) updateData.receiverMail = req.body.receiverMail.trim() || null;
    if (req.body.smtpGmail !== undefined) updateData.smtpGmail = req.body.smtpGmail.trim() || null;
    if (req.body.smtpPassword !== undefined) updateData.smtpPassword = req.body.smtpPassword.trim() || null;

    if (existingUser.role === 'tl' && !!active === false && existingUser.active === true) {
      const agentsUnderTL = await prisma.user.findMany({ 
        where: {
          role: 'agent', 
          tlId: userId,
          isDeleted: false
        }
      });

      if (agentsUnderTL.length > 0) {
        if (agentAction === 'inactivate') {
          await prisma.user.updateMany({
            where: { role: 'agent', tlId: userId, isDeleted: false },
            data: { active: false }
          });
        } else if (agentAction === 'reassign' && newTlId) {
          await prisma.user.updateMany({
            where: { role: 'agent', tlId: userId, isDeleted: false },
            data: { tlId: newTlId }
          });
        } else {
          return res.status(400).json({ 
            error: 'Disposition required', 
            needsAction: true, 
            agentCount: agentsUnderTL.length 
          });
        }
      }
    }

    if (existingUser.role === 'tl' && !!active === true && existingUser.active === false) {
      if (reactivateAgents === true) {
        await prisma.user.updateMany({
          where: { role: 'agent', tlId: userId, active: false, isDeleted: false },
          data: { active: true }
        });
      }
    }

    await prisma.user.update({
      where: { id: userId },
      data: updateData
    });
    io.emit('users_updated');
    res.json({ success: true });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

usersRouter.delete('/wipe', verify, authorize(['superadmin']), async (req, res) => {
  try {
    await prisma.user.deleteMany({
      where: { role: { not: 'superadmin' } }
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Wipe users error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

usersRouter.delete('/:id', verify, authorize(['superadmin']), async (req, res) => {
  try {
    const userId = req.params.id;
    await prisma.user.update({
      where: { id: userId },
      data: { isDeleted: true, active: false }
    });
    io.emit('users_updated');
    res.json({ success: true });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// --- Mail Router Definition ---
const mailRouter = express.Router();
mailRouter.post('/test-connection', verify, async (req, res) => {
  const { smtpGmail, smtpPassword, receiverMail } = req.body;
  if (!smtpGmail || !smtpPassword || !receiverMail) {
    return res.status(400).json({ error: 'All fields (SMTP Gmail, App Password, and Receiver Email) are required for testing.' });
  }

  let toField = receiverMail.trim();
  let ccField = undefined;

  if (receiverMail.includes(',')) {
    const emailParts = receiverMail.split(',').map(e => e.trim()).filter(Boolean);
    if (emailParts.length > 0) {
      toField = emailParts[0];
      if (emailParts.length > 1) {
        ccField = emailParts.slice(1).join(', ');
      }
    }
  }

  const frontendUrl = process.env.FRONTEND_URL || 'https://crm-eight-sage.vercel.app';
  const vercelEmailUrl = `${frontendUrl.replace(/\/$/, '')}/api/send-email`;

  try {
    const axiosResponse = await axios.post(vercelEmailUrl, {
      smtpGmail: smtpGmail.trim(),
      smtpPassword: smtpPassword.trim(),
      to: toField,
      cc: ccField,
      subject: '🔍 Spike CRM: SMTP Connection Test',
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 500px; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #10b981; margin-top: 0;">Connection Successful!</h2>
          <p>This is a test email confirming that your custom Google Gmail SMTP settings are working perfectly in Spike CRM via Vercel proxy.</p>
          <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 15px 0;" />
          <p style="margin-bottom: 5px;"><strong>Sender Email:</strong> <span style="font-family: monospace;">${smtpGmail}</span></p>
          <p style="margin-top: 0;"><strong>Receiver Email:</strong> <span style="font-family: monospace;">${receiverMail}</span></p>
          <p style="font-size: 0.85rem; color: #64748b; margin-top: 20px;">You can now safely save these settings in your dashboard.</p>
        </div>
      `
    });

    if (axiosResponse.data && axiosResponse.data.success) {
      res.json({ success: true });
    } else {
      throw new Error(axiosResponse.data?.error || 'Failed to send test email via proxy');
    }
  } catch (err) {
    console.error('SMTP Test Connection failed:', err);
    res.status(500).json({ error: err.response?.data?.error || err.message });
  }
});
mailRouter.post('/send', async (req, res) => {
  try {
    const { to, subject, html, companyName, attachments, adminId } = req.body;
    if (!to) return res.status(400).json({ error: 'Receiver email is required.' });

    let toField = to.trim();
    let ccField = undefined;

    if (to.includes(',')) {
      const emailParts = to.split(',').map(e => e.trim()).filter(Boolean);
      if (emailParts.length > 0) {
        toField = emailParts[0];
        if (emailParts.length > 1) {
          ccField = emailParts.slice(1).join(', ');
        }
      }
    }

    let senderEmail = BREVO_SENDER || 'noreply@nexus.crm';
    let smtpPasswordVal = '';
    let isGmailAuth = false;
    let gmailAuthError = null;

    if (adminId) {
      try {
        const adminUser = await prisma.user.findUnique({ where: { id: adminId } });
        if (adminUser && adminUser.smtpGmail && adminUser.smtpPassword) {
          senderEmail = adminUser.smtpGmail.trim();
          smtpPasswordVal = adminUser.smtpPassword.trim();
          isGmailAuth = true;
        }
      } catch (dbErr) {
        console.error('Failed to resolve custom SMTP credentials:', dbErr);
      }
    }

    const mailOptions = {
      from: `"${companyName || 'NEXUS'}" <${senderEmail}>`,
      to: toField,
      cc: ccField,
      subject: subject || 'New Lead Converted',
      html: html || '<p>A new lead has been successfully converted.</p>',
      attachments: attachments || []
    };

    // If using custom Gmail SMTP, run sending via Vercel proxy to bypass Render blocks
    if (isGmailAuth) {
      const frontendUrl = process.env.FRONTEND_URL || 'https://crm-eight-sage.vercel.app';
      const vercelEmailUrl = `${frontendUrl.replace(/\/$/, '')}/api/send-email`;
      try {
        const axiosResponse = await axios.post(vercelEmailUrl, {
          smtpGmail: senderEmail,
          smtpPassword: smtpPasswordVal,
          to: toField,
          cc: ccField,
          subject: subject || 'New Lead Converted',
          html: html || '<p>A new lead has been successfully converted.</p>',
          attachments
        });
        if (axiosResponse.data && axiosResponse.data.success) {
          console.log('Message sent via Vercel SMTP relay: %s', axiosResponse.data.messageId);
          return res.json({ success: true, messageId: axiosResponse.data.messageId });
        } else {
          throw new Error(axiosResponse.data?.error || 'Vercel proxy failed to send email');
        }
      } catch (proxyErr) {
        console.error('Gmail SMTP via Vercel proxy failed:', proxyErr.message);
        gmailAuthError = proxyErr.message;
        
        // Fallback to console log mock
        console.log('\n============================================================');
        console.log(`📧 [MOCK EMAIL LOG - SMTP FALLBACK ENABLED]`);
        console.log(`Reason:  Gmail SMTP via Vercel proxy failed (${proxyErr.message})`);
        console.log(`From:    "${companyName || 'NEXUS'}" <${senderEmail}>`);
        console.log(`To:      ${toField}`);
        console.log(`CC:      ${ccField || 'None'}`);
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
          warning: `SMTP authentication failed or Vercel proxy timed out. Email logged to console. Details: ${proxyErr.message}`
        });
      }
    }

    // Otherwise, use global Brevo SMTP credentials
    let localUseFallback = useFallback;
    if (!BREVO_USER || !BREVO_PASS) {
      localUseFallback = true;
    }

    if (localUseFallback) {
      console.log('\n============================================================');
      console.log(`📧 [MOCK EMAIL LOG - SMTP FALLBACK ENABLED]`);
      console.log(`Reason:  Global SMTP credentials not configured`);
      console.log(`From:    "${companyName || 'NEXUS'}" <${senderEmail}>`);
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
        warning: `SMTP authentication failed or credentials not configured. Email logged to console.`
      });
    }

    const info = await transporter.sendMail(mailOptions);
    console.log('Message sent: %s', info.messageId);
    return res.json({ success: true, messageId: info.messageId });
  } catch (error) {
    console.error('Error sending email via SMTP, falling back to console log:', error);
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

// --- Notifications Router Definition ---
const notificationsRouter = express.Router();
notificationsRouter.post('/broadcast', (req, res) => {
  const { event, data } = req.body;
  if (!event) return res.status(400).json({ error: 'Event name required' });

  io.emit(event, data);
  res.json({ success: true });
});

notificationsRouter.get('/alerts', async (req, res) => {
  try {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const userId = req.query.userId;
    if (!userId) return res.json([]);

    const [pastAppts, pastCbs] = await Promise.all([
      prisma.contact.findMany({
        where: {
          assignedTo: userId,
          disposition: 'Appointment',
          appointmentDt: { lte: now, gte: yesterday },
          lateNotified: { not: true }
        },
        take: 10
      }),
      prisma.contact.findMany({
        where: {
          assignedTo: userId,
          OR: [
            { disposition: 'CallBack' },
            { status: 'Call Back' }
          ],
          callBackDt: { lte: now, gte: yesterday },
          cbReminderSent: { not: true }
        },
        take: 10
      })
    ]);

    const alerts = [
      ...pastAppts.map(a => ({
        type: 'appointment',
        title: '⚠️ Missed Appointment',
        message: `${(a.fields || {}).Name || (a.fields || {}).name || 'Contact'} — was at ${a.appointmentDt ? new Date(a.appointmentDt).toLocaleTimeString() : ''}`,
        path: '/appointments'
      })),
      ...pastCbs.map(c => ({
        type: 'callback',
        title: '⚠️ Missed Callback',
        message: `${(c.fields || {}).Name || (c.fields || {}).name || 'Contact'} — was at ${c.callBackDt ? new Date(c.callBackDt).toLocaleTimeString() : ''}`,
        path: '/callbacks'
      }))
    ];

    res.json(alerts);
  } catch (err) { res.status(500).json({ error: 'Alerts fetch failed' }); }
});

// --- Unified Route Registration ---
const apiRouter = express.Router();

// Mount Auth & User Router
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/agent-logs', require('./routes/agent-logs'));

// Mount Lead-Service Routers
apiRouter.use('/contacts', require('./routes/contacts'));
apiRouter.use('/leads', require('./routes/leads'));
apiRouter.use('/leads-management', require('./routes/leads-management'));

// Mount Notification Router
apiRouter.use('/notifications', notificationsRouter);

// Mount Reporting & Upload Router
apiRouter.use('/reports', require('./routes/reports'));
apiRouter.use('/upload', require('./routes/upload'));

// Mount Mail Router
apiRouter.use('/mail', mailRouter);

// --- Health Check Endpoints ---
app.get('/health', (req, res) => res.json({ 
  status: 'Monolith is up', 
  redis: isRedisConnected() ? 'connected' : 'fallback-memory',
  timestamp: new Date() 
}));
app.get('/', (req, res) => res.json({ status: 'Monolith is active', timestamp: new Date() }));

// API mapping
app.use('/api', apiRouter);
// Gateway fallback / non-API fallback mapping
app.use('/', apiRouter);

// --- Socket.io Handlers ---
io.on('connection', (socket) => {
  console.log('📡 Real-time Client connected:', socket.id);
  socket.on('disconnect', () => console.log('📡 Real-time Client disconnected:', socket.id));
});

// --- Missed/Upcoming Reminders Check Workers with Concurrency Guards ---
let isCheckingAppointments = false;
async function checkAppointments() {
  if (isCheckingAppointments) return;
  isCheckingAppointments = true;
  try {
    const now = new Date();
    const upcoming = await prisma.contact.findMany({
      where: {
        disposition: 'Appointment',
        appointmentDt: { gte: now, lte: new Date(now.getTime() + 2.5 * 60 * 1000) },
        reminderSent: { not: true }
      },
      take: 50
    });

    for (const app of upcoming) {
      io.emit('appointment_reminder', {
        appointmentId: app.id,
        contactName: (app.fields || {}).Name || (app.fields || {}).name || 'Unknown',
        appointmentTime: app.appointmentDt,
        agentId: app.assignedTo,
        minutesUntil: Math.max(0, Math.round((new Date(app.appointmentDt) - now) / 60000))
      });
      await prisma.contact.update({ where: { id: app.id }, data: { reminderSent: true } });
    }
  } catch (err) {
    // Silent catch during transient network hiccup
  } finally {
    isCheckingAppointments = false;
  }
}

let isCheckingCallbacks = false;
async function checkCallbacks() {
  if (isCheckingCallbacks) return;
  isCheckingCallbacks = true;
  try {
    const now = new Date();
    const upcoming = await prisma.contact.findMany({
      where: {
        OR: [
          { disposition: 'CallBack' },
          { status: 'Call Back' }
        ],
        callBackDt: { gte: now, lte: new Date(now.getTime() + 2.5 * 60 * 1000) },
        cbReminderSent: { not: true }
      },
      take: 50
    });

    for (const cb of upcoming) {
      io.emit('callback_reminder', {
        callbackId: cb.id,
        contactName: (cb.fields || {}).Name || (cb.fields || {}).name || 'Unknown',
        callbackTime: cb.callBackDt,
        agentId: cb.assignedTo,
        isLeadCallback: cb.status === 'Call Back',
        minutesUntil: Math.max(0, Math.round((new Date(cb.callBackDt) - now) / 60000))
      });
      await prisma.contact.update({ where: { id: cb.id }, data: { cbReminderSent: true } });
    }
  } catch (err) {
    // Silent catch during transient network hiccup
  } finally {
    isCheckingCallbacks = false;
  }
}

let isCheckingSessions = false;
async function checkInactiveSessions() {
  if (isCheckingSessions) return;
  isCheckingSessions = true;
  try {
    const now = new Date();
    const idleLimitMs = 10 * 60 * 1000; // 10 minutes
    const thresholdTime = new Date(now.getTime() - idleLimitMs);

    // Find all active agent sessions that are NOT on a break and are idle for >10 mins
    const inactiveSessions = await prisma.agentWorkLog.findMany({
      where: {
        logoutAt: null,
        activeBreakType: null,
        lastActiveAt: {
          lt: thresholdTime
        }
      },
      take: 100
    });

    for (const session of inactiveSessions) {
      const logoutAt = new Date(session.lastActiveAt.getTime() + idleLimitMs);
      const loginAt = new Date(session.loginAt);
      const totalSessionTime = Math.max(0, Math.floor((logoutAt - loginAt) / 1000));
      const totalBreaks = session.lunchDuration + session.bioDuration + session.teaDuration;
      const totalWorkTime = Math.max(0, totalSessionTime - totalBreaks);

      await prisma.agentWorkLog.update({
        where: { id: session.id },
        data: {
          logoutAt,
          totalWorkTime
        }
      });
      console.log(`⏰ Background Worker Auto-Logout: Closed session ${session.id} for user ${session.userId} due to 10m inactivity.`);
    }
  } catch (err) {
    // Silent catch during transient network hiccup
  } finally {
    isCheckingSessions = false;
  }
}

// --- Start Monolithic Server ---
async function start() {
  // Sync Prisma Schema
  syncDatabase();

  server.listen(PORT, () => {
    console.log(`🚀 CRM Monolithic Server running on http://localhost:${PORT}`);
    
    // Start background check interval workers (30s and 60s intervals to prevent remote DB connection hammering)
    setInterval(checkAppointments, 30000);
    setInterval(checkCallbacks, 30000);
    setInterval(checkInactiveSessions, 60000);
    startEmailReplyWorker();
  });

  // Seed default superadmin
  connect().then(async () => {
    try {
      const superAdminExists = await prisma.user.findFirst({ where: { role: 'superadmin' } });
      if (!superAdminExists) {
        const hashed = await bcrypt.hash('Lakshay@123', 10);
        await prisma.user.create({
          data: {
            username: 'superadmin@spike.crm',
            password: hashed,
            name: 'Super Admin',
            role: 'superadmin',
            active: true,
            isDeleted: false,
          }
        });
        console.log('🌟 Default Super Admin created successfully (superadmin@spike.crm)');
      }
    } catch(err) {
      console.error('⚠️ Default Super Admin seeding failed:', err.message);
    }
  }).catch(err => {
    console.error("❌ PostgreSQL connection failure via Prisma:", err.message);
  });
}

start();
