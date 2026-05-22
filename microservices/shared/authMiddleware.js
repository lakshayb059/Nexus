const jwt = require('jsonwebtoken');
const { prisma } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'crm-super-secret-jwt-key-2024-change-in-production-use-strong-random-string';

async function verify(req, res, next) {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;

    const user = await prisma.user.findUnique({ where: { id: decoded._id || decoded.id } });

    if (!user || (user.role === 'agent' && !user.active)) {
      return res.status(403).json({ error: 'Account inactive or suspended. Please contact admin.' });
    }

    req.user.name = user.name || user.username;

    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token.' });
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Access denied. User not authenticated.' });
    }
    const allowedRoles = roles.length === 1 && Array.isArray(roles[0]) ? roles[0] : roles;
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied. Insufficient permissions.' });
    }
    next();
  };
}

function sign(user) {
  return jwt.sign(
    { _id: user._id || user.id, id: user.id || user._id, username: user.username, name: user.name, role: user.role, tlId: user.tlId, adminId: user.adminId },
    JWT_SECRET,
    { expiresIn: '2h' }
  );
}

module.exports = {
  sign,
  verify,
  authorize,
  JWT_SECRET
};
