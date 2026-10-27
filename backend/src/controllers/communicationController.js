const Joi = require('joi');
const Announcement = require('../models/Announcement');
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const LeaveRequest = require('../models/LeaveRequest');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { logAudit } = require('../utils/audit');
const { notifyUsers } = require('../utils/notifications');
const { companyDateString, isLate, companyLocalDateTime, isValidDateString } = require('../utils/companyTime');
const mongoose = require('mongoose');

exports.listAnnouncements = async (req, res) => {
  const audience = { $in: ['all', req.user.role] };
  const announcements = await Announcement.find({ audience }).populate('authorId', 'email').sort({ createdAt: -1 }).limit(100).lean();
  return res.json(announcements);
};

exports.createAnnouncement = async (req, res) => {
  const { value, error } = Joi.object({
    title: Joi.string().trim().min(2).max(160).required(),
    message: Joi.string().trim().min(2).max(4000).required(),
    audience: Joi.string().valid('all', 'HR', 'Employee').default('all')
  }).validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) return res.status(400).json({ error: error.details.map((item) => item.message.replaceAll('"', '')).join('. ') });
  const announcement = await Announcement.create({ ...value, authorId: req.user.id });
  const matchingUsers = await User.find({
    isActive: true,
    ...(value.audience === 'all' ? { role: { $in: ['Admin', 'HR', 'Employee'] } } : { role: value.audience })
  }).distinct('_id');
  await notifyUsers(matchingUsers.filter((id) => id.toString() !== req.user.id), value.title, 'announcement', announcement._id.toString());
  await logAudit(req.user.email, 'ANNOUNCEMENT_POSTED', 'Announcement', announcement._id, null, value);
  return res.status(201).json(announcement);
};

exports.listNotifications = async (req, res) => {
  const notifications = await Notification.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(100).lean();
  return res.json(notifications);
};

exports.markNotificationRead = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid notification ID.' });
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, userId: req.user.id },
    { $set: { readAt: new Date() } },
    { new: true }
  );
  if (!notification) return res.status(404).json({ error: 'Notification not found.' });
  return res.json(notification);
};

exports.getEmployeeAttendance = async (req, res) => {
  if (!req.user.employeeId) return res.status(403).json({ error: 'This account is not linked to an employee profile.' });
  const from = req.query.from;
  const to = req.query.to;
  const filter = { employeeId: req.user.employeeId };
  if (from && to) {
    if (!isValidDateString(from) || !isValidDateString(to) || from > to) {
      return res.status(400).json({ error: 'Use valid from/to dates in YYYY-MM-DD format.' });
    }
    filter.date = { $gte: from, $lte: to };
  }
  const records = await Attendance.find(filter).sort({ date: -1 }).limit(366).lean();
  const settings = await require('../models/CompanySettings').findOne().lean();
  const today = companyDateString(new Date(), settings?.timeZone);
  return res.json(records.map((record) => ({
    ...record,
    status: !record.checkOut && record.date < today && ['present', 'late'].includes(record.status)
      ? 'missing_checkout'
      : record.status
  })));
};

exports.requestAttendanceCorrection = async (req, res) => {
  const { value, error } = Joi.object({
    date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).custom((date, helpers) => (
      isValidDateString(date) ? date : helpers.error('date.format')
    )).required(),
    reason: Joi.string().trim().min(5).max(500).required(),
    checkIn: Joi.date().iso().optional(),
    checkOut: Joi.date().iso().optional()
  }).validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) return res.status(400).json({ error: error.details.map((item) => item.message.replaceAll('"', '')).join('. ') });
  if (!req.user.employeeId) return res.status(403).json({ error: 'This account is not linked to an employee profile.' });
  const companySettings = await require('../models/CompanySettings').findOne().lean();
  if (!companySettings) return res.status(409).json({ error: 'Company settings are not configured.' });
  const parsedDate = new Date(`${value.date}T00:00:00Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== value.date || value.date > companyDateString(new Date(), companySettings.timeZone)) {
    return res.status(400).json({ error: 'Choose a valid date that is not in the future.' });
  }
  if (value.checkIn && companyDateString(value.checkIn, companySettings.timeZone) !== value.date) {
    return res.status(400).json({ error: 'The requested check-in must fall on the selected attendance date.' });
  }
  if (value.checkOut && companyDateString(value.checkOut, companySettings.timeZone) !== value.date) {
    return res.status(400).json({ error: 'The requested check-out must fall on the selected attendance date.' });
  }
  if (value.checkIn && value.checkOut && value.checkOut <= value.checkIn) {
    return res.status(400).json({ error: 'The requested check-out must be after the check-in.' });
  }

  const AttendanceCorrection = require('../models/AttendanceCorrection');
  const session = await mongoose.startSession();
  let correction;
  try {
    await session.withTransaction(async () => {
      const record = await Attendance.findOne({ employeeId: req.user.employeeId, date: value.date }).session(session);
      if (record?.correctionRequested) {
        const pending = new Error('A correction request already exists for this date.');
        pending.status = 409;
        throw pending;
      }
      if (!record && !value.checkIn) {
        const missingCheckIn = new Error('Include a check-in time when requesting attendance for a missing record.');
        missingCheckIn.status = 400;
        throw missingCheckIn;
      }
      const effectiveCheckIn = value.checkIn || record?.checkIn;
      const effectiveCheckOut = value.checkOut || record?.checkOut;
      if (effectiveCheckIn && effectiveCheckOut && effectiveCheckOut <= effectiveCheckIn) {
        const invalidTimes = new Error('The requested check-out must be after the check-in.');
        invalidTimes.status = 400;
        throw invalidTimes;
      }
      if (record) {
        record.correctionRequested = true;
        record.correctionReason = value.reason;
        await record.save({ session });
      }
      [correction] = await AttendanceCorrection.create([{
        employeeId: req.user.employeeId,
        ...value,
        status: 'pending',
        ...(record ? { attendanceId: record._id } : {})
      }], { session });
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'A correction request already exists for this date.' });
    if (err.status === 400 || err.status === 409) return res.status(err.status).json({ error: err.message });
    throw err;
  } finally {
    await session.endSession();
  }

  const managers = await User.find({ role: { $in: ['Admin', 'HR'] }, isActive: true }).distinct('_id');
  await notifyUsers(managers, `Attendance correction requested for ${value.date}.`, 'account', correction._id.toString());
  await logAudit(req.user.email, 'ATTENDANCE_CORRECTION_REQUESTED', 'AttendanceCorrection', correction._id, null, correction.toObject());
  return res.status(201).json({ message: 'Your correction request has been sent for review.' });
};

exports.listAttendanceCorrections = async (req, res) => {
  const AttendanceCorrection = require('../models/AttendanceCorrection');
  const corrections = await AttendanceCorrection.find({ status: req.query.status || 'pending' })
    .populate('employeeId', 'firstName lastName department employeeCode')
    .populate('reviewedBy', 'email')
    .sort({ createdAt: 1 })
    .limit(200)
    .lean();
  return res.json(corrections);
};

exports.decideAttendanceCorrection = async (req, res) => {
  const { value, error } = Joi.object({
    action: Joi.string().valid('approved', 'rejected').required(),
    comment: Joi.string().trim().max(500).allow('').default('')
  }).validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) return res.status(400).json({ error: error.details.map((item) => item.message.replaceAll('"', '')).join('. ') });

  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid attendance correction ID.' });
  const AttendanceCorrection = require('../models/AttendanceCorrection');
  const session = await mongoose.startSession();
  let correction;
  try {
    await session.withTransaction(async () => {
      correction = await AttendanceCorrection.findOne({ _id: req.params.id, status: 'pending' }).session(session);
      if (!correction) return;
      if (value.action === 'approved') {
        const settings = await require('../models/CompanySettings').findOne().session(session);
        if (!settings) {
          const missingSettings = new Error('Company settings are not configured.');
          missingSettings.status = 409;
          throw missingSettings;
        }
        const checkIn = correction.checkIn || companyLocalDateTime(correction.date, settings.officeStart, settings.timeZone);
        const checkOut = correction.checkOut || null;
        let status = isLate(checkIn, settings.officeStart, settings.graceMinutes, settings.timeZone) ? 'late' : 'present';
        if (checkOut) {
          const workHours = (checkOut - checkIn) / 3600000;
          if (workHours <= 0) {
            const invalidTimes = new Error('The corrected check-out must follow the check-in.');
            invalidTimes.status = 409;
            throw invalidTimes;
          }
          if (workHours < settings.halfDayUnderHours) status = 'half_day';
        }
        if (!correction.attendanceId) {
          const [record] = await Attendance.create([{
            employeeId: correction.employeeId,
            date: correction.date,
            checkIn,
            checkOut,
            ...(checkOut ? { workHours: Number(((checkOut - checkIn) / 3600000).toFixed(2)) } : {}),
            status,
            source: 'web',
            correctionReason: correction.reason
          }], { session });
          correction.attendanceId = record._id;
        } else {
          const record = await Attendance.findById(correction.attendanceId).session(session);
          if (!record) {
            const missingRecord = new Error('The attendance record was removed before this request could be approved.');
            missingRecord.status = 409;
            throw missingRecord;
          }
          const beforeCheckIn = record.checkIn;
          record.checkIn = correction.checkIn || record.checkIn;
          if (correction.checkOut) record.checkOut = correction.checkOut;
          if (record.checkOut) {
            const workHours = (record.checkOut - record.checkIn) / 3600000;
            if (workHours <= 0) {
              const invalidTimes = new Error('The corrected check-out must follow the check-in.');
              invalidTimes.status = 409;
              throw invalidTimes;
            }
            record.workHours = Number(workHours.toFixed(2));
            status = workHours < settings.halfDayUnderHours ? 'half_day' : (isLate(record.checkIn, settings.officeStart, settings.graceMinutes, settings.timeZone) ? 'late' : 'present');
          } else if (record.checkIn.getTime() !== beforeCheckIn.getTime()) {
            status = isLate(record.checkIn, settings.officeStart, settings.graceMinutes, settings.timeZone) ? 'late' : 'present';
          }
          record.status = status;
          record.correctionRequested = false;
          record.correctionReason = correction.reason;
          await record.save({ session });
        }
      } else if (correction.attendanceId) {
        await Attendance.findByIdAndUpdate(correction.attendanceId, { $set: { correctionRequested: false } }, { session });
      }
      correction.status = value.action;
      correction.comment = value.comment;
      correction.reviewedBy = req.user.id;
      correction.reviewedAt = new Date();
      await correction.save({ session });
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'An attendance entry already exists for this date.' });
    if (err.status === 409) return res.status(409).json({ error: err.message });
    throw err;
  } finally {
    await session.endSession();
  }
  if (!correction) return res.status(404).json({ error: 'Pending attendance correction not found.' });

  const user = await User.findOne({ employeeId: correction.employeeId, role: 'Employee' }).select('_id').lean();
  await notifyUsers([user?._id], `Your attendance correction for ${correction.date} was ${value.action}.`, 'account', correction._id.toString());
  await logAudit(req.user.email, `ATTENDANCE_CORRECTION_${value.action.toUpperCase()}`, 'AttendanceCorrection', correction._id, null, correction.toObject());
  return res.json(correction);
};

exports.listLeaveRequests = async (req, res) => {
  const filter = {};
  if (req.user.role === 'Employee') {
    if (!req.user.employeeId) return res.status(403).json({ error: 'This account is not linked to an employee profile.' });
    filter.employeeId = req.user.employeeId;
  }
  if (req.query.status) filter.status = req.query.status;
  if (req.user.role !== 'Employee' && req.query.department) {
    const employees = await Employee.find({ department: req.query.department }).distinct('_id');
    filter.employeeId = { $in: employees };
  }
  const requests = await LeaveRequest.find(filter)
    .populate('employeeId', 'firstName lastName department employeeCode')
    .populate('approvedBy', 'email')
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();
  return res.json(requests);
};

exports.cancelLeaveRequest = async (req, res) => {
  if (!req.user.employeeId) return res.status(403).json({ error: 'This account is not linked to an employee profile.' });
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid leave request ID.' });
  const request = await LeaveRequest.findOneAndUpdate(
    { _id: req.params.id, employeeId: req.user.employeeId, status: 'pending' },
    { $set: { status: 'cancelled' } },
    { new: true }
  );
  if (!request) return res.status(404).json({ error: 'Pending leave request not found.' });
  await logAudit(req.user.email, 'LEAVE_CANCELLED', 'LeaveRequest', request._id, null, request.toObject());
  return res.json(request);
};
