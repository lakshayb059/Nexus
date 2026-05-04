const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'crm-super-secret-jwt-key-2024-change-in-production-use-strong-random-string';

// Sign JWT token
function sign(user) {
  const expiresIn = user.role === 'admin' ? '24h' : '12h';
  return jwt.sign(
    { 
      _id: user._id, 
      username: user.username, 
      role: user.role,
      name: user.name
    },
    JWT_SECRET,
    { expiresIn }
  );
}

// Verify JWT token middleware
function verify(req, res, next) {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token.' });
  }
}

// Role-based access control (must be used after verify middleware)
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Access denied. User not authenticated.' });
    }

    // Handle both array and individual arguments
    const allowedRoles = roles.length === 1 && Array.isArray(roles[0]) ? roles[0] : roles;
    
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied. Insufficient permissions.' });
    }

    next();
  };
}

module.exports = {
  sign,
  verify,
  authorize
};
