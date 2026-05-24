// Force IPv4 at the process level
process.env.NODE_OPTIONS = '--dns-result-order=ipv4first';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { execSync } = require('child_process');
const path = require('path');

const { connect, prisma } = require('./shared/db');
const { sign, verify, authorize } = require('./shared/authMiddleware');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

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

// --- Database Sync (Prisma Push) ---
function syncDatabase() {
  if (!process.env.DATABASE_URL) {
    console.warn("⚠️ DATABASE_URL is not set. Skipping Prisma schema synchronization.");
    return;
  }
  try {
    console.log('🔄 Synchronizing Prisma schema with database...');
    const dbUrl = process.env.DATABASE_URL.includes('?') 
      ? `${process.env.DATABASE_URL}&sslmode=require` 
      : `${process.env.DATABASE_URL}?sslmode=require`;
    
    const serverPath = __dirname;
    execSync(`npx prisma db push --accept-data-loss`, { 
      cwd: serverPath,
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: dbUrl }
    });
    console.log('✅ Prisma schema synchronized successfully.');
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
      select: { password: 1, active: 1, id: 1, username: 1, name: 1, role: 1, tlId: 1, adminId: 1, receiverMail: 1 }
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
    const { username, password, name, role, tlId } = req.body;
    
    if (role === 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Only Super Admin can create Admin users' });
    }
    if (req.user.role === 'superadmin' && role !== 'admin') {
      return res.status(403).json({ error: 'Super Admin can only create Admin users from the dashboard' });
    }

    const existing = await prisma.user.findUnique({ where: { username: username.trim().toLowerCase() } });
    if (existing) return res.status(409).json({ error: 'Username already exists' });

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
    
    const result = await prisma.user.create({ data: userData });
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
    if (name) updateData.name = name.trim();
    if (active !== undefined) updateData.active = !!active;
    if (tlId !== undefined) updateData.tlId = tlId ? tlId : null;
    if (password) updateData.password = await bcrypt.hash(password, 10);
    if (req.body.receiverMail !== undefined) updateData.receiverMail = req.body.receiverMail.trim() || null;

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
    res.json({ success: true });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// --- Mail Router Definition ---
const mailRouter = express.Router();
mailRouter.post('/send', async (req, res) => {
  try {
    const { to, subject, html, companyName, attachments } = req.body;
    if (!to) return res.status(400).json({ error: 'Receiver email is required.' });

    const mailOptions = {
      from: `"${companyName || 'NEXUS'}" <${BREVO_SENDER || 'noreply@nexus.crm'}>`,
      to,
      subject: subject || 'New Lead Converted',
      html: html || '<p>A new lead has been successfully converted.</p>',
      attachments: attachments || []
    };

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
          disposition: 'CallBack',
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

// API mapping
app.use('/api', apiRouter);
// Gateway fallback / non-API fallback mapping
app.use('/', apiRouter);

// --- Health Check Endpoints ---
app.get('/health', (req, res) => res.json({ status: 'Monolith is up', timestamp: new Date() }));

// --- Socket.io Handlers ---
io.on('connection', (socket) => {
  console.log('📡 Real-time Client connected:', socket.id);
  socket.on('disconnect', () => console.log('📡 Real-time Client disconnected:', socket.id));
});

// --- Missed/Upcoming Reminders Check Workers ---
async function checkAppointments() {
  try {
    const now = new Date();
    const upcoming = await prisma.contact.findMany({
      where: {
        disposition: 'Appointment',
        appointmentDt: { gte: now, lte: new Date(now.getTime() + 2.5 * 60 * 1000) },
        reminderSent: { not: true }
      }
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
  } catch (err) { console.error('Appointment worker error:', err.message); }
}

async function checkCallbacks() {
  try {
    const now = new Date();
    const upcoming = await prisma.contact.findMany({
      where: {
        disposition: 'CallBack',
        callBackDt: { gte: now, lte: new Date(now.getTime() + 2.5 * 60 * 1000) },
        cbReminderSent: { not: true }
      }
    });

    for (const cb of upcoming) {
      io.emit('callback_reminder', {
        callbackId: cb.id,
        contactName: (cb.fields || {}).Name || (cb.fields || {}).name || 'Unknown',
        callbackTime: cb.callBackDt,
        agentId: cb.assignedTo,
        minutesUntil: Math.max(0, Math.round((new Date(cb.callBackDt) - now) / 60000))
      });
      await prisma.contact.update({ where: { id: cb.id }, data: { cbReminderSent: true } });
    }
  } catch (err) { console.error('Callback worker error:', err.message); }
}

// --- Start Monolithic Server ---
async function start() {
  // Sync Prisma Schema
  syncDatabase();

  server.listen(PORT, () => {
    console.log(`🚀 CRM Monolithic Server running on http://localhost:${PORT}`);
    
    // Start background check interval workers
    setInterval(checkAppointments, 10000);
    setInterval(checkCallbacks, 10000);
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
