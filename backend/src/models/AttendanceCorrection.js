const mongoose = require('mongoose');

const attendanceCorrectionSchema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  attendanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Attendance', default: null },
  date: { type: String, required: true },
  reason: { type: String, required: true, maxlength: 500 },
  checkIn: { type: Date, default: null },
  checkOut: { type: Date, default: null },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  comment: { type: String, default: '', maxlength: 500 },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null }
}, { timestamps: true });

attendanceCorrectionSchema.index({ employeeId: 1, date: 1 }, {
  unique: true,
  partialFilterExpression: { status: 'pending' }
});

module.exports = mongoose.model('AttendanceCorrection', attendanceCorrectionSchema);
