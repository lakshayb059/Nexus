require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { connect, prisma } = require('../shared/db');
const { sign, verify, authorize } = require('../shared/authMiddleware');

const app = express();
const PORT = process.env.AUTH_SERVICE_PORT || process.env.PORT || 3001;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Health Check Endpoints for Uptime Monitoring
app.get('/health', (req, res) => res.json({ status: 'Auth service is up', timestamp: new Date() }));
app.get('/', (req, res) => res.json({ status: 'Auth service is active', timestamp: new Date() }));

// --- Auth Routes ---
app.post('/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

        const user = await prisma.user.findUnique({
            where: { username: username.trim().toLowerCase() },
            select: { password: 1, active: 1, id: 1, username: 1, name: 1, role: 1, tlId: 1, adminId: 1 }
        });

        if (!user) return res.json({ error: 'Invalid credentials' });
        if (!user.active) return res.json({ error: 'Your ID is inactive. Please contact admin.' });

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.json({ error: 'Invalid credentials' });

        const tokenPayload = {
          _id: user.id, // Auth middleware might expect _id
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role,
          tlId: user.tlId,
          adminId: user.adminId
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
            user: { _id: user.id, username: user.username, name: user.name, role: user.role, tlId: user.tlId }
        });
    } catch (err) {
        console.error(`❌ [AUTH LOGIN FATAL ERROR]:`, err);
        res.status(500).json({ error: `Server error: ${err.message}` });
    }
});

// --- Users Routes ---
app.get('/users', verify, authorize(['superadmin', 'admin']), async (req, res) => {
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
        active: true,
        isDeleted: true,
        createdAt: true,
        updatedAt: true,
      }
    });
    // Map id to _id for frontend compatibility
    res.json(users.map(u => ({ ...u, _id: u.id })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/users/my-agents', verify, authorize('tl'), async (req, res) => {
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

app.post('/users', verify, authorize(['superadmin', 'admin']), async (req, res) => {
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

app.put('/users/:id', verify, authorize(['superadmin', 'admin']), async (req, res) => {
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

async function start() {
  app.listen(PORT, () => {
    console.log(`🔐 Auth Service running on port: ${PORT}`);
  });
  
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
        console.log('🌟 Default Super Admin created (SuperAdmin@spike.crm)');
      }
    } catch(err) {
      console.error('Super Admin seeding failed:', err);
    }
  }).catch(err => {
    console.error("❌ Deferred Database Connection Failure in Auth Service:", err.message);
  });
}

start();
