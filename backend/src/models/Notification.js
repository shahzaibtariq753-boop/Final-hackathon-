const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  message: { type: String, required: true, maxlength: 500 },
  type: { type: String, enum: ['leave', 'payroll', 'announcement', 'account'], default: 'account' },
  readAt: { type: Date, default: null },
  entityId: { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Notification', notificationSchema);
