const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { getCollection } = require('../mongodb');
const { authorize, verify } = require('../middleware/auth');
const { ObjectId } = require('mongodb');

// Get all users (admin only)
router.get('/', verify, authorize('admin'), async (req, res) => {
  try {
    const usersCollection = getCollection('users');
    const users = await usersCollection.find({}, { projection: { password: 0 } }).toArray();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get agents under a TL
router.get('/my-agents', verify, authorize('tl'), async (req, res) => {
  try {
    const usersCollection = getCollection('users');
    const agents = await usersCollection.find({ role: 'agent', tlId: new ObjectId(req.user._id) }, { projection: { password: 0 } }).toArray();
    res.json(agents);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Create user (admin only)
router.post('/', verify, authorize('admin'), async (req, res) => {
  try {
    const { username, password, name, role, tlId } = req.body;
    if (!username || !password || !name || !role) {
      return res.status(400).json({ error: 'All fields required' });
    }
    if (!['agent', 'tl', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
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
      teamLeadId: role === 'agent' ? (tlId ? new ObjectId(tlId) : null) : null,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = await usersCollection.insertOne(userData);
    const user = { ...userData, _id: result.insertedId };
    
    const io = req.app.get('io');
    if (io) io.emit('users_updated', { action: 'create', userId: result.insertedId });

    const { password: _, ...safe } = user;
    res.status(201).json(safe);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user (admin only)
router.put('/:id', verify, authorize('admin'), async (req, res) => {
  try {
    const { name, password, active, tlId, role } = req.body;
    const update = {};
    if (name) update.name = name.trim();
    if (typeof active === 'boolean') update.active = active;
    if (tlId !== undefined) update.tlId = tlId ? new ObjectId(tlId) : null;
    if (role) update.role = role;
    if (password) update.password = await bcrypt.hash(password, 10);
    update.updatedAt = new Date().toISOString();

    const usersCollection = getCollection('users');
    const result = await usersCollection.updateOne(
      { _id: new ObjectId(req.params.id) }, 
      { $set: update }
    );
    if (result.matchedCount === 0) return res.status(404).json({ error: 'User not found' });
    
    const io = req.app.get('io');
    if (io) io.emit('users_updated', { action: 'update', userId: req.params.id });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete user (admin only)
router.delete('/:id', verify, authorize('admin'), async (req, res) => {
  try {
    const usersCollection = getCollection('users');
    const user = await usersCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'admin') return res.status(403).json({ error: 'Cannot delete admin' });
    
    // Cascading delete: if TL is deleted, delete all associated agents
    if (user.role === 'tl') {
      const deleteResult = await usersCollection.deleteMany({ tlId: user._id });
      console.log(`Cascading delete: Removed ${deleteResult.deletedCount} agents under TL ${user.name}`);
    }

    await usersCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    
    const io = req.app.get('io');
    if (io) io.emit('users_updated', { action: 'delete', userId: req.params.id });

    res.json({ 
      success: true, 
      message: user.role === 'tl' ? 'Team Lead and all associated agents deleted.' : 'User deleted.' 
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
