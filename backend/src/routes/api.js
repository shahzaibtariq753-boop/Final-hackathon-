const express = require('express');
const router = express.Router();
const { authGuard, roleGuard } = require('../middleware/auth');
const auth = require('../controllers/authController');
const attendance = require('../controllers/attendanceController');
const leave = require('../controllers/leaveController');
const payroll = require('../controllers/payrollController');
const ai = require('../controllers/aiController');
const employees = require('../controllers/employeeController');
const organization = require('../controllers/orgController');
const dashboard = require('../controllers/dashboardController');
const communication = require('../controllers/communicationController');
const AuditLog = require('../models/AuditLog');

router.get('/setup/first-run', auth.checkFirstRun);
router.post('/setup/first-run', auth.firstRunSetup);
router.post('/auth/login', auth.login);
router.post('/auth/change-password', authGuard, auth.changePassword);

router.get('/organization', authGuard, organization.getSettings);
router.put('/organization', authGuard, roleGuard(['Admin']), organization.updateSettings);
router.get('/users', authGuard, roleGuard(['Admin']), organization.listUsers);
router.post('/users/hr', authGuard, roleGuard(['Admin']), organization.createHrUser);
router.patch('/users/:id', authGuard, roleGuard(['Admin']), organization.updateUser);

router.get('/employees/export.csv', authGuard, roleGuard(['Admin', 'HR']), employees.exportCsv);
router.post('/employees/import/dry-run', authGuard, roleGuard(['HR']), employees.importDryRun);
router.post('/employees/import', authGuard, roleGuard(['HR']), employees.importCommit);
router.get('/employees', authGuard, roleGuard(['Admin', 'HR', 'Employee']), employees.list);
router.post('/employees', authGuard, roleGuard(['HR']), employees.create);
router.patch('/employees/:id', authGuard, roleGuard(['Admin', 'HR', 'Employee']), employees.update);

router.get('/dashboard/admin', authGuard, roleGuard(['Admin']), dashboard.getAdminDashboard);
router.get('/dashboard/hr', authGuard, roleGuard(['Admin', 'HR']), dashboard.getHrDashboard);
router.get('/dashboard/employee', authGuard, roleGuard(['Employee']), dashboard.getEmployeeDashboard);

router.post('/attendance/check-in', authGuard, roleGuard(['Employee']), attendance.checkIn);
router.post('/attendance/check-out', authGuard, roleGuard(['Employee']), attendance.checkOut);
router.get('/attendance/board', authGuard, roleGuard(['Admin', 'HR']), attendance.getDailyBoard);
router.get('/attendance/me', authGuard, roleGuard(['Employee']), communication.getEmployeeAttendance);
router.post('/attendance/corrections', authGuard, roleGuard(['Employee']), communication.requestAttendanceCorrection);
router.get('/attendance/corrections', authGuard, roleGuard(['Admin', 'HR']), communication.listAttendanceCorrections);
router.patch('/attendance/corrections/:id/decision', authGuard, roleGuard(['Admin', 'HR']), communication.decideAttendanceCorrection);

router.get('/leave/requests', authGuard, roleGuard(['Admin', 'HR', 'Employee']), communication.listLeaveRequests);
router.post('/leave/apply', authGuard, roleGuard(['Employee']), leave.applyLeave);
router.patch('/leave/:id/cancel', authGuard, roleGuard(['Employee']), communication.cancelLeaveRequest);
router.patch('/leave/:id/decision', authGuard, roleGuard(['HR']), leave.approveOrReject);

router.get('/payroll', authGuard, roleGuard(['Admin', 'HR']), payroll.listRuns);
router.post('/payroll/draft', authGuard, roleGuard(['HR']), payroll.createMonthlyDraft);
router.patch('/payroll/:id/finalize', authGuard, roleGuard(['Admin']), payroll.finalizePayroll);
router.get('/payroll/payslips', authGuard, roleGuard(['Admin', 'HR', 'Employee']), payroll.listPayslips);
router.get('/payroll/payslip/:payslipId/pdf', authGuard, roleGuard(['Admin', 'HR', 'Employee']), payroll.downloadPayslipPDF);

router.post('/ai/chat', authGuard, ai.chat);
router.post('/ai/smart-leave', authGuard, roleGuard(['Employee']), ai.smartLeaveExtract);
router.post('/ai/summary', authGuard, roleGuard(['Admin', 'HR']), ai.dashboardSummary);

router.get('/announcements', authGuard, communication.listAnnouncements);
router.post('/announcements', authGuard, roleGuard(['Admin', 'HR']), communication.createAnnouncement);
router.get('/notifications', authGuard, communication.listNotifications);
router.patch('/notifications/:id/read', authGuard, communication.markNotificationRead);

router.get('/audit/logs', authGuard, roleGuard(['Admin']), async (req, res) => {
  const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(100).lean();
  return res.json(logs);
});

module.exports = router;
