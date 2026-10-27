const mongoose = require('mongoose');

const companySettingsSchema = new mongoose.Schema({
  companyName: { type: String, required: true },
  timeZone: { type: String, default: 'Asia/Karachi' },
  officeStart: { type: String, default: "09:00" },
  graceMinutes: { type: Number, default: 15 },
  halfDayUnderHours: { type: Number, default: 5 },
  weekend: { type: [String], default: ["Saturday", "Sunday"] },
  officeLocation: {
    lat: { type: Number, default: 24.8607 },
    lng: { type: Number, default: 67.0011 },
    radiusMeters: { type: Number, default: 150 }
  },
  quotas: {
    annual: { type: Number, default: 14 },
    sick: { type: Number, default: 8 },
    casual: { type: Number, default: 10 }
  },
  departments: { type: [String], default: ["Engineering", "HR", "Sales", "Operations"] },
  designations: { type: [String], default: ["Junior", "Mid", "Senior", "Lead", "Manager"] },
  publicHolidays: [{ date: String, name: String }]
}, { timestamps: true });

module.exports = mongoose.model('CompanySettings', companySettingsSchema);