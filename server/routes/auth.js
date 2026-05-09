const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { getCollection } = require('../mongodb');
const { sign, verify } = require('../middleware/auth');
const { ObjectId } = require('mongodb');

router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

        const usersCollection = getCollection('users');
        // Optimization: project only required fields
        const user = await usersCollection.findOne(
            { username: username.trim().toLowerCase() },
            { projection: { password: 1, active: 1, _id: 1, username: 1, name: 1, role: 1, tlId: 1 } }
        );

        if (!user) return res.status(401).json({ error: 'Invalid credentials' });
        if (!user.active) return res.status(403).json({ error: 'Account is inactive' });

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

        const token = sign(user);

        // Set HTTP cookie valid for 2 hours
        res.cookie('crm_session', token, {
            httpOnly: true,
            sameSite: 'Lax',
            maxAge: 2 * 60 * 60 * 1000, // 2 hours in ms
            secure: process.env.NODE_ENV === 'production'
        });

        res.json({
            token,
            user: { _id: user._id, username: user.username, name: user.name, role: user.role, tlId: user.tlId }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Separate route for notifications to keep login fast
router.get('/notifications', verify, async (req, res) => {
    try {
        const contactsCollection = getCollection('contacts');
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const [pastAppts, pastCbs] = await Promise.all([
            contactsCollection.find({
                assignedTo: new ObjectId(req.user._id),
                disposition: 'Appointment',
                appointmentDt: { $lte: now, $gte: yesterday },
                lateNotified: { $ne: true }
            })
                .project({ _id: 1, 'fields.Name': 1, 'fields.name': 1, appointmentDt: 1 })
                .limit(10)
                .toArray(),
            contactsCollection.find({
                assignedTo: new ObjectId(req.user._id),
                disposition: 'CallBack',
                callBackDt: { $lte: now, $gte: yesterday },
                cbReminderSent: { $ne: true }
            })
                .project({ _id: 1, 'fields.Name': 1, 'fields.name': 1, callBackDt: 1 })
                .limit(10)
                .toArray()
        ]);

        const alerts = [
            ...pastAppts.map(a => ({
                type: 'appointment',
                title: '⚠️ Missed Appointment',
                message: `${a.fields?.Name || a.fields?.name || 'Contact'} — was at ${new Date(a.appointmentDt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
                path: '/appointments'
            })),
            ...pastCbs.map(c => ({
                type: 'callback',
                title: '⚠️ Missed Callback',
                message: `${c.fields?.Name || c.fields?.name || 'Contact'} — was at ${new Date(c.callBackDt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
                path: '/callbacks'
            }))
        ];

        res.json(alerts);
    } catch (err) {
        console.error('Notifications fetch error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
