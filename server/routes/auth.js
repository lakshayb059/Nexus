const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { getCollection } = require('../mongodb');
const { sign } = require('../middleware/auth');
const { ObjectId } = require('mongodb');

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const usersCollection = getCollection('users');
    const user = await usersCollection.findOne({ username: username.trim().toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (!user.active) return res.status(403).json({ error: 'Account is inactive' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = sign(user);

    // Fetch past-due appointments and callbacks for this agent
    const contactsCollection = getCollection('contacts');
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [pastAppts, pastCbs] = await Promise.all([
      contactsCollection.find({
        assignedTo: user._id,
        disposition: 'Appointment',
        appointmentDt: { $lte: now, $gte: yesterday },
        lateNotified: { $ne: true }
      }).toArray(),
      contactsCollection.find({
        assignedTo: user._id,
        disposition: 'CallBack',
        callBackDt: { $lte: now, $gte: yesterday },
        cbReminderSent: { $ne: true }
      }).toArray()
    ]);

    const pastDueAlerts = [
      ...pastAppts.map(a => ({
        type: 'appointment',
        title: '⚠️ Missed Appointment',
        message: `${a.fields?.Name || 'Contact'} — was at ${new Date(a.appointmentDt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        path: '/appointments'
      })),
      ...pastCbs.map(c => ({
        type: 'callback',
        title: '⚠️ Missed Callback',
        message: `${c.fields?.Name || 'Contact'} — was at ${new Date(c.callBackDt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        path: '/callbacks'
      }))
    ];

    // Set HTTP cookie valid for 2 hours
    res.cookie('crm_session', token, {
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: 2 * 60 * 60 * 1000, // 2 hours in ms
      secure: process.env.NODE_ENV === 'production'
    });

    res.json({
      token,
      user: { _id: user._id, username: user.username, name: user.name, role: user.role, tlId: user.tlId },
      pastDueAlerts
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
