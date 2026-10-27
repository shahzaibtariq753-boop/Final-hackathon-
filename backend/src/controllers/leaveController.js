const LeaveRequest = require('../models/LeaveRequest');
const CompanySettings = require('../models/CompanySettings');
const User = require('../models/User');
const { logAudit } = require('../utils/audit');
const { notifyUsers } = require('../utils/notifications');
const { workingDaysBetween } = require('../utils/workingDays');
const { isValidDateString } = require('../utils/companyTime');
const mongoose = require('mongoose');

exports.applyLeave = async (req, res) => {
  const employeeId = req.user.employeeId;
  if (!employeeId) return res.status(403).json({ error: 'This account is not linked to an employee profile.' });
  const { leaveType, startDate, endDate, reason } = req.body;
  if (!['annual', 'sick', 'casual', 'unpaid'].includes(leaveType)) {
    return res.status(400).json({ error: 'Choose a valid leave type.' });
  }
  if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
    return res.status(400).json({ error: 'Start and end dates must use YYYY-MM-DD format.' });
  }
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 1000) {
    return res.status(400).json({ error: 'Enter a reason of at most 1000 characters.' });
  }

  if (startDate > endDate) {
    return res.status(400).json({ error: 'Start date cannot be after end date' });
  }

  // Check overlap (Over-balance or Overlap = 422)
  const overlapping = await LeaveRequest.findOne({
    employeeId,
    status: { $in: ['pending', 'approved'] },
    $or: [
      { startDate: { $lte: endDate }, endDate: { $gte: startDate } }
    ]
  });

  if (overlapping) {
    return res.status(422).json({ error: '422: Overlapping leave request exists' });
  }

  const settings = await CompanySettings.findOne();
  if (!settings) return res.status(409).json({ error: 'Company settings are not configured.' });
  const days = workingDaysBetween(startDate, endDate, settings.weekend, settings.publicHolidays);

  if (days <= 0) {
    return res.status(400).json({ error: 'Selected range contains zero working days' });
  }

  // Quota check
  if (leaveType !== 'unpaid') {
    const startYear = Number(startDate.slice(0, 4));
    const endYear = Number(endDate.slice(0, 4));
    const approved = await LeaveRequest.find({
      employeeId,
      leaveType,
      status: 'approved',
      startDate: { $lte: `${endYear}-12-31` },
      endDate: { $gte: `${startYear}-01-01` }
    }).select('startDate endDate').lean();
    const maxQuota = settings.quotas[leaveType] || 0;
    for (let year = startYear; year <= endYear; year += 1) {
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;
      const requestedStart = startDate > yearStart ? startDate : yearStart;
      const requestedEnd = endDate < yearEnd ? endDate : yearEnd;
      const requestedDays = workingDaysBetween(requestedStart, requestedEnd, settings.weekend, settings.publicHolidays);
      const approvedDays = approved.reduce((total, leave) => {
        const leaveStart = leave.startDate > yearStart ? leave.startDate : yearStart;
        const leaveEnd = leave.endDate < yearEnd ? leave.endDate : yearEnd;
        return total + workingDaysBetween(leaveStart, leaveEnd, settings.weekend, settings.publicHolidays);
      }, 0);
      if (approvedDays + requestedDays > maxQuota) {
        return res.status(422).json({
          error: `Quota exceeded in ${year}. Available: ${Math.max(0, maxQuota - approvedDays)}, Requested: ${requestedDays}.`
        });
      }
    }
  }

  const leave = await LeaveRequest.create({
    employeeId,
    leaveType,
    startDate,
    endDate,
    daysCount: days,
    reason
  });
  const managers = await User.find({ role: 'HR', isActive: true }).distinct('_id');
  await notifyUsers(managers, 'A new leave request is waiting for review.', 'leave', leave._id.toString());
  await logAudit(req.user.email, 'LEAVE_REQUESTED', 'LeaveRequest', leave._id, null, leave.toObject());
  return res.status(201).json(leave);
};

exports.approveOrReject = async (req, res) => {
  const { id } = req.params;
  const { action, comment } = req.body;
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid leave request ID.' });
  if (!['approved', 'rejected'].includes(action)) {
    return res.status(400).json({ error: 'Action must be approved or rejected.' });
  }
  if (comment !== undefined && (typeof comment !== 'string' || comment.length > 500)) {
    return res.status(400).json({ error: 'Comment must be at most 500 characters.' });
  }

  const leave = await LeaveRequest.findById(id);
  if (!leave) return res.status(404).json({ error: 'Leave request not found' });
  if (leave.status !== 'pending') return res.status(409).json({ error: 'This leave request has already been decided.' });

  const before = leave.toObject();
  leave.status = action;
  leave.comment = comment || '';
  leave.approvedBy = req.user.id;
  await leave.save();

  await logAudit(req.user.email, `LEAVE_${action.toUpperCase()}`, 'LeaveRequest', leave._id, before, leave);
  const user = await User.findOne({ employeeId: leave.employeeId, role: 'Employee' }).select('_id').lean();
  await notifyUsers([user?._id], `Your ${leave.leaveType} leave request was ${action}.${comment ? ` ${comment}` : ''}`, 'leave', leave._id.toString());
  return res.json(leave);
};