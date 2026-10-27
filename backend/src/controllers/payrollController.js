const Joi = require('joi');
const mongoose = require('mongoose');
const PayrollRun = require('../models/PayrollRun');
const Payslip = require('../models/Payslip');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const LeaveRequest = require('../models/LeaveRequest');
const CompanySettings = require('../models/CompanySettings');
const User = require('../models/User');
const { calculateAnnualTax } = require('../utils/taxCalculator');
const { logAudit } = require('../utils/audit');
const { notifyUsers } = require('../utils/notifications');
const PDFDocument = require('pdfkit');
const { workingDaysBetween } = require('../utils/workingDays');

function monthEmploymentRange(employee, monthStart, monthEnd) {
  const joining = employee.joiningDate.toISOString().slice(0, 10);
  const leaving = employee.leavingDate?.toISOString().slice(0, 10);
  return {
    start: joining > monthStart ? joining : monthStart,
    end: leaving && leaving < monthEnd ? leaving : monthEnd
  };
}

exports.listRuns = async (req, res) => {
  const runs = await PayrollRun.find({}).populate('finalizedBy', 'email').sort({ month: -1 }).limit(120).lean();
  return res.json(runs);
};

exports.createMonthlyDraft = async (req, res) => {
  const { value, error } = Joi.object({
    month: Joi.string().pattern(/^\d{4}-(0[1-9]|1[0-2])$/).required()
  }).validate(req.body, { stripUnknown: true });
  if (error) return res.status(400).json({ error: 'Payroll month must use YYYY-MM format.' });
  const settings = await CompanySettings.findOne().lean();
  if (!settings) return res.status(409).json({ error: 'Company settings are not configured.' });
  if (req.user.role !== 'HR') return res.status(403).json({ error: 'Only HR can prepare a payroll draft.' });

  const monthStart = `${value.month}-01`;
  const monthEnd = new Date(Date.UTC(Number(value.month.slice(0, 4)), Number(value.month.slice(5), 10), 0))
    .toISOString().slice(0, 10);
  const employees = await Employee.find({
    status: { $in: ['active', 'probation', 'exited'] },
    joiningDate: { $lte: new Date(`${monthEnd}T23:59:59.999Z`) },
    $or: [{ leavingDate: null }, { leavingDate: { $gte: new Date(`${monthStart}T00:00:00.000Z`) } }]
  }).lean();

  const employeeIds = employees.map((employee) => employee._id);
  const [allAttendance, allApprovedLeaves] = employeeIds.length ? await Promise.all([
    Attendance.find({ employeeId: { $in: employeeIds }, date: { $gte: monthStart, $lte: monthEnd } }).lean(),
    LeaveRequest.find({
      employeeId: { $in: employeeIds },
      status: 'approved',
      startDate: { $lte: monthEnd },
      endDate: { $gte: monthStart }
    }).lean()
  ]) : [[], []];
  const attendanceByEmployee = new Map();
  const leaveByEmployee = new Map();
  for (const record of allAttendance) {
    const key = String(record.employeeId);
    attendanceByEmployee.set(key, [...(attendanceByEmployee.get(key) || []), record]);
  }
  for (const leave of allApprovedLeaves) {
    const key = String(leave.employeeId);
    leaveByEmployee.set(key, [...(leaveByEmployee.get(key) || []), leave]);
  }

  const slips = employees.map((employee) => {
    const period = monthEmploymentRange(employee, monthStart, monthEnd);
    const workingDays = workingDaysBetween(period.start, period.end, settings.weekend, settings.publicHolidays);
    const attendanceRecords = attendanceByEmployee.get(String(employee._id)) || [];
    const approvedLeaves = leaveByEmployee.get(String(employee._id)) || [];

    const datesWithAttendance = new Set(attendanceRecords.map((record) => record.date));
    const halfDays = attendanceRecords.filter((record) => record.status === 'half_day').length;
    const recordedDays = datesWithAttendance.size;
    const leaveDays = approvedLeaves.reduce((sum, leave) => {
      const start = leave.startDate > period.start ? leave.startDate : period.start;
      const end = leave.endDate < period.end ? leave.endDate : period.end;
      return sum + workingDaysBetween(start, end, settings.weekend, settings.publicHolidays);
    }, 0);
    const unpaidLeaveDays = approvedLeaves.filter((leave) => leave.leaveType === 'unpaid').reduce((sum, leave) => {
      const start = leave.startDate > period.start ? leave.startDate : period.start;
      const end = leave.endDate < period.end ? leave.endDate : period.end;
      return sum + workingDaysBetween(start, end, settings.weekend, settings.publicHolidays);
    }, 0);
    const absentDays = Math.max(0, workingDays - recordedDays - leaveDays);
    const basic = employee.basicSalary * (workingDays / Math.max(1, workingDaysBetween(monthStart, monthEnd, settings.weekend, settings.publicHolidays)));
    const hra = basic * 0.4;
    const medical = basic * 0.1;
    const gross = basic + hra + medical;
    const perDayRate = gross / Math.max(1, workingDays);
    const deductionAmount = Math.min(gross, (absentDays + unpaidLeaveDays + 0.5 * halfDays) * perDayRate);
    const annualTax = calculateAnnualTax((employee.basicSalary + employee.basicSalary * 0.5) * 12);
    const monthlyTax = annualTax / 12;

    return {
      employeeId: employee._id,
      month: value.month,
      basic: Math.round(basic),
      hra: Math.round(hra),
      medical: Math.round(medical),
      grossSalary: Math.round(gross),
      workingDays,
      absentDays,
      halfDays,
      unpaidLeaveDays,
      deductions: Math.round(deductionAmount),
      annualTax: Math.round(annualTax),
      monthlyTax: Math.round(monthlyTax),
      netSalary: Math.round(Math.max(0, gross - deductionAmount - monthlyTax))
    };
  });

  const session = await mongoose.startSession();
  let run;
  try {
    await session.withTransaction(async () => {
      run = await PayrollRun.findOne({ month: value.month }).session(session);
      if (run?.status === 'finalized') {
        const finalized = new Error('Payroll is finalized and locked.');
        finalized.status = 409;
        throw finalized;
      }
      if (!run) run = new PayrollRun({ month: value.month, status: 'draft' });
      const totalGross = slips.reduce((sum, payslip) => sum + payslip.grossSalary, 0);
      const totalNet = slips.reduce((sum, payslip) => sum + payslip.netSalary, 0);
      run.totalGross = totalGross;
      run.totalNet = totalNet;
      await run.save({ session });
      await Payslip.deleteMany({ payrollRunId: run._id }, { session });
      if (slips.length) await Payslip.insertMany(slips.map((payslip) => ({ ...payslip, payrollRunId: run._id })), { session });
    });
  } catch (err) {
    if (err.status === 409) return res.status(409).json({ error: err.message });
    throw err;
  } finally {
    await session.endSession();
  }
  await logAudit(req.user.email, 'PAYROLL_DRAFT_CREATED', 'PayrollRun', run._id, null, run.toObject());
  const admins = await User.find({ role: 'Admin', isActive: true }).distinct('_id');
  await notifyUsers(admins, `Payroll draft for ${run.month} is ready for review.`, 'payroll', run._id.toString());
  return res.json({ message: 'Payroll draft calculated.', run, payslipCount: slips.length });
};

exports.finalizePayroll = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid payroll ID.' });
  const run = await PayrollRun.findOneAndUpdate(
    { _id: req.params.id, status: 'draft' },
    { $set: { status: 'finalized', finalizedBy: req.user.id, finalizedAt: new Date() } },
    { new: true }
  );
  if (!run) {
    const existing = await PayrollRun.findById(req.params.id).select('status').lean();
    if (!existing) return res.status(404).json({ error: 'Payroll run not found.' });
    return res.status(409).json({ error: 'This payroll has already been finalized.' });
  }
  await logAudit(req.user.email, 'FINALIZE_PAYROLL', 'PayrollRun', run._id, null, run.toObject());
  const employeesWithPayslips = await Payslip.find({ payrollRunId: run._id }).distinct('employeeId');
  const employeeUsers = await User.find({ role: 'Employee', isActive: true, employeeId: { $in: employeesWithPayslips } }).distinct('_id');
  await notifyUsers(employeeUsers, `Your payslip for ${run.month} is available.`, 'payroll', run._id.toString());
  return res.json({ message: 'Payroll has been finalized and locked.', run });
};

exports.listPayslips = async (req, res) => {
  const filter = {};
  if (req.user.role === 'Employee') {
    if (!req.user.employeeId) return res.status(403).json({ error: 'This account is not linked to an employee profile.' });
    filter.employeeId = req.user.employeeId;
    const finalizedRuns = await PayrollRun.find({ status: 'finalized' }).distinct('_id');
    if (!finalizedRuns.length) return res.json([]);
    filter.payrollRunId = { $in: finalizedRuns };
  }
  if (req.query.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month)) filter.month = req.query.month;
  else if (req.query.month) return res.status(400).json({ error: 'Payroll month must use YYYY-MM format.' });
  const payslips = await Payslip.find(filter).populate('employeeId', 'firstName lastName department employeeCode').sort({ month: -1 }).limit(500).lean();
  return res.json(payslips);
};

exports.downloadPayslipPDF = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.payslipId)) return res.status(400).json({ error: 'Invalid payslip ID.' });
  const payslip = await Payslip.findById(req.params.payslipId).populate('employeeId');
  if (!payslip) return res.status(404).json({ error: 'Payslip not found.' });
  if (req.user.role === 'Employee' && req.user.employeeId !== payslip.employeeId?._id.toString()) {
    return res.status(403).json({ error: 'You can only view your own payslips.' });
  }
  if (req.user.role === 'Employee' && !(await PayrollRun.exists({ _id: payslip.payrollRunId, status: 'finalized' }))) {
    return res.status(404).json({ error: 'Payslip not found.' });
  }
  const doc = new PDFDocument({ margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="payslip-${payslip.month}.pdf"`);
  doc.pipe(res);
  doc.fontSize(20).text('HCM Lite — Employee Payslip', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Employee: ${payslip.employeeId.firstName} ${payslip.employeeId.lastName}`);
  doc.text(`Employee ID: ${payslip.employeeId.employeeCode}`);
  doc.text(`Department: ${payslip.employeeId.department}`);
  doc.text(`Month: ${payslip.month}`);
  doc.moveDown();
  doc.text(`Basic salary: PKR ${payslip.basic.toLocaleString()}`);
  doc.text(`HRA (40%): PKR ${payslip.hra.toLocaleString()}`);
  doc.text(`Medical (10%): PKR ${payslip.medical.toLocaleString()}`);
  doc.text(`Gross salary: PKR ${payslip.grossSalary.toLocaleString()}`);
  doc.text(`Working days: ${payslip.workingDays}; absent days: ${payslip.absentDays}`);
  doc.text(`Half days: ${payslip.halfDays}; unpaid leave days: ${payslip.unpaidLeaveDays}`);
  doc.text(`Deductions: PKR ${payslip.deductions.toLocaleString()}`);
  doc.text(`Monthly tax: PKR ${payslip.monthlyTax.toLocaleString()}`);
  doc.moveDown();
  doc.fontSize(14).text(`Net salary: PKR ${payslip.netSalary.toLocaleString()}`);
  doc.end();
};
