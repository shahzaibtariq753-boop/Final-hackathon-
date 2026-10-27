const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getJwtSecret } = require('../config/environment');

const authGuard = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized: Token missing' });

  try {
    const jwtSecret = getJwtSecret();
    if (!jwtSecret || jwtSecret.length < 32 || /replace|change.?me|example/i.test(jwtSecret)) {
      return res.status(503).json({ error: 'Authentication is not configured. Set a private SECRET_KEY (or JWT_SECRET) of at least 32 characters.' });
    }
    const decoded = jwt.verify(token, jwtSecret);
    const user = await User.findById(decoded.id).select('email role employeeId isActive mustChangePassword tokenVersion').lean();
    if (!user || !user.isActive || decoded.tokenVersion !== (user.tokenVersion || 0)) {
      return res.status(401).json({ error: 'This session is no longer valid. Please sign in again.' });
    }
    if (user.mustChangePassword && req.path !== '/auth/change-password') {
      return res.status(403).json({ error: 'Change your temporary password before using the application.', mustChangePassword: true });
    }
    req.user = {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      employeeId: user.employeeId?.toString() || null,
      mustChangePassword: user.mustChangePassword
    };
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError' || err.name === 'NotBeforeError') {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
    return next(err);
  }
};

const roleGuard = (allowedRoles) => (req, res, next) => {
  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
  }
  next();
};

module.exports = { authGuard, roleGuard };