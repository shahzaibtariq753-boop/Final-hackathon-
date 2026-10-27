const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const mongoose = require('mongoose');
const User = require('../models/User');
const CompanySettings = require('../models/CompanySettings');
const { logAudit } = require('../utils/audit');
const { getJwtSecret } = require('../config/environment');

function createToken(user) {
  const jwtSecret = getJwtSecret();
  if (!jwtSecret || jwtSecret.length < 32 || /replace|change.?me|example/i.test(jwtSecret)) {
    throw new Error('Set SECRET_KEY (or JWT_SECRET) to a private random value of at least 32 characters.');
  }
  return jwt.sign({
    id: user._id,
    email: user.email,
    role: user.role,
    employeeId: user.employeeId,
    tokenVersion: user.tokenVersion || 0
  }, jwtSecret, { expiresIn: process.env.JWT_EXPIRES_IN || '12h' });
}

exports.checkFirstRun = async (req, res) => {
  const adminExists = await User.exists({ role: 'Admin' });
  return res.json({ firstRun: !adminExists });
};

exports.firstRunSetup = async (req, res) => {
  const { value, error } = Joi.object({
    companyName: Joi.string().trim().min(2).max(120).required(),
    adminEmail: Joi.string().trim().email().max(254).lowercase().required(),
    adminPassword: Joi.string().min(10).max(128).required()
  }).validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) return res.status(400).json({ error: error.details.map((item) => item.message.replaceAll('"', '')).join('. ') });
  const jwtSecret = getJwtSecret();
  if (!jwtSecret || jwtSecret.length < 32 || /replace|change.?me|example/i.test(jwtSecret)) {
    return res.status(503).json({ error: 'Set a private SECRET_KEY (or JWT_SECRET) of at least 32 characters before initializing the company.' });
  }
  const session = await mongoose.startSession();
  let adminUser;
  try {
    await session.withTransaction(async () => {
      if (await User.exists({ role: 'Admin' }).session(session)) {
        const alreadyInitialized = new Error('System is already initialized.');
        alreadyInitialized.status = 409;
        throw alreadyInitialized;
      }
      await CompanySettings.create([{
        companyName: value.companyName,
        timeZone: process.env.APP_TIMEZONE || 'Asia/Karachi'
      }], { session });
      [adminUser] = await User.create([{
        email: value.adminEmail,
        password: await bcrypt.hash(value.adminPassword, 12),
        role: 'Admin',
        mustChangePassword: false
      }], { session });
    });
  } catch (err) {
    if (err.status === 409) return res.status(409).json({ error: err.message });
    if (err.code === 11000) return res.status(409).json({ error: 'System initialization has already been completed.' });
    throw err;
  } finally {
    await session.endSession();
  }
  await logAudit(value.adminEmail, 'FIRST_RUN_SETUP', 'CompanySettings', adminUser._id, null, { companyName: value.companyName });
  return res.status(201).json({ message: 'First-run setup successfully completed.' });
};

exports.login = async (req, res) => {
  const { value, error } = Joi.object({
    email: Joi.string().trim().email().max(254).lowercase().required(),
    password: Joi.string().required()
  }).validate(req.body, { stripUnknown: true });
  if (error) return res.status(400).json({ error: 'Enter a valid email and password.' });
  const user = await User.findOne({ email: value.email });
  if (!user || !user.isActive || !(await bcrypt.compare(value.password, user.password))) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  const jwtSecret = getJwtSecret();
  if (!jwtSecret || jwtSecret.length < 32 || /replace|change.?me|example/i.test(jwtSecret)) {
    return res.status(503).json({ error: 'Authentication is not configured. Set a private SECRET_KEY (or JWT_SECRET) of at least 32 characters.' });
  }
  return res.json({
    token: createToken(user),
    user: {
      id: user._id,
      email: user.email,
      role: user.role,
      employeeId: user.employeeId,
      mustChangePassword: user.mustChangePassword
    }
  });
};

exports.changePassword = async (req, res) => {
  const { value, error } = Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: Joi.string().min(10).max(128).required()
      .invalid(Joi.ref('currentPassword'))
  }).validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) return res.status(400).json({ error: 'The new password must be at least 10 characters and different from the current password.' });
  const user = await User.findById(req.user.id);
  if (!user || !(await bcrypt.compare(value.currentPassword, user.password))) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  user.password = await bcrypt.hash(value.newPassword, 12);
  user.mustChangePassword = false;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await logAudit(user.email, 'PASSWORD_CHANGED', 'User', user._id, null, { passwordChanged: true });
  return res.json({
    message: 'Password updated successfully. Sign in with your new password.',
    mustSignInAgain: true
  });
};
