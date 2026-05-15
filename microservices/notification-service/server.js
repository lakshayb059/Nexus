const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { connect, getCollection } = require('../shared/mongodb');
const { ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.NOTIFICATION_SERVICE_PORT || 3003;

app.use(cors());
app.use(express.json());

// --- Socket.io Logic ---
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// --- Broadcast Endpoint (Internal) ---
app.post('/api/notifications/broadcast', (req, res) => {
  const { event, data } = req.body;
  if (!event) return res.status(400).json({ error: 'Event name required' });

  io.emit(event, data);
  res.json({ success: true });
});

// --- Missed Alerts Endpoint ---
app.get('/api/notifications/alerts', async (req, res) => {
  // In a real app, we'd verify the user here via shared middleware.
  // For now, we'll implement the logic from the old auth route.
  try {
    const contactsCollection = getCollection('contacts');
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Note: We need a userId here. We'll assume it's passed as a query param 
    // or we'll need to apply the verify middleware.
    const userId = req.query.userId;
    if (!userId) return res.json([]);

    const [pastAppts, pastCbs] = await Promise.all([
      contactsCollection.find({
        assignedTo: new ObjectId(userId),
        disposition: 'Appointment',
        appointmentDt: { $lte: now, $gte: yesterday },
        lateNotified: { $ne: true }
      }).limit(10).toArray(),
      contactsCollection.find({
        assignedTo: new ObjectId(userId),
        disposition: 'CallBack',
        callBackDt: { $lte: now, $gte: yesterday },
        cbReminderSent: { $ne: true }
      }).limit(10).toArray()
    ]);

    const alerts = [
      ...pastAppts.map(a => ({
        type: 'appointment',
        title: '⚠️ Missed Appointment',
        message: `${a.fields?.Name || a.fields?.name || 'Contact'} — was at ${new Date(a.appointmentDt).toLocaleTimeString()}`,
        path: '/appointments'
      })),
      ...pastCbs.map(c => ({
        type: 'callback',
        title: '⚠️ Missed Callback',
        message: `${c.fields?.Name || c.fields?.name || 'Contact'} — was at ${new Date(c.callBackDt).toLocaleTimeString()}`,
        path: '/callbacks'
      }))
    ];

    res.json(alerts);
  } catch (err) { res.status(500).json({ error: 'Alerts fetch failed' }); }
});

// --- Appointment & Callback Background Worker ---
async function checkAppointments() {
  try {
    const contactsCollection = getCollection('contacts');
    const now = new Date();
    const upcoming = await contactsCollection.find({
      disposition: 'Appointment',
      appointmentDt: { $gte: now, $lte: new Date(now.getTime() + 2 * 60 * 1000) },
      reminderSent: { $ne: true }
    }).toArray();

    for (const app of upcoming) {
      io.emit('appointment_reminder', {
        appointmentId: app._id,
        contactName: app.fields?.Name || app.fields?.name || 'Unknown',
        appointmentTime: app.appointmentDt,
        agentId: app.assignedTo?.toString()
      });
      await contactsCollection.updateOne({ _id: app._id }, { $set: { reminderSent: true } });
    }
  } catch (err) { console.error('Worker error:', err); }
}

async function start() {
  await connect();
  server.listen(PORT, () => {
    console.log(`🔔 Notification Service running on http://localhost:${PORT}`);

    // Start background worker
    setInterval(checkAppointments, 60000);
  });
}

start();
