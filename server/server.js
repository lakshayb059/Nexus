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
const axios = require('axios');
const { execSync } = require('child_process');

const { connect, prisma } = require('./shared/db');
const { verify, csrfProtect, authorize, authenticateSocket } = require('./shared/authMiddleware');
const { hashPassword } = require('./shared/passwordService');
const { sendMail } = require('./shared/mailService');
const { cloudflareSecurityHeaders } = require('./shared/cloudflareService');
const { startEmailReplyWorker } = require('./shared/emailReplyWorker');
const { initRedisSocketAdapter, isRedisConnected } = require('./shared/redis');
const { setSocketServer } = require('./shared/notificationClient');
const { createAuthRouter } = require('./routes/auth');
const { createUsersRouter } = require('./routes/users');

function isOriginAllowed(origin) {
  if (!origin) return true;
  const allowedOrigins = [
    'https://crm-eight-sage.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000',
    process.env.FRONTEND_URL,
  ].filter(Boolean);

  if (allowedOrigins.includes(origin)) return true;
  if (origin.endsWith('.vercel.app')) return true;
  if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return true;
  }
  return false;
}

function createApp(options = {}) {
  const { enableRedisAdapter = true } = options;
  const app = express();
  const server = http.createServer(app);

  const corsOptions = {
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) return callback(null, true);
      return callback(new Error('Origin not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'x-requested-with'],
  };

  const io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        if (isOriginAllowed(origin)) return callback(null, true);
        return callback(new Error('Origin not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST'],
    },
    transports: ['polling', 'websocket'],
    allowUpgrades: true,
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 45000,
  });

  if (enableRedisAdapter) {
    initRedisSocketAdapter(io);
  }
  setSocketServer(io);

  // Enforce authentication on all Socket.io connections
  io.use(authenticateSocket);

  app.set('trust proxy', 1);
  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions));
  app.use(cloudflareSecurityHeaders);

  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
  }
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ limit: '15mb', extended: true }));
  app.use(cookieParser());

  // --- Mail Router Definition (Authenticated) ---
  const mailRouter = express.Router();
  mailRouter.post('/test-connection', verify, authorize(['superadmin', 'admin']), async (req, res) => {
    const { smtpGmail, smtpPassword, receiverMail } = req.body;
    if (!smtpGmail || !smtpPassword || !receiverMail) {
      return res.status(400).json({ error: 'All fields (SMTP Gmail, App Password, and Receiver Email) are required for testing.' });
    }

    let toField = receiverMail.trim();
    let ccField;
    if (receiverMail.includes(',')) {
      const emailParts = receiverMail.split(',').map((e) => e.trim()).filter(Boolean);
      if (emailParts.length > 0) {
        toField = emailParts[0];
        if (emailParts.length > 1) ccField = emailParts.slice(1).join(', ');
      }
    }

    const frontendUrl = process.env.FRONTEND_URL || 'https://crm-eight-sage.vercel.app';
    const isLocalFrontend = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(frontendUrl);
    const vercelEmailUrl = isLocalFrontend
      ? 'https://crm-eight-sage.vercel.app/api/send-email'
      : `${frontendUrl.replace(/\/$/, '')}/api/send-email`;

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
          </div>
        `,
      });

      if (axiosResponse.data && axiosResponse.data.success) {
        return res.json({ success: true });
      }
      throw new Error(axiosResponse.data?.error || 'Failed to send test email via proxy');
    } catch (err) {
      console.error('SMTP Test Connection failed:', err.message);
      return res.status(500).json({ error: err.response?.data?.error || err.message });
    }
  });

  mailRouter.post('/send', verify, authorize(['superadmin', 'admin', 'tl', 'agent']), async (req, res) => {
    try {
      const { to, subject, html, companyName, attachments } = req.body;
      const scopedAdminId = req.user.role === 'admin' ? req.user.id : (req.user.adminId || null);
      const result = await sendMail({
        to,
        subject,
        html,
        companyName,
        attachments,
        adminId: scopedAdminId,
      });
      return res.json(result);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  // --- Notifications Router Definition (Authenticated & Scoped) ---
  const notificationsRouter = express.Router();
  notificationsRouter.post('/broadcast', verify, authorize(['superadmin', 'admin', 'tl']), (req, res) => {
    const { event, data } = req.body;
    if (!event) return res.status(400).json({ error: 'Event name required' });

    io.emit(event, data);
    return res.json({ success: true });
  });

  notificationsRouter.get('/alerts', verify, async (req, res) => {
    try {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Restrict non-admin users to their own alerts
      const targetUserId = ['superadmin', 'admin'].includes(req.user.role) && req.query.userId
        ? req.query.userId
        : req.user.id;

      const [pastAppts, pastCbs] = await Promise.all([
        prisma.contact.findMany({
          where: {
            assignedTo: targetUserId,
            disposition: 'Appointment',
            appointmentDt: { lte: now, gte: yesterday },
            lateNotified: { not: true },
          },
          take: 10,
        }),
        prisma.contact.findMany({
          where: {
            assignedTo: targetUserId,
            OR: [{ disposition: 'CallBack' }, { status: 'Call Back' }],
            callBackDt: { lte: now, gte: yesterday },
            cbReminderSent: { not: true },
          },
          take: 10,
        }),
      ]);

      const alerts = [
        ...pastAppts.map((a) => ({
          type: 'appointment',
          title: '⚠️ Missed Appointment',
          message: `${(a.fields || {}).Name || (a.fields || {}).name || 'Contact'} — was at ${a.appointmentDt ? new Date(a.appointmentDt).toLocaleTimeString() : ''}`,
          path: '/appointments',
        })),
        ...pastCbs.map((c) => ({
          type: 'callback',
          title: '⚠️ Missed Callback',
          message: `${(c.fields || {}).Name || (c.fields || {}).name || 'Contact'} — was at ${c.callBackDt ? new Date(c.callBackDt).toLocaleTimeString() : ''}`,
          path: '/callbacks',
        })),
      ];

      return res.json(alerts);
    } catch {
      return res.status(500).json({ error: 'Alerts fetch failed' });
    }
  });

  // --- Unified Route Registration ---
  const apiRouter = express.Router();
  apiRouter.use(csrfProtect);

  // Mount Auth & User Routers
  apiRouter.use('/auth', createAuthRouter());
  apiRouter.use('/users', createUsersRouter(io));
  apiRouter.use('/agent-logs', require('./routes/agent-logs'));

  // Mount Lead-Service Routers
  apiRouter.use('/contacts', require('./routes/contacts'));
  apiRouter.use('/leads', require('./routes/leads'));
  apiRouter.use('/leads-management', require('./routes/leads-management'));

  // Mount Notification, Reporting, Upload & Mail Routers
  apiRouter.use('/notifications', notificationsRouter);
  apiRouter.use('/reports', require('./routes/reports'));
  apiRouter.use('/upload', require('./routes/upload'));
  apiRouter.use('/mail', mailRouter);

  // --- Health Check Endpoints ---
  const handleHealth = async (req, res) => {
    let dbStatus = 'disconnected';
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbStatus = 'connected';
    } catch {
      dbStatus = 'disconnected';
    }
    res.json({
      status: 'Monolith is up',
      database: dbStatus,
      redis: isRedisConnected() ? 'connected' : 'fallback-memory',
      socketClients: io?.engine?.clientsCount ?? 0,
      timestamp: new Date(),
    });
  };
  app.get('/health', handleHealth);
  apiRouter.get('/health', handleHealth);
  app.get('/', (req, res) => res.json({ status: 'Monolith is active', timestamp: new Date() }));

  app.use('/api', apiRouter);
  app.use('/', apiRouter);

  io.on('connection', (socket) => {
    console.log('📡 Real-time Client connected:', socket.id);
    socket.on('disconnect', () => console.log('📡 Real-time Client disconnected:', socket.id));
  });

  return { app, server, io };
}

// --- Database Sync (Prisma Migrations & Schema) ---
function syncDatabase() {
  if (process.env.NODE_ENV !== 'production' && process.env.RUN_DB_SYNC !== 'true') {
    console.log('ℹ️ Skipping Prisma migrate/push in local dev (set RUN_DB_SYNC=true to run).');
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.warn('⚠️ DATABASE_URL is not set. Skipping Prisma schema synchronization.');
    return;
  }
  try {
    console.log('🔄 Applying Prisma migrations...');
    const isLocal = process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1');
    let dbUrl = process.env.DATABASE_URL;
    if (!isLocal && !dbUrl.includes('sslmode=')) {
      dbUrl = dbUrl.includes('?') ? `${dbUrl}&sslmode=require` : `${dbUrl}?sslmode=require`;
    }

    const execEnv = {
      ...process.env,
      DATABASE_URL: dbUrl,
      NODE_OPTIONS: '--dns-result-order=ipv4first',
    };

    try {
      execSync('npx prisma migrate deploy', {
        cwd: __dirname,
        stdio: 'inherit',
        env: execEnv,
      });
      console.log('✅ Prisma migrations deployed successfully.');
    } catch (migErr) {
      const msg = String(migErr?.message || '');
      if (msg.includes('P1001') || msg.includes('ECONN') || msg.includes('ETIMEDOUT')) {
        console.warn('⚠️ Skipping prisma db push because database host is temporarily unreachable for CLI sync.');
        return;
      }
      console.warn('⚠️ Migration deploy warning, ensuring schema sync via prisma db push:', msg);
      execSync('npx prisma db push', {
        cwd: __dirname,
        stdio: 'inherit',
        env: execEnv,
      });
    }
  } catch (err) {
    console.error('❌ Failed to synchronize Prisma schema:', err.message);
  }
}

// --- Missed/Upcoming Reminders Check Workers ---
let isCheckingAppointments = false;
async function checkAppointments(io) {
  if (isCheckingAppointments) return;
  isCheckingAppointments = true;
  try {
    const now = new Date();
    const upcoming = await prisma.contact.findMany({
      where: {
        disposition: 'Appointment',
        appointmentDt: { gte: now, lte: new Date(now.getTime() + 10 * 60 * 1000) },
        reminderSent: { not: true },
      },
      take: 50,
    });

    for (const appt of upcoming) {
      io.emit('appointment_reminder', {
        appointmentId: appt.id,
        contactName: (appt.fields || {}).Name || (appt.fields || {}).name || 'Unknown',
        appointmentTime: appt.appointmentDt,
        agentId: appt.assignedTo,
        minutesUntil: Math.max(0, Math.round((new Date(appt.appointmentDt) - now) / 60000)),
      });
      await prisma.contact.update({ where: { id: appt.id }, data: { reminderSent: true } });
    }
  } catch {
    // Silent catch during transient network hiccup
  } finally {
    isCheckingAppointments = false;
  }
}

let isCheckingCallbacks = false;
async function checkCallbacks(io) {
  if (isCheckingCallbacks) return;
  isCheckingCallbacks = true;
  try {
    const now = new Date();
    const upcoming = await prisma.contact.findMany({
      where: {
        OR: [{ disposition: 'CallBack' }, { status: 'Call Back' }],
        callBackDt: { gte: now, lte: new Date(now.getTime() + 2.5 * 60 * 1000) },
        cbReminderSent: { not: true },
      },
      take: 50,
    });

    for (const cb of upcoming) {
      io.emit('callback_reminder', {
        callbackId: cb.id,
        contactName: (cb.fields || {}).Name || (cb.fields || {}).name || 'Unknown',
        callbackTime: cb.callBackDt,
        agentId: cb.assignedTo,
        isLeadCallback: cb.status === 'Call Back',
        minutesUntil: Math.max(0, Math.round((new Date(cb.callBackDt) - now) / 60000)),
      });
      await prisma.contact.update({ where: { id: cb.id }, data: { cbReminderSent: true } });
    }
  } catch {
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
    const idleLimitMs = 10 * 60 * 1000;
    const thresholdTime = new Date(now.getTime() - idleLimitMs);

    const inactiveSessions = await prisma.agentWorkLog.findMany({
      where: {
        logoutAt: null,
        activeBreakType: null,
        lastActiveAt: { lt: thresholdTime },
      },
      take: 100,
    });

    for (const session of inactiveSessions) {
      const logoutAt = new Date(session.lastActiveAt.getTime() + idleLimitMs);
      const loginAt = new Date(session.loginAt);
      const totalSessionTime = Math.max(0, Math.floor((logoutAt - loginAt) / 1000));
      const totalBreaks = session.lunchDuration + session.bioDuration + session.teaDuration;
      const totalWorkTime = Math.max(0, totalSessionTime - totalBreaks);

      await prisma.agentWorkLog.update({
        where: { id: session.id },
        data: { logoutAt, totalWorkTime },
      });
      console.log(`⏰ Background Worker Auto-Logout: Closed session ${session.id} for user ${session.userId} due to 10m inactivity.`);
    }
  } catch {
    // Silent catch during transient network hiccup
  } finally {
    isCheckingSessions = false;
  }
}

async function start() {
  const PORT = process.env.PORT || 3000;
  if (!process.env.NOTIFICATION_SERVICE_URL) {
    process.env.NOTIFICATION_SERVICE_URL = `http://localhost:${PORT}/api`;
  }
  if (!process.env.MAIL_SERVICE_URL) {
    process.env.MAIL_SERVICE_URL = `http://localhost:${PORT}/api/mail/send`;
  }

  syncDatabase();

  const { app, server, io } = createApp();

  server.listen(PORT, () => {
    console.log(`🚀 CRM Monolithic Server running on http://localhost:${PORT}`);
    setInterval(() => checkAppointments(io), 30000);
    setInterval(() => checkCallbacks(io), 30000);
    setInterval(checkInactiveSessions, 60000);
    startEmailReplyWorker();
  });

  connect()
    .then(async () => {
      try {
        const superAdminEmail = (process.env.DEFAULT_SUPERADMIN_EMAIL || 'superadmin@spike.crm').trim().toLowerCase();
        const superAdminPassword = process.env.DEFAULT_SUPERADMIN_PASSWORD;
        const superAdminExists = await prisma.user.findFirst({ where: { role: 'superadmin' } });
        if (!superAdminExists && superAdminPassword) {
          const passwordHash = await hashPassword(superAdminPassword);
          await prisma.user.create({
            data: {
              username: superAdminEmail,
              email: superAdminEmail,
              passwordHash,
              name: 'Super Admin',
              role: 'superadmin',
              active: true,
              isDeleted: false,
              passwordChangedAt: new Date(),
            },
          });
          console.log(`🌟 Default Super Admin created successfully (${superAdminEmail})`);
        }
      } catch (err) {
        console.error('⚠️ Default Super Admin seeding check failed:', err.message);
      }
    })
    .catch((err) => {
      console.error('❌ PostgreSQL connection failure via Prisma:', err.message);
    });

  return { app, server, io };
}

if (require.main === module) {
  start();
}

module.exports = { createApp, start };
