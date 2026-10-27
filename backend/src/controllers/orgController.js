const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Joi = require('joi');
const mongoose = require('mongoose');
const CompanySettings = require('../models/CompanySettings');
const User = require('../models/User');
const { logAudit } = require('../utils/audit');
const { isValidDateString } = require('../utils/companyTime');

const settingsSchema = Joi.object({
  companyName: Joi.string().trim().min(2).max(120).required(),
  timeZone: Joi.string().min(1).max(80).required(),
  officeStart: Joi.string().pattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/).required(),
  graceMinutes: Joi.number().integer().min(0).max(180).required(),
  halfDayUnderHours: Joi.number().min(0).max(24).required(),
  weekend: Joi.array().items(Joi.string().valid('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')).unique().required(),
  officeLocation: Joi.object({
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required(),
    radiusMeters: Joi.number().positive().max(50000).required()
  }).required(),
  quotas: Joi.object({
    annual: Joi.number().min(0).required(),
    sick: Joi.number().min(0).required(),
    casual: Joi.number().min(0).required()
  }).required(),
  departments: Joi.array().items(Joi.string().trim().min(1).max(80)).unique().min(1).required(),
  designations: Joi.array().items(Joi.string().trim().min(1).max(80)).unique().min(1).required(),
  publicHolidays: Joi.array().items(Joi.object({
    date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).custom((value, helpers) => (
      isValidDateString(value) ? value : helpers.error('date.format')
    )).required(),
    name: Joi.string().trim().min(1).max(120).required()
  }).required()).required()
});

exports.getSettings = async (req, res) => {
  const settings = await CompanySettings.findOne().lean();
  if (!settings) return res.status(404).json({ error: 'Company setup has not been completed.' });
  if (req.user.role === 'Employee') {
    return res.json({ weekend: settings.weekend, quotas: settings.quotas, companyName: settings.companyName, timeZone: settings.timeZone });
  }
  return res.json(settings);
};

exports.updateSettings = async (req, res) => {
  const { value, error } = settingsSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) return res.status(400).json({ error: error.details.map((item) => item.message.replaceAll('"', '')).join('. ') });
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value.timeZone });
  } catch {
    return res.status(400).json({ error: 'Enter a valid IANA time zone, such as Asia/Karachi or America/New_York.' });
  }
  const before = await CompanySettings.findOne().lean();
  const settings = await CompanySettings.findOneAndUpdate({}, value, { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true });
  await logAudit(req.user.email, 'COMPANY_SETTINGS_UPDATED', 'CompanySettings', settings._id, before, settings.toObject());
  return res.json(settings);
};

exports.listUsers = async (req, res) => {
  const users = await User.find({ role: { $in: ['HR', 'Employee'] } })
    .select('-password')
    .populate('employeeId', 'firstName lastName employeeCode')
    .sort({ role: 1, email: 1 })
    .lean();
  return res.json(users);
};

exports.createHrUser = async (req, res) => {
  const { value, error } = Joi.object({
    email: Joi.string().trim().email().max(254).lowercase().required(),
    password: Joi.string().min(10).max(128).optional()
  }).validate(req.body, { stripUnknown: true });
  if (error) return res.status(400).json({ error: error.details.map((item) => item.message.replaceAll('"', '')).join('. ') });
  if (await User.exists({ email: value.email })) return res.status(409).json({ error: 'An account with this email already exists.' });
  const temporaryPassword = value.password || `Hcm-${crypto.randomBytes(9).toString('base64url')}!`;
  const user = await User.create({
    email: value.email,
    password: await bcrypt.hash(temporaryPassword, 12),
    role: 'HR',
    mustChangePassword: true
  });
  await logAudit(req.user.email, 'HR_USER_CREATED', 'User', user._id, null, { email: user.email, role: user.role });
  return res.status(201).json({ user: { id: user._id, email: user.email, role: user.role, mustChangePassword: true }, temporaryPassword });
};

exports.updateUser = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid user ID.' });
  const user = await User.findById(req.params.id);
  if (!user || user.role === 'Admin') return res.status(404).json({ error: 'Managed account not found.' });
  const { value, error } = Joi.object({
    isActive: Joi.boolean().optional(),
    resetPassword: Joi.boolean().valid(true).optional()
  }).min(1).validate(req.body, { stripUnknown: true });
  if (error) return res.status(400).json({ error: 'Set isActive or request a password reset.' });
  const before = { isActive: user.isActive, mustChangePassword: user.mustChangePassword };
  let temporaryPassword;
  if (Object.hasOwn(value, 'isActive')) user.isActive = value.isActive;
  if (value.resetPassword) {
    temporaryPassword = `Hcm-${crypto.randomBytes(9).toString('base64url')}!`;
    user.password = await bcrypt.hash(temporaryPassword, 12);
    user.mustChangePassword = true;
  }
  await user.save();
  await logAudit(req.user.email, 'USER_ACCOUNT_UPDATED', 'User', user._id, before, { isActive: user.isActive, mustChangePassword: user.mustChangePassword });
  return res.json({
    user: { id: user._id, email: user.email, role: user.role, isActive: user.isActive, mustChangePassword: user.mustChangePassword },
    ...(temporaryPassword ? { temporaryPassword } : {})
  });
};