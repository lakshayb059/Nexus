const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { getCollection } = require('../mongodb');
const { authorize, verify } = require('../middleware/auth');
const { ObjectId } = require('mongodb');

// Get all users (admin only)
router.get('/', verify, authorize('admin'), async (req, res) => {
  try {
    const usersCollection = getCollection('users');
    // Filter out soft-deleted users
    const users = await usersCollection.find({ isDeleted: { $ne: true } }, { projection: { password: 0 } }).toArray();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get agents under a TL
router.get('/my-agents', verify, authorize('tl'), async (req, res) => {
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

// Create user
router.post('/', verify, authorize('admin'), async (req, res) => {
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

// Update user (admin only)
router.put('/:id', verify, authorize('admin'), async (req, res) => {
  try {
    const { name, password, active, tlId, agentAction, newTlId, reactivateAgents } = req.body;
    const usersCollection = getCollection('users');
    const userId = new ObjectId(req.params.id);
    
    // Get existing user to check role
    const existingUser = await usersCollection.findOne({ _id: userId });
    if (!existingUser) return res.status(404).json({ error: 'User not found' });

    const updateData = { updatedAt: new Date() };
    if (name) updateData.name = name.trim();
    if (active !== undefined) updateData.active = !!active;
    if (tlId !== undefined) updateData.tlId = tlId ? new ObjectId(tlId) : null;
    if (password) updateData.password = await bcrypt.hash(password, 10);

    // 1. Handle TL Inactivation
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
          console.log(`🚫 [Simultaneous Inactivation] Inactivated TL ${existingUser.name} and ${agentsUnderTL.length} agents.`);
        } else if (agentAction === 'reassign' && newTlId) {
          await usersCollection.updateMany(
            { role: 'agent', tlId: userId, isDeleted: { $ne: true } },
            { $set: { tlId: new ObjectId(newTlId), updatedAt: new Date() } }
          );
          console.log(`🔄 [Reassignment] Inactivated TL ${existingUser.name} and reassigned ${agentsUnderTL.length} agents.`);
        } else {
          return res.status(400).json({ 
            error: 'Disposition required', 
            needsAction: true, 
            agentCount: agentsUnderTL.length 
          });
        }
      }
    }

    // 2. Handle TL Reactivation
    if (existingUser.role === 'tl' && !!active === true && existingUser.active === false) {
      if (reactivateAgents === true) {
        const reactivateResult = await usersCollection.updateMany(
          { role: 'agent', tlId: userId, active: false, isDeleted: { $ne: true } },
          { $set: { active: true, updatedAt: new Date() } }
        );
        console.log(`✅ [Simultaneous Activation] Reactivated TL ${existingUser.name} and ${reactivateResult.modifiedCount} agents.`);
      } else {
        console.log(`ℹ️ [Single Activation] Reactivated TL ${existingUser.name} only.`);
      }
    }

    const result = await usersCollection.updateOne({ _id: userId }, { $set: updateData });

    const io = req.app.get('io');
    if (io) io.emit('users_updated', { action: 'update', userId: req.params.id });

    res.json({ success: true });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
