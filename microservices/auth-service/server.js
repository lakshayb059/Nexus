const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');
const { connect, getCollection } = require('../shared/mongodb');
const { sign, verify, authorize } = require('../shared/authMiddleware');
require('dotenv').config();

const app = express();
const PORT = process.env.AUTH_SERVICE_PORT || 3001;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// --- Auth Routes ---
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

        const usersCollection = getCollection('users');
        const user = await usersCollection.findOne(
            { username: username.trim().toLowerCase() },
            { projection: { password: 1, active: 1, _id: 1, username: 1, name: 1, role: 1, tlId: 1 } }
        );

        if (!user) return res.status(401).json({ error: 'Invalid credentials' });
        if (!user.active) return res.json({ error: 'Your ID is inactive. Please contact admin.' });

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

        const token = sign(user);

        res.cookie('crm_session', token, {
            httpOnly: true,
            sameSite: 'Lax',
            maxAge: 2 * 60 * 60 * 1000,
            secure: process.env.NODE_ENV === 'production'
        });

        res.json({
            token,
            user: { _id: user._id, username: user.username, name: user.name, role: user.role, tlId: user.tlId }
        });
    } catch (err) {
        console.error(`❌ [AUTH LOGIN FATAL ERROR]:`, err);
        res.status(500).json({ error: `Server error: ${err.message}` });
    }
});

// --- Users Routes ---
app.get('/api/users', verify, authorize('admin'), async (req, res) => {
  try {
    const usersCollection = getCollection('users');
    const users = await usersCollection.find({ isDeleted: { $ne: true } }, { projection: { password: 0 } }).toArray();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/users/my-agents', verify, authorize('tl'), async (req, res) => {
  try {
    const usersCollection = getCollection('users');
    const agents = await usersCollection.find({ 
      role: 'agent', 
      tlId: new ObjectId(req.user._id),
      isDeleted: { $ne: true }
    }, { projection: { password: 0 } }).toArray();
    res.json(agents);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/users', verify, authorize('admin'), async (req, res) => {
  try {
    const { username, password, name, role, tlId } = req.body;
    const usersCollection = getCollection('users');
    const existing = await usersCollection.findOne({ username: username.trim().toLowerCase() });
    if (existing) return res.status(409).json({ error: 'Username already exists' });

    const hashed = await bcrypt.hash(password, 10);
    const userData = {
      username: username.trim().toLowerCase(),
      password: hashed,
      name: name.trim(),
      role,
      tlId: role === 'agent' ? (tlId ? new ObjectId(tlId) : null) : null,
      active: true,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = await usersCollection.insertOne(userData);
    res.status(201).json({ ...userData, _id: result.insertedId, password: undefined });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/users/:id', verify, authorize('admin'), async (req, res) => {
  try {
    const { name, password, active, tlId, agentAction, newTlId, reactivateAgents } = req.body;
    const usersCollection = getCollection('users');
    const userId = new ObjectId(req.params.id);
    
    const existingUser = await usersCollection.findOne({ _id: userId });
    if (!existingUser) return res.status(404).json({ error: 'User not found' });

    const updateData = { updatedAt: new Date() };
    if (name) updateData.name = name.trim();
    if (active !== undefined) updateData.active = !!active;
    if (tlId !== undefined) updateData.tlId = tlId ? new ObjectId(tlId) : null;
    if (password) updateData.password = await bcrypt.hash(password, 10);

    if (existingUser.role === 'tl' && !!active === false && existingUser.active === true) {
      const agentsUnderTL = await usersCollection.find({ 
        role: 'agent', 
        tlId: userId,
        isDeleted: { $ne: true }
      }).toArray();

      if (agentsUnderTL.length > 0) {
        if (agentAction === 'inactivate') {
          await usersCollection.updateMany(
            { role: 'agent', tlId: userId, isDeleted: { $ne: true } },
            { $set: { active: false, updatedAt: new Date() } }
          );
        } else if (agentAction === 'reassign' && newTlId) {
          await usersCollection.updateMany(
            { role: 'agent', tlId: userId, isDeleted: { $ne: true } },
            { $set: { tlId: new ObjectId(newTlId), updatedAt: new Date() } }
          );
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
        await usersCollection.updateMany(
          { role: 'agent', tlId: userId, active: false, isDeleted: { $ne: true } },
          { $set: { active: true, updatedAt: new Date() } }
        );
      }
    }

    await usersCollection.updateOne({ _id: userId }, { $set: updateData });
    res.json({ success: true });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

async function start() {
  await connect();
  app.listen(PORT, () => {
    console.log(`🔐 Auth Service running on http://localhost:${PORT}`);
  });
}

start();
