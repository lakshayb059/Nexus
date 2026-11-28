const express = require('express');
const router = express.Router();
const { prisma } = require('../shared/db');
const { verify, authorize } = require('../shared/authMiddleware');
const { broadcast } = require('../shared/notificationClient');

// Initialize or resume session
router.post('/session-init', verify, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    
    // Find active log for today/session
    let activeLog = await prisma.agentWorkLog.findFirst({
      where: {
        userId: userId,
        logoutAt: null
      }
    });

    if (!activeLog) {
      activeLog = await prisma.agentWorkLog.create({
        data: {
          userId: userId,
          loginAt: new Date(),
          lastActiveAt: new Date()
        }
      });
      console.log(`🔑 Started new work session for user: ${userId}`);
    } else {
      // Update activity timestamp
      activeLog = await prisma.agentWorkLog.update({
        where: { id: activeLog.id },
        data: { lastActiveAt: new Date() }
      });
    }

    res.json(activeLog);
  } catch (err) {
    console.error('❌ [Session Init Error]:', err);
    res.status(500).json({ error: 'Failed to initialize session' });
  }
});

// Inactivity ping (updates last active timestamp)
router.post('/ping', verify, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const activeLog = await prisma.agentWorkLog.findFirst({
      where: {
        userId: userId,
        logoutAt: null
      }
    });

    if (activeLog) {
      await prisma.agentWorkLog.update({
        where: { id: activeLog.id },
        data: { lastActiveAt: new Date() }
      });
      return res.json({ success: true });
    }

    res.status(404).json({ error: 'No active session found' });
  } catch (err) {
    console.error('❌ [Ping Error]:', err);
    res.status(500).json({ error: 'Failed to record activity' });
  }
});

// Start break
router.post('/start-break', verify, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { breakType } = req.body;

    if (!['lunch', 'bio', 'tea'].includes(breakType)) {
      return res.status(400).json({ error: 'Invalid break type' });
    }

    const activeLog = await prisma.agentWorkLog.findFirst({
      where: {
        userId: userId,
        logoutAt: null
      }
    });

    if (!activeLog) {
      return res.status(400).json({ error: 'No active session. Please log in again.' });
    }

    if (activeLog.activeBreakType) {
      return res.status(400).json({ error: 'Already on an active break' });
    }

    const updated = await prisma.agentWorkLog.update({
      where: { id: activeLog.id },
      data: {
        activeBreakType: breakType,
        activeBreakStart: new Date(),
        lastActiveAt: new Date()
      }
    });

    console.log(`☕ Agent ${userId} started ${breakType} break.`);
    broadcast('agent_status_changed', { userId, action: 'start-break', activeBreakType: breakType });
    res.json(updated);
  } catch (err) {
    console.error('❌ [Start Break Error]:', err);
    res.status(500).json({ error: 'Failed to start break' });
  }
});

// End break
router.post('/end-break', verify, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const activeLog = await prisma.agentWorkLog.findFirst({
      where: {
        userId: userId,
        logoutAt: null
      }
    });

    if (!activeLog || !activeLog.activeBreakType || !activeLog.activeBreakStart) {
      return res.status(400).json({ error: 'No active break to end' });
    }

    const breakStart = new Date(activeLog.activeBreakStart);
    const breakEnd = new Date();
    const durationSeconds = Math.max(0, Math.floor((breakEnd - breakStart) / 1000));

    const updateData = {
      activeBreakType: null,
      activeBreakStart: null,
      lastActiveAt: new Date()
    };

    if (activeLog.activeBreakType === 'lunch') {
      updateData.lunchDuration = activeLog.lunchDuration + durationSeconds;
    } else if (activeLog.activeBreakType === 'bio') {
      updateData.bioDuration = activeLog.bioDuration + durationSeconds;
    } else if (activeLog.activeBreakType === 'tea') {
      updateData.teaDuration = activeLog.teaDuration + durationSeconds;
    }

    const updated = await prisma.agentWorkLog.update({
      where: { id: activeLog.id },
      data: updateData
    });

    console.log(`✅ Agent ${userId} ended break. Duration: ${durationSeconds}s`);
    broadcast('agent_status_changed', { userId, action: 'end-break', durationSeconds });
    res.json(updated);
  } catch (err) {
    console.error('❌ [End Break Error]:', err);
    res.status(500).json({ error: 'Failed to end break' });
  }
});

// Logout session
router.post('/logout', verify, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const activeLog = await prisma.agentWorkLog.findFirst({
      where: {
        userId: userId,
        logoutAt: null
      }
    });

    if (activeLog) {
      const logoutAt = new Date();
      const loginAt = new Date(activeLog.loginAt);
      
      let lunchDuration = activeLog.lunchDuration;
      let bioDuration = activeLog.bioDuration;
      let teaDuration = activeLog.teaDuration;

      // Handle closing an active break on logout
      if (activeLog.activeBreakType && activeLog.activeBreakStart) {
        const breakStart = new Date(activeLog.activeBreakStart);
        const durationSeconds = Math.max(0, Math.floor((logoutAt - breakStart) / 1000));
        if (activeLog.activeBreakType === 'lunch') lunchDuration += durationSeconds;
        if (activeLog.activeBreakType === 'bio') bioDuration += durationSeconds;
        if (activeLog.activeBreakType === 'tea') teaDuration += durationSeconds;
      }

      const totalSessionTime = Math.max(0, Math.floor((logoutAt - loginAt) / 1000));
      const totalBreaks = lunchDuration + bioDuration + teaDuration;
      const totalWorkTime = Math.max(0, totalSessionTime - totalBreaks);

      await prisma.agentWorkLog.update({
        where: { id: activeLog.id },
        data: {
          logoutAt,
          lunchDuration,
          bioDuration,
          teaDuration,
          activeBreakType: null,
          activeBreakStart: null,
          totalWorkTime
        }
      });
      console.log(`🔒 Closed work session for user: ${userId}. Work time: ${totalWorkTime}s`);
    }

    broadcast('agent_status_changed', { userId, action: 'logout' });
    res.json({ success: true });
  } catch (err) {
    console.error('❌ [Logout Log Error]:', err);
    res.status(500).json({ error: 'Failed to log logout session' });
  }
});

// Fetch all logs (Admin/Superadmin only)
router.get('/admin-logs', verify, authorize(['admin', 'superadmin']), async (req, res) => {
  try {
    const { agentId, startDate, endDate } = req.query;
    let whereClause = {};

    if (req.user.role === 'admin') {
      whereClause.user = {
        adminId: req.user._id || req.user.id,
        role: 'agent'
      };
    } else if (req.user.role === 'superadmin') {
      whereClause.user = {
        role: 'agent'
      };
    }

    if (agentId) {
      whereClause.userId = agentId;
    }

    if (startDate || endDate) {
      whereClause.loginAt = {};
      if (startDate) {
        whereClause.loginAt.gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        whereClause.loginAt.lte = end;
      }
    }

    const logs = await prisma.agentWorkLog.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            name: true,
            role: true,
            tlId: true,
            adminId: true
          }
        }
      },
      orderBy: {
        loginAt: 'desc'
      },
      take: 1000
    });

    // Fetch TL names
    const tlIds = [...new Set(logs.map(log => log.user.tlId).filter(Boolean))];
    const tlsMap = {};
    if (tlIds.length > 0) {
      const tls = await prisma.user.findMany({
        where: { id: { in: tlIds } },
        select: { id: true, name: true }
      });
      tls.forEach(tl => {
        tlsMap[tl.id] = tl.name;
      });
    }

    const result = logs.map(log => ({
      id: log.id,
      userId: log.userId,
      agentName: log.user.name || log.user.username,
      agentEmail: log.user.username,
      tlName: log.user.tlId ? (tlsMap[log.user.tlId] || 'Unknown') : 'None',
      loginAt: log.loginAt,
      logoutAt: log.logoutAt,
      lastActiveAt: log.lastActiveAt,
      lunchDuration: log.lunchDuration,
      bioDuration: log.bioDuration,
      teaDuration: log.teaDuration,
      activeBreakType: log.activeBreakType,
      activeBreakStart: log.activeBreakStart,
      totalWorkTime: log.totalWorkTime
    }));

    res.json(result);
  } catch (err) {
    console.error('❌ [Fetch Admin Logs Error]:', err);
    res.status(500).json({ error: 'Failed to fetch agent logs' });
  }
});

module.exports = router;
