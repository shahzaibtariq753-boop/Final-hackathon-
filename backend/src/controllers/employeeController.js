const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Joi = require('joi');
const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const User = require('../models/User');
const CompanySettings = require('../models/CompanySettings');
const { logAudit } = require('../utils/audit');
const { notifyUsers } = require('../utils/notifications');

const employeeSchema = Joi.object({
  employeeCode: Joi.string().trim().max(32).required(),
  firstName: Joi.string().trim().max(80).required(),
  lastName: Joi.string().trim().max(80).required(),
  email: Joi.string().trim().email().max(254).lowercase().required(),
  phone: Joi.string().trim().max(40).allow('').default(''),
  address: Joi.string().trim().max(300).allow('').default(''),
  department: Joi.string().trim().required(),
  designation: Joi.string().trim().required(),
  joiningDate: Joi.date().iso().required(),
  basicSalary: Joi.number().positive().required()
});

function validationError(error) {
  return error.details?.map((detail) => detail.message.replaceAll('"', '')).join('. ');
}

function generateTemporaryPassword() {
  return `Hcm-${crypto.randomBytes(9).toString('base64url')}!`;
}

exports.list = async (req, res) => {
  const filters = {};
  if (req.user.role === 'Employee') {
    if (!req.user.employeeId) return res.status(403).json({ error: 'This account is not linked to an employee profile.' });
    filters._id = req.user.employeeId;
  } else {
    if (req.query.department) filters.department = req.query.department;
    if (req.query.status) filters.status = req.query.status;
    if (req.query.search) {
      const search = String(req.query.search).trim().slice(0, 80);
      if (search) {
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filters.$or = [
          { firstName: new RegExp(escaped, 'i') },
          { lastName: new RegExp(escaped, 'i') },
          { email: new RegExp(escaped, 'i') },
          { employeeCode: new RegExp(escaped, 'i') }
        ];
      }
    }
  }
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const [employees, total] = await Promise.all([
    Employee.find(filters).sort({ firstName: 1, lastName: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    Employee.countDocuments(filters)
  ]);
  return res.json({ employees, page, limit, total, pages: Math.ceil(total / limit) });
};

exports.create = async (req, res) => {
  const { value, error } = employeeSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) return res.status(400).json({ error: validationError(error) });
  const settings = await CompanySettings.findOne().lean();
  if (!settings) return res.status(409).json({ error: 'Complete company setup before adding employees.' });
  if (!settings.departments.includes(value.department)) return res.status(400).json({ error: 'Choose a department configured in company settings.' });
  if (!settings.designations.includes(value.designation)) return res.status(400).json({ error: 'Choose a designation configured in company settings.' });
  value.employeeCode = value.employeeCode.trim().toUpperCase();
  value.email = value.email.trim().toLowerCase();
  const existing = await Promise.all([
    Employee.exists({ employeeCode: value.employeeCode }),
    Employee.exists({ email: value.email }),
    User.exists({ email: value.email })
  ]);
  if (existing.some(Boolean)) return res.status(409).json({ error: 'An employee code or email address is already registered.' });

  const temporaryPassword = generateTemporaryPassword();
  const session = await mongoose.startSession();
  let employee;
  try {
    await session.withTransaction(async () => {
      [employee] = await Employee.create([value], { session });
      await User.create([{
        email: value.email,
        password: await bcrypt.hash(temporaryPassword, 12),
        role: 'Employee',
        employeeId: employee._id,
        mustChangePassword: true
      }], { session });
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'An employee code or email address is already registered.' });
    throw err;
  } finally {
    await session.endSession();
  }
  await logAudit(req.user.email, 'EMPLOYEE_CREATED', 'Employee', employee._id, null, { email: value.email, employeeCode: value.employeeCode });
  await notifyUsers([req.user.id], `Employee ${employee.firstName} ${employee.lastName} was added.`, 'account', employee._id.toString());
  return res.status(201).json({ employee, temporaryPassword });
};

exports.update = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid employee ID.' });
  const employee = await Employee.findById(req.params.id);
  if (!employee) return res.status(404).json({ error: 'Employee not found.' });
  if (req.user.role === 'Employee' && employee._id.toString() !== req.user.employeeId) {
    return res.status(403).json({ error: 'You can only update your own contact details.' });
  }
  const allowed = req.user.role === 'Employee'
    ? ['phone', 'address']
    : ['firstName', 'lastName', 'phone', 'address', 'department', 'designation', 'joiningDate', 'leavingDate', 'basicSalary', 'status'];
  const updates = {};
  for (const field of allowed) {
    if (Object.hasOwn(req.body, field)) updates[field] = req.body[field];
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Provide at least one field that can be updated.' });
  const schema = Joi.object({
    firstName: Joi.string().trim().max(80),
    lastName: Joi.string().trim().max(80),
    phone: Joi.string().trim().max(40).allow(''),
    address: Joi.string().trim().max(300).allow(''),
    department: Joi.string().trim(),
    designation: Joi.string().trim(),
    joiningDate: Joi.date().iso(),
    leavingDate: Joi.date().iso().allow(null),
    basicSalary: Joi.number().positive(),
    status: Joi.string().valid('active', 'probation', 'exited')
  }).min(1);
  const { value, error } = schema.validate(updates, { abortEarly: false, stripUnknown: true });
  if (error) return res.status(400).json({ error: validationError(error) });
  const settings = await CompanySettings.findOne().lean();
  if (value.department && !settings?.departments.includes(value.department)) {
    return res.status(400).json({ error: 'Choose a department configured in company settings.' });
  }
  if (value.designation && !settings?.designations.includes(value.designation)) {
    return res.status(400).json({ error: 'Choose a designation configured in company settings.' });
  }
  const effectiveJoiningDate = value.joiningDate || employee.joiningDate;
  const effectiveLeavingDate = Object.hasOwn(value, 'leavingDate') ? value.leavingDate : employee.leavingDate;
  if (effectiveLeavingDate && effectiveLeavingDate < effectiveJoiningDate) {
    return res.status(400).json({ error: 'Leaving date cannot be before the joining date.' });
  }
  if (value.status === 'exited' && !effectiveLeavingDate) {
    return res.status(400).json({ error: 'Set a leaving date before marking this employee exited.' });
  }
  if (value.status && value.status !== 'exited' && effectiveLeavingDate) {
    return res.status(400).json({ error: 'Clear the leaving date before reactivating this employee.' });
  }
  const before = employee.toObject();
  Object.assign(employee, value);
  await employee.save();
  await logAudit(req.user.email, 'EMPLOYEE_UPDATED', 'Employee', employee._id, before, employee.toObject());
  return res.json(employee);
};

exports.exportCsv = async (req, res) => {
  const employees = await Employee.find({}).sort({ employeeCode: 1 }).lean();
  const fields = ['employeeCode', 'firstName', 'lastName', 'email', 'phone', 'address', 'department', 'designation', 'joiningDate', 'basicSalary'];
  const escape = (value) => {
    const text = String(value ?? '');
    const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const csv = [fields.join(','), ...employees.map((employee) => fields.map((field) => escape(
    field === 'joiningDate' && employee[field] ? new Date(employee[field]).toISOString().slice(0, 10) : employee[field]
  )).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="hcm-employees.csv"');
  return res.send(`\uFEFF${csv}`);
};

exports.importDryRun = async (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length > 500) return res.status(400).json({ error: 'Provide an array of at most 500 employee rows.' });
  const settings = await CompanySettings.findOne().lean();
  const seenCodes = new Set();
  const seenEmails = new Set();
  const codes = rows.map((row) => String(row?.employeeCode || '').trim().toUpperCase()).filter(Boolean);
  const emails = rows.map((row) => String(row?.email || '').trim().toLowerCase()).filter(Boolean);
  const [existingEmployees, existingUsers] = await Promise.all([
    Employee.find({ $or: [{ employeeCode: { $in: codes } }, { email: { $in: emails } }] }).select('employeeCode email').lean(),
    User.find({ email: { $in: emails } }).select('email').lean()
  ]);
  const existingCodes = new Set(existingEmployees.map((employee) => employee.employeeCode));
  const existingEmails = new Set([...existingEmployees.map((employee) => employee.email), ...existingUsers.map((user) => user.email)]);
  const results = await Promise.all(rows.map(async (row, index) => {
    const { value, error } = employeeSchema.validate(row, { abortEarly: false });
    const issues = error ? error.details.map((detail) => detail.message.replaceAll('"', '')) : [];
    const code = String(row?.employeeCode || '').trim().toUpperCase();
    const email = String(row?.email || '').trim().toLowerCase();
    if (code && (seenCodes.has(code) || existingCodes.has(code))) issues.push('Employee code is already used.');
    if (email && (seenEmails.has(email) || existingEmails.has(email))) issues.push('Email is already used.');
    if (code) seenCodes.add(code);
    if (email) seenEmails.add(email);
    if (settings && row.department && !settings.departments.includes(row.department)) issues.push('Department is not configured.');
    if (settings && row.designation && !settings.designations.includes(row.designation)) issues.push('Designation is not configured.');
    return { row: index + 1, valid: issues.length === 0, issues, ...(issues.length === 0 ? { value } : {}) };
  }));
  return res.json({
    total: rows.length,
    valid: results.filter((item) => item.valid).length,
    invalid: results.filter((item) => !item.valid).length,
    rows: results
  });
};

exports.importCommit = async (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || !rows.length || rows.length > 500) {
    return res.status(400).json({ error: 'Provide between 1 and 500 employee rows.' });
  }
  const settings = await CompanySettings.findOne().lean();
  if (!settings) return res.status(409).json({ error: 'Complete company setup before importing employees.' });
  const codes = new Set();
  const emails = new Set();
  const normalized = [];
  for (const row of rows) {
    const { value, error } = employeeSchema.validate(row, { abortEarly: false, stripUnknown: true });
    if (error) return res.status(400).json({ error: validationError(error) });
    value.employeeCode = value.employeeCode.trim().toUpperCase();
    value.email = value.email.trim().toLowerCase();
    if (!settings.departments.includes(value.department) || !settings.designations.includes(value.designation)) {
      return res.status(400).json({ error: `Employee ${value.employeeCode} has an unknown department or designation.` });
    }
    if (codes.has(value.employeeCode) || emails.has(value.email)) return res.status(409).json({ error: 'The import contains duplicate employee codes or email addresses.' });
    codes.add(value.employeeCode);
    emails.add(value.email);
    normalized.push(value);
  }
  const existingEmployees = await Employee.find({
    $or: [{ employeeCode: { $in: [...codes] } }, { email: { $in: [...emails] } }]
  }).select('employeeCode email').lean();
  const existingUsers = await User.find({ email: { $in: [...emails] } }).select('email').lean();
  if (existingEmployees.length || existingUsers.length) {
    return res.status(409).json({ error: 'One or more employee codes or email addresses are already registered.' });
  }

  const accounts = normalized.map((employee) => ({ email: employee.email, temporaryPassword: generateTemporaryPassword() }));
  const session = await mongoose.startSession();
  let created = [];
  try {
    await session.withTransaction(async () => {
      created = await Employee.insertMany(normalized, { session, ordered: true });
      await User.insertMany(await Promise.all(created.map(async (employee, index) => ({
        email: employee.email,
        password: await bcrypt.hash(accounts[index].temporaryPassword, 12),
        role: 'Employee',
        employeeId: employee._id,
        mustChangePassword: true
      }))), { session, ordered: true });
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'An imported employee code or email is already registered.' });
    throw err;
  } finally {
    await session.endSession();
  }
  await logAudit(req.user.email, 'EMPLOYEES_IMPORTED', 'Employee', null, null, { count: created.length });
  return res.status(201).json({ created: created.length, accounts });
};