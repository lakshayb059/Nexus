const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { prisma } = require('../shared/db');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.NOTIFICATION_SERVICE_PORT || process.env.PORT || 3003;

app.use(cors());
app.use(express.json());

// Health Check Endpoints for Uptime Monitoring
app.get('/health', (req, res) => res.json({ status: 'Notification service is up', timestamp: new Date() }));
app.get('/', (req, res) => res.json({ status: 'Notification service is active', timestamp: new Date() }));

// --- Socket.io Logic ---
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// --- Broadcast Endpoint (Internal) ---
app.post('/notifications/broadcast', (req, res) => {
  const { event, data } = req.body;
  if (!event) return res.status(400).json({ error: 'Event name required' });

  io.emit(event, data);
  res.json({ success: true });
});

// --- Missed Alerts Endpoint ---
app.get('/notifications/alerts', async (req, res) => {
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

// --- Appointment & Callback Background Worker ---
async function checkAppointments() {
  try {
    const now = new Date();
    const upcoming = await prisma.contact.findMany({
      where: {
        disposition: 'Appointment',
        appointmentDt: { gte: now, lte: new Date(now.getTime() + 2 * 60 * 1000) },
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
  } catch (err) { console.error('Worker error:', err); }
}

async function checkCallbacks() {
  try {
    const now = new Date();
    const upcoming = await prisma.contact.findMany({
      where: {
        disposition: 'CallBack',
        callBackDt: { gte: now, lte: new Date(now.getTime() + 2 * 60 * 1000) },
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
  } catch (err) { console.error('Callback worker error:', err); }
}

async function start() {
  server.listen(PORT, () => {
    console.log(`🔔 Notification Service running on port: ${PORT}`);

    // Start background worker
    setInterval(checkAppointments, 60000);
    setInterval(checkCallbacks, 60000);
  });
}

start();
