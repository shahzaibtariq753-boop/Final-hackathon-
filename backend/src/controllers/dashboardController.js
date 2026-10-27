const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const LeaveRequest = require('../models/LeaveRequest');
const PayrollRun = require('../models/PayrollRun');
const Payslip = require('../models/Payslip');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const Announcement = require('../models/Announcement');
const CompanySettings = require('../models/CompanySettings');
const mongoose = require('mongoose');
const { companyDateString, isValidDateString } = require('../utils/companyTime');
const { workingDaysBetween } = require('../utils/workingDays');

function dateRange(query) {
  const now = new Date();
  const from = query.from || `${now.getFullYear()}-01-01`;
  const to = query.to || now.toISOString().slice(0, 10);
  if (!isValidDateString(from) || !isValidDateString(to) || from > to) return null;
  return { from, to };
}

exports.getEmployeeDashboard = async (req, res) => {
  const employeeId = req.user.employeeId;
  if (!employeeId) return res.status(403).json({ error: 'This account is not linked to an employee profile.' });
  const range = dateRange(req.query);
  if (!range) return res.status(400).json({ error: 'Use valid from/to dates in YYYY-MM-DD format.' });
  const year = Number(range.to.slice(0, 4));
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const [employee, attendance, leave, payslips, approvedLeaves, settings] = await Promise.all([
    Employee.findById(employeeId).lean(),
    Attendance.find({ employeeId, date: { $gte: range.from, $lte: range.to } }).sort({ date: -1 }).limit(90).lean(),
    LeaveRequest.find({ employeeId, startDate: { $lte: yearEnd }, endDate: { $gte: yearStart } }).sort({ startDate: -1 }).limit(100).lean(),
    Payslip.find({ employeeId }).sort({ month: -1 }).limit(12).lean(),
    LeaveRequest.find({ employeeId, status: 'approved', startDate: { $lte: yearEnd }, endDate: { $gte: yearStart } })
      .select('leaveType startDate endDate').lean(),
    CompanySettings.findOne().lean()
  ]);
  if (!employee) return res.status(404).json({ error: 'Employee profile not found.' });
  const used = approvedLeaves.reduce((totals, leaveRequest) => {
    const start = leaveRequest.startDate > yearStart ? leaveRequest.startDate : yearStart;
    const end = leaveRequest.endDate < yearEnd ? leaveRequest.endDate : yearEnd;
    totals[leaveRequest.leaveType] = (totals[leaveRequest.leaveType] || 0)
      + workingDaysBetween(start, end, settings?.weekend, settings?.publicHolidays);
    return totals;
  }, {});
  const today = companyDateString(new Date(), settings?.timeZone);
  const attendanceSummary = attendance.reduce((summary, record) => {
    const status = !record.checkOut && record.date < today && ['present', 'late'].includes(record.status)
      ? 'missing_checkout'
      : record.status;
    summary[status] = (summary[status] || 0) + 1;
    if (record.workHours) summary.workHours += record.workHours;
    return summary;
  }, { present: 0, late: 0, half_day: 0, absent: 0, missing_checkout: 0, workHours: 0 });
  const quotas = settings?.quotas || { annual: 14, sick: 8, casual: 10 };
  return res.json({
    employee,
    attendance: attendanceSummary,
    recentAttendance: attendance,
    leaveRequests: leave,
    leaveBalance: {
      annual: Math.max(0, quotas.annual - (used.annual || 0)),
      sick: Math.max(0, quotas.sick - (used.sick || 0)),
      casual: Math.max(0, quotas.casual - (used.casual || 0)),
      unpaid: null
    },
    payslips
  });
};

exports.getHrDashboard = async (req, res) => {
  const range = dateRange(req.query);
  if (!range) return res.status(400).json({ error: 'Use valid from/to dates in YYYY-MM-DD format.' });
  const departmentEmployeeIds = req.query.department
    ? await Employee.find({ department: req.query.department }).distinct('_id')
    : null;
  const [employeeFilter, records, leaveSummary, pendingLeaves, departments, payrollRuns, users] = await Promise.all([
    Employee.find({ status: { $in: ['active', 'probation'] }, ...(req.query.department ? { department: req.query.department } : {}) }).select('_id department').lean(),
    Attendance.find({ date: { $gte: range.from, $lte: range.to } }).populate('employeeId', 'firstName lastName department employeeCode').sort({ date: -1 }).limit(5000).lean(),
    LeaveRequest.aggregate([
      { $match: {
        startDate: { $lte: range.to },
        endDate: { $gte: range.from },
        ...(departmentEmployeeIds ? { employeeId: { $in: departmentEmployeeIds } } : {})
      } },
      { $group: { _id: { leaveType: '$leaveType', status: '$status' }, days: { $sum: '$daysCount' }, requests: { $sum: 1 } } }
    ]),
    LeaveRequest.find({ status: 'pending' }).populate('employeeId', 'firstName lastName department employeeCode').sort({ createdAt: 1 }).lean(),
    Employee.aggregate([
      { $match: { status: { $in: ['active', 'probation'] } } },
      { $group: { _id: '$department', headcount: { $sum: 1 } } },
      { $sort: { headcount: -1 } }
    ]),
    PayrollRun.find({ month: { $gte: range.from.slice(0, 7), $lte: range.to.slice(0, 7) } }).sort({ month: -1 }).lean(),
    req.user.role === 'Admin' ? User.find({ role: 'HR', isActive: true }).select('_id email').lean() : Promise.resolve([])
  ]);
  const allowedIds = new Set(employeeFilter.map((employee) => String(employee._id)));
  const attendance = records.filter((record) => record.employeeId && allowedIds.has(String(record.employeeId._id)));
  const people = new Map(employeeFilter.map((employee) => [String(employee._id), employee]));
  const lateCounts = new Map();
  for (const record of attendance) {
    if (record.status === 'late' && record.employeeId) {
      const id = String(record.employeeId._id);
      lateCounts.set(id, (lateCounts.get(id) || 0) + 1);
    }
  }
  const lateComers = [...lateCounts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, count]) => ({
    employee: attendance.find((record) => String(record.employeeId._id) === id).employeeId,
    lateCount: count,
    department: people.get(id)?.department
  }));
  const counts = attendance.reduce((result, record) => {
    result[record.status] = (result[record.status] || 0) + 1;
    return result;
  }, {});
  const departmentFilter = req.query.department;
  const filteredPendingLeaves = pendingLeaves.filter((leave) => !departmentFilter || leave.employeeId?.department === departmentFilter);
  const byDepartment = departments.filter((item) => !departmentFilter || item._id === departmentFilter);
  return res.json({
    range,
    headcount: employeeFilter.length,
    attendance: counts,
    attendanceRecords: attendance,
    leaveSummary: leaveSummary.filter((item) => item._id.status !== 'cancelled'),
    pendingLeaves: filteredPendingLeaves,
    lateComers,
    byDepartment,
    payrollRuns,
    hrUsers: users
  });
};

exports.getAdminDashboard = async (req, res) => {
  const range = dateRange(req.query);
  if (!range) return res.status(400).json({ error: 'Use valid from/to dates in YYYY-MM-DD format.' });
  const [headcount, exits, payroll, salaries, headcountByDepartment, payrollByDepartment, audit, announcements] = await Promise.all([
    Employee.countDocuments({ status: { $in: ['active', 'probation'] } }),
    Employee.countDocuments({ status: 'exited', leavingDate: { $gte: range.from, $lte: range.to } }),
    PayrollRun.find({ month: { $gte: range.from.slice(0, 7), $lte: range.to.slice(0, 7) } }).sort({ month: -1 }).lean(),
    Employee.aggregate([
      { $match: { status: { $in: ['active', 'probation'] } } },
      { $group: { _id: null, averageSalary: { $avg: { $multiply: ['$basicSalary', 1.5] } }, payrollCost: { $sum: { $multiply: ['$basicSalary', 1.5] } } } }
    ]),
    Employee.aggregate([{ $match: { status: { $in: ['active', 'probation'] } } }, { $group: { _id: '$department', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    Payslip.aggregate([
      { $match: { month: { $gte: range.from.slice(0, 7), $lte: range.to.slice(0, 7) } } },
      { $lookup: { from: 'payrollruns', localField: 'payrollRunId', foreignField: '_id', as: 'payrollRun' } },
      { $unwind: '$payrollRun' },
      { $match: { 'payrollRun.status': 'finalized' } },
      { $lookup: { from: 'employees', localField: 'employeeId', foreignField: '_id', as: 'employee' } },
      { $unwind: '$employee' },
      { $group: { _id: '$employee.department', gross: { $sum: '$grossSalary' }, net: { $sum: '$netSalary' } } },
      { $sort: { gross: -1 } }
    ]),
    AuditLog.find({ createdAt: { $gte: new Date(`${range.from}T00:00:00Z`), $lte: new Date(`${range.to}T23:59:59.999Z`) } }).sort({ createdAt: -1 }).limit(100).lean(),
    Announcement.find({}).sort({ createdAt: -1 }).limit(10).lean()
  ]);
  const averageHeadcount = headcount + exits;
  return res.json({
    range,
    headcount,
    attritionRate: averageHeadcount ? Number(((exits / averageHeadcount) * 100).toFixed(1)) : 0,
    payrollCost: salaries[0]?.payrollCost || 0,
    averageSalary: Math.round(salaries[0]?.averageSalary || 0),
    headcountByDepartment,
    payrollByDepartment,
    payrollRuns: payroll,
    audit,
    announcements
  });
};