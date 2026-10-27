const OpenAI = require('openai');
const Joi = require('joi');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const LeaveRequest = require('../models/LeaveRequest');
const PayrollRun = require('../models/PayrollRun');
const Payslip = require('../models/Payslip');
const AILog = require('../models/AILog');
const User = require('../models/User');
const mongoose = require('mongoose');
const { logAudit } = require('../utils/audit');

function getClient() {
  if (!process.env.AI_API_KEY) return null;
  return new OpenAI({
    apiKey: process.env.AI_API_KEY,
    ...(process.env.AI_BASE_URL ? { baseURL: process.env.AI_BASE_URL } : {}),
    timeout: 15000,
    maxRetries: 0
  });
}

const tools = [
  { type: 'function', function: { name: 'get_headcount', description: 'Count active and probationary employees, optionally in one department.', parameters: { type: 'object', properties: { department: { type: 'string' } }, additionalProperties: false } } },
  { type: 'function', function: { name: 'get_attendance_summary', description: 'Summarize attendance in the current calendar month for permitted employees.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'get_late_comers', description: 'List employees with the most late arrivals during the current month. Employees can only see their own attendance.', parameters: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 5 } }, additionalProperties: false } } },
  { type: 'function', function: { name: 'get_leave_summary', description: 'Summarize approved and pending leave requests.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'get_my_leave_balance', description: 'Return the current employee’s own approved leave use and configured balance.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'get_payroll_summary', description: 'Summarize company payroll for HR/Admin, or the current employee’s own payslips.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'search_employees', description: 'Search employees by name, employee code, or email without exposing salary or sensitive account data.', parameters: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 80 } }, required: ['query'], additionalProperties: false } } }
];

async function executeTool(name, args, user) {
  const month = new Date().toISOString().slice(0, 7);
  const startDate = `${month}-01`;
  const endDate = new Date().toISOString().slice(0, 10);
  const employeeId = user.employeeId ? new mongoose.Types.ObjectId(user.employeeId) : null;
  const ownEmployee = employeeId ? { employeeId } : null;

  if (name === 'get_headcount') {
    if (user.role === 'Employee') return { error: 'This information is only available to HR and Admin.' };
    return { activeEmployees: await Employee.countDocuments({
      status: { $in: ['active', 'probation'] },
      ...(args.department ? { department: args.department } : {})
    }) };
  }
  if (name === 'get_attendance_summary') {
    const scope = user.role === 'Employee' ? ownEmployee : {};
    if (!scope) return { error: 'This account has no linked employee profile.' };
    const summary = await Attendance.aggregate([
      { $match: { ...scope, date: { $gte: startDate, $lte: endDate } } },
      { $group: { _id: '$status', count: { $sum: 1 }, hours: { $sum: '$workHours' } } }
    ]);
    return { month, attendance: summary };
  }
  if (name === 'get_late_comers') {
    const match = { status: 'late', date: { $gte: startDate, $lte: endDate } };
    if (user.role === 'Employee') {
      if (!user.employeeId) return { error: 'This account has no linked employee profile.' };
      match.employeeId = employeeId;
    }
    const lateComers = await Attendance.aggregate([
      { $match: match },
      { $group: { _id: '$employeeId', lateCount: { $sum: 1 } } },
      { $sort: { lateCount: -1 } },
      { $limit: Math.min(5, Math.max(1, Number(args.limit) || 5)) },
      { $lookup: { from: 'employees', localField: '_id', foreignField: '_id', as: 'employee' } },
      { $unwind: '$employee' },
      { $project: { lateCount: 1, name: { $concat: ['$employee.firstName', ' ', '$employee.lastName'] }, employeeCode: '$employee.employeeCode', department: '$employee.department' } }
    ]);
    return { month, lateComers };
  }
  if (name === 'get_leave_summary' || name === 'get_my_leave_balance') {
    if (name === 'get_my_leave_balance' && user.role !== 'Employee') return { error: 'This tool is reserved for employees.' };
    const match = {
      status: { $in: name === 'get_my_leave_balance' ? ['approved'] : ['approved', 'pending'] },
      ...(user.role === 'Employee' ? ownEmployee || {} : {})
    };
    if (user.role === 'Employee' && !ownEmployee) return { error: 'This account has no linked employee profile.' };
    const summary = await LeaveRequest.aggregate([
      { $match: match },
      { $group: { _id: { leaveType: '$leaveType', status: '$status' }, days: { $sum: '$daysCount' }, requests: { $sum: 1 } } }
    ]);
    if (name === 'get_leave_summary') return { leaveSummary: summary };
    const settings = await require('../models/CompanySettings').findOne().lean();
    const quotas = settings?.quotas || { annual: 14, sick: 8, casual: 10 };
    const used = Object.fromEntries(summary.map((item) => [item._id.leaveType, item.days]));
    return { leaveBalance: Object.fromEntries(Object.entries(quotas).map(([type, quota]) => [type, { used: used[type] || 0, remaining: Math.max(0, quota - (used[type] || 0)) }])) };
  }
  if (name === 'get_payroll_summary') {
    if (user.role === 'Employee') {
      if (!user.employeeId) return { error: 'This account has no linked employee profile.' };
      const payslips = await Payslip.find({       employeeId }).select('month grossSalary deductions netSalary').sort({ month: -1 }).limit(12).lean();
      return { ownPayslips: payslips };
    }
    const latest = await PayrollRun.findOne().sort({ month: -1 }).lean();
    return latest ? { payroll: latest } : { message: 'No payroll runs have been created yet.' };
  }
  if (name === 'search_employees') {
    if (user.role === 'Employee') return { error: 'Employee search is only available to HR and Admin.' };
    const search = String(args.query || '').trim().slice(0, 80);
    if (!search) return { error: 'Enter an employee name, code, or email.' };
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const employees = await Employee.find({
      $or: [
        { firstName: new RegExp(escaped, 'i') },
        { lastName: new RegExp(escaped, 'i') },
        { employeeCode: new RegExp(escaped, 'i') },
        { email: new RegExp(escaped, 'i') }
      ]
    }).select('employeeCode firstName lastName department designation status').limit(10).lean();
    return { employees };
  }
  return { error: 'Unsupported assistant tool.' };
}

function systemPrompt(user) {
  return `You are the HCM Lite assistant. Answer using only the data returned by your authorized tools and these rules: office opens 09:00, grace is 15 minutes, under 5 hours is a half-day, weekends and configured holidays are excluded from leave days, annual leave quota 14, sick 8, casual 10, unpaid leave unlimited, gross salary is 1.5 times basic salary (40% housing and 10% medical), only Admin finalizes payroll. Current role: ${user.role}. Never disclose another employee's salary or private data. If the required data is unavailable, say so instead of guessing.`;
}

exports.chat = async (req, res) => {
  const { value, error } = Joi.object({ message: Joi.string().trim().min(1).max(2000).required() })
    .validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) return res.status(400).json({ error: 'Enter a message of at most 2000 characters.' });
  const client = getClient();
  if (!client) return res.status(503).json({ error: 'AI is not configured. Add AI_API_KEY to the backend environment to enable the assistant.' });

  try {
    const messages = [
      { role: 'system', content: systemPrompt(req.user) },
      { role: 'user', content: value.message }
    ];
    let toolInvoked = [];
    let response = await client.chat.completions.create({
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      messages,
      tools,
      tool_choice: 'auto'
    });
    for (let iteration = 0; iteration < 4 && response.choices[0]?.message.tool_calls?.length; iteration += 1) {
      const assistant = response.choices[0].message;
      messages.push(assistant);
      for (const call of assistant.tool_calls) {
        let args;
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          args = {};
        }
        toolInvoked.push(call.function.name);
        const result = await executeTool(call.function.name, args, req.user);
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
      response = await client.chat.completions.create({
        model: process.env.AI_MODEL || 'gpt-4o-mini',
        messages,
        tools,
        tool_choice: 'auto'
      });
    }
    const reply = response.choices[0]?.message.content?.trim();
    if (!reply) return res.status(502).json({ error: 'The AI assistant returned an empty response. Please try again.' });
    await AILog.create({
      userEmail: req.user.email,
      role: req.user.role,
      prompt: value.message,
      toolInvoked: toolInvoked.join(', ') || null,
      response: reply
    });
    return res.json({ reply, isAIGenerated: true });
  } catch (err) {
    console.error('AI assistant request failed:', err.message);
    return res.status(503).json({ error: 'The AI assistant is temporarily unavailable. Please try again shortly.' });
  }
};

exports.dashboardSummary = async (req, res) => {
  const client = getClient();
  if (!client) return res.status(503).json({ error: 'AI is not configured. Add AI_API_KEY to the backend environment to enable summaries.' });
  const dashboard = require('./dashboardController');
  let metrics;
  const captured = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  const input = { query: req.body || {}, user: req.user };
  await (req.user.role === 'Admin' ? dashboard.getAdminDashboard(input, captured) : dashboard.getHrDashboard(input, captured));
  if (captured.statusCode !== 200) return res.status(captured.statusCode).json(captured.body);
  metrics = captured.body;
  const summaryData = {
    headcount: metrics.headcount,
    attendance: metrics.attendance || {},
    leaveSummary: metrics.leaveSummary || [],
    lateComers: metrics.lateComers || [],
    departments: metrics.byDepartment || metrics.headcountByDepartment || [],
    payrollRuns: (metrics.payrollRuns || []).map(({ month, status, totalGross, totalNet }) => ({ month, status, totalGross, totalNet }))
  };
  try {
    const result = await client.chat.completions.create({
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Summarize these real HCM dashboard figures in 3 to 5 concise, useful bullet points. Do not invent numbers, infer unavailable data, or reveal unnecessary personal information.' },
        { role: 'user', content: JSON.stringify(summaryData) }
      ]
    });
    const summary = result.choices[0]?.message.content?.trim();
    if (!summary) return res.status(502).json({ error: 'The AI assistant returned an empty summary.' });
    await AILog.create({ userEmail: req.user.email, role: req.user.role, prompt: '[Dashboard summary]', toolInvoked: null, response: summary });
    return res.json({ summary, data: summaryData, isAIGenerated: true });
  } catch (err) {
    console.error('AI dashboard summary failed:', err.message);
    return res.status(503).json({ error: 'The AI assistant is temporarily unavailable. Please try again shortly.' });
  }
};

exports.smartLeaveExtract = async (req, res) => {
  const { value, error } = Joi.object({ sentence: Joi.string().trim().min(5).max(500).required() })
    .validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) return res.status(400).json({ error: 'Describe your leave in at most 500 characters.' });
  const client = getClient();
  if (!client) return res.status(503).json({ error: 'AI is not configured. You can still submit a leave request using the regular form.' });

  try {
    const completion = await client.chat.completions.create({
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `Extract the employee's leave request as JSON only. Use keys leaveType (annual, sick, casual, unpaid), startDate and endDate (YYYY-MM-DD), and reason. Today is ${new Date().toISOString().slice(0, 10)}. Resolve relative dates from this day. If the type is not explicit, use casual. Never submit or approve the request; the user will review and confirm it.` },
        { role: 'user', content: value.sentence }
      ]
    });
    const parsed = JSON.parse(completion.choices[0]?.message.content || '');
    const validated = Joi.object({
      leaveType: Joi.string().valid('annual', 'sick', 'casual', 'unpaid').required(),
      startDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
      endDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
      reason: Joi.string().trim().min(1).max(1000).required()
    }).validate(parsed, { stripUnknown: true });
    if (validated.error || validated.value.startDate > validated.value.endDate) {
      return res.status(422).json({ error: 'The assistant could not determine valid leave dates. Enter them manually in the regular leave form.' });
    }
    await AILog.create({ userEmail: req.user.email, role: req.user.role, prompt: value.sentence, toolInvoked: 'smart_leave_extract', response: JSON.stringify(validated.value) });
    return res.json(validated.value);
  } catch (err) {
    console.error('Smart leave extraction failed:', err.message);
    return res.status(503).json({ error: 'Smart leave is temporarily unavailable. Please try the regular leave form.' });
  }
};
