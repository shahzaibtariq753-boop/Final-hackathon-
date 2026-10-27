const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const LeaveRequest = require('../models/LeaveRequest');
const CompanySettings = require('../models/CompanySettings');
const { calculateDistanceInMeters } = require('../utils/haversine');
const { logAudit } = require('../utils/audit');
const { companyDateString, isLate, isValidDateString } = require('../utils/companyTime');

exports.checkIn = async (req, res) => {
  const employeeId = req.user.employeeId;
  if (!employeeId) return res.status(403).json({ error: 'This account is not linked to an employee profile.' });
  const settings = await CompanySettings.findOne();
  if (!settings) return res.status(409).json({ error: 'Company settings are not configured.' });
  const todayStr = companyDateString(new Date(), settings.timeZone);
  const existing = await Attendance.findOne({ employeeId, date: todayStr });
  if (existing) {
    return res.status(409).json({ error: 'You have already checked in for today.' });
  }

  const { lat, lng, source } = req.body;
  if (source !== undefined && !['web', 'camera'].includes(source)) {
    return res.status(400).json({ error: 'Choose a valid attendance source.' });
  }

  if (source === 'camera') {
    const { accuracy, faceCount } = req.body;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'Valid location coordinates are required for camera check-in.' });
    }
    if (!Number.isFinite(accuracy) || accuracy > 100) {
      return res.status(400).json({ error: 'Camera check-in requires GPS accuracy of 100 metres or better.' });
    }
    if (faceCount !== 1) return res.status(400).json({ error: 'Camera check-in requires exactly one detected face.' });
    const distance = calculateDistanceInMeters(Number(lat), Number(lng), settings.officeLocation.lat, settings.officeLocation.lng);
    if (distance > settings.officeLocation.radiusMeters) {
      return res.status(400).json({ error: `Outside office geofence radius. Distance: ${Math.round(distance)}m` });
    }
  }

  const now = new Date();
  const initialStatus = isLate(now, settings.officeStart, settings.graceMinutes, settings.timeZone) ? 'late' : 'present';

  let record;
  try {
    record = await Attendance.create({
      employeeId,
      date: todayStr,
      checkIn: now,
      status: initialStatus,
      source: source || 'web'
    });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'You have already checked in for today.' });
    throw error;
  }

  await logAudit(req.user.email, 'ATTENDANCE_CHECKED_IN', 'Attendance', record._id, null, record.toObject());
  return res.status(201).json(record);
};

exports.checkOut = async (req, res) => {
  const employeeId = req.user.employeeId;
  const todayStr = companyDateString(new Date(), (await CompanySettings.findOne())?.timeZone);

  const record = await Attendance.findOne({ employeeId, date: todayStr });
  if (!record) return res.status(404).json({ error: 'No active check-in found for today' });
  if (record.checkOut) return res.status(409).json({ error: 'You have already checked out for today.' });

  const now = new Date();
  const workHours = (now - new Date(record.checkIn)) / (1000 * 60 * 60);

  const settings = await CompanySettings.findOne();
  if (!settings) return res.status(409).json({ error: 'Company settings are not configured.' });
  let status = record.status;
  if (workHours < settings.halfDayUnderHours) {
    status = 'half_day';
  }

  const before = record.toObject();
  record.checkOut = now;
  record.workHours = Number(workHours.toFixed(2));
  record.status = status;
  await record.save();

  await logAudit(req.user.email, 'ATTENDANCE_CHECKED_OUT', 'Attendance', record._id, before, record.toObject());
  return res.json(record);
};

exports.getDailyBoard = async (req, res) => {
  const { date } = req.query;
  const settings = await CompanySettings.findOne().lean();
  if (!settings) return res.status(409).json({ error: 'Company settings are not configured.' });
  const targetDate = date || companyDateString(new Date(), settings.timeZone);
  if (!isValidDateString(targetDate)) {
    return res.status(400).json({ error: 'Date must use YYYY-MM-DD format.' });
  }
  const records = await Attendance.find({ date: targetDate })
    .populate('employeeId', 'firstName lastName department employeeCode designation')
    .sort({ checkIn: 1 })
    .lean();
  const weekday = new Date(`${targetDate}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const isWorkingDay = !settings.weekend.includes(weekday)
    && !settings.publicHolidays.some((holiday) => holiday.date === targetDate);
  if (!isWorkingDay) return res.json(records);

  const recordedIds = new Set(records.map((record) => String(record.employeeId?._id)));
  const [employees, approvedLeave] = await Promise.all([
    Employee.find({
      joiningDate: { $lte: new Date(`${targetDate}T23:59:59.999Z`) },
      $or: [
        { status: { $in: ['active', 'probation'] } },
        { status: 'exited', leavingDate: { $gte: new Date(`${targetDate}T00:00:00.000Z`) } }
      ]
    }).select('firstName lastName department employeeCode designation').lean(),
    LeaveRequest.find({ status: 'approved', startDate: { $lte: targetDate }, endDate: { $gte: targetDate } })
      .select('employeeId leaveType')
      .lean()
  ]);
  const leaveByEmployee = new Map(approvedLeave.map((leave) => [String(leave.employeeId), leave]));
  const today = companyDateString(new Date(), settings.timeZone);
  const missingCheckouts = records.map((record) => ({
    ...record,
    status: !record.checkOut && targetDate < today && ['present', 'late'].includes(record.status)
      ? 'missing_checkout'
      : record.status
  }));
  const notPresent = employees
    .filter((employee) => !recordedIds.has(String(employee._id)))
    .map((employee) => {
      const leave = leaveByEmployee.get(String(employee._id));
      return {
        _id: `daily-${employee._id}`,
        employeeId: employee,
        date: targetDate,
        checkIn: null,
        checkOut: null,
        source: null,
        status: leave ? 'on_leave' : 'absent',
        leaveType: leave?.leaveType || null
      };
    });
  return res.json([...missingCheckouts, ...notPresent].sort((a, b) => {
    if (a.status === 'absent' && b.status !== 'absent') return 1;
    if (b.status === 'absent' && a.status !== 'absent') return -1;
    return String(a.employeeId?.firstName).localeCompare(String(b.employeeId?.firstName));
  }));
};