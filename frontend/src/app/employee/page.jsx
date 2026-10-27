'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, Clock3, Download, FileText, LayoutDashboard, UserRound, Wallet } from 'lucide-react';
import API from '../../lib/api';
import AuthGate from '../../components/AuthGate';
import AIAssistantModal from '../../components/AIAssistantModal';
import SmartLeaveInput from '../../components/SmartLeaveInput';
import { WorkspaceLayout } from '../../components/WorkspaceLayout';
import { useAuth } from '../../context/AuthContext';

const tabs = [
  { id: 'overview', label: 'My overview', icon: LayoutDashboard },
  { id: 'attendance', label: 'Attendance', icon: Clock3 },
  { id: 'leave', label: 'Leave', icon: CalendarDays },
  { id: 'payslips', label: 'Payslips', icon: Wallet },
  { id: 'profile', label: 'My profile', icon: UserRound }
];
const inputClass = 'mt-1.5 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';
const cardClass = 'rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6';
const dateString = (date, timeZone) => new Intl.DateTimeFormat('en-CA', {
  timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
}).format(date);
const money = (value) => `PKR ${Number(value || 0).toLocaleString()}`;

function EmployeeDashboard() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');
  const [dashboard, setDashboard] = useState(null);
  const [attendanceHistory, setAttendanceHistory] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [payslips, setPayslips] = useState([]);
  const [timeZone, setTimeZone] = useState('Asia/Karachi');
  const [profile, setProfile] = useState({ phone: '', address: '' });
  const [correction, setCorrection] = useState({ date: '', reason: '', checkIn: '', checkOut: '' });
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [dashboardResponse, attendanceResponse, leaveResponse, payslipResponse, organizationResponse] = await Promise.all([
        API.get('/dashboard/employee'),
        API.get('/attendance/me'),
        API.get('/leave/requests'),
        API.get('/payroll/payslips'),
        API.get('/organization')
      ]);
      setDashboard(dashboardResponse.data);
      setAttendanceHistory(attendanceResponse.data);
      setLeaveRequests(leaveResponse.data);
      setPayslips(payslipResponse.data);
      const employee = dashboardResponse.data.employee;
      setProfile({ phone: employee.phone || '', address: employee.address || '' });
      setTimeZone(organizationResponse.data.timeZone || 'Asia/Karachi');
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load your workspace. Check the backend connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const today = useMemo(() => dateString(new Date(), timeZone), [timeZone]);
  const todayRecord = attendanceHistory.find((record) => record.date === today);
  const weekHours = useMemo(() => {
    const start = new Date();
    start.setDate(start.getDate() - 6);
    const startText = dateString(start, timeZone);
    return attendanceHistory
      .filter((record) => record.date >= startText && record.date <= today)
      .reduce((total, record) => total + (record.workHours || 0), 0);
  }, [attendanceHistory, timeZone, today]);

  const markAttendance = async (action) => {
    setSaving(true);
    setError('');
    setFeedback('');
    try {
      const { data } = await API.post(`/attendance/${action}`, action === 'check-in' ? { source: 'web' } : {});
      setFeedback(action === 'check-in' ? `Checked in at ${new Date(data.checkIn).toLocaleTimeString()}.` : `Checked out. Your recorded work time is ${data.workHours} hours.`);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || `Unable to ${action === 'check-in' ? 'check in' : 'check out'}.`);
    } finally {
      setSaving(false);
    }
  };

  const submitCorrection = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await API.post('/attendance/corrections', {
        ...correction,
        ...(correction.checkIn ? { checkIn: new Date(correction.checkIn).toISOString() } : {}),
        ...(correction.checkOut ? { checkOut: new Date(correction.checkOut).toISOString() } : {})
      });
      setCorrection({ date: '', reason: '', checkIn: '', checkOut: '' });
      setCorrectionOpen(false);
      setFeedback('Your attendance correction request has been sent to HR.');
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to submit your correction request.');
    } finally {
      setSaving(false);
    }
  };

  const cancelLeave = async (request) => {
    if (!window.confirm('Cancel this pending leave request?')) return;
    try {
      await API.patch(`/leave/${request._id}/cancel`);
      setFeedback('Your leave request has been cancelled.');
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to cancel this leave request.');
    }
  };

  const downloadPayslip = async (payslip) => {
    setError('');
    try {
      const { data } = await API.get(`/payroll/payslip/${payslip._id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `payslip-${payslip.month}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to download your payslip.');
    }
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    if (!dashboard?.employee?._id) return;
    setSaving(true);
    setError('');
    setFeedback('');
    try {
      await API.patch(`/employees/${dashboard.employee._id}`, profile);
      setFeedback('Your contact details have been updated.');
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to save your contact details.');
    } finally {
      setSaving(false);
    }
  };

  const requestsRefresh = async () => {
    setFeedback('Your request has been submitted.');
    await loadData();
  };

  return (
    <AuthGate roles={['Employee']}>
      <WorkspaceLayout
        title={`Welcome${dashboard?.employee?.firstName ? ` back, ${dashboard.employee.firstName}` : ''}`}
        description="Your attendance, time off, payslips and profile — everything about your workday in one place."
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        actions={<button onClick={loadData} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><span className={loading ? 'animate-spin' : ''}>↻</span> Refresh</button>}
      >
        {error && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
        {feedback && <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{feedback}</p>}

        {activeTab === 'overview' && (
          <div className="space-y-5">
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
              { label: 'Hours this week', value: `${weekHours.toFixed(1)} h`, note: 'Recorded in the last 7 days' },
              { label: 'Late this year', value: dashboard?.attendance?.late ?? 0, note: 'Late check-ins on record' },
              { label: 'Annual leave left', value: dashboard?.leaveBalance?.annual ?? '—', note: 'Approved annual leave used against your balance' },
              { label: 'Latest payslip', value: payslips.length ? money(payslips[0].netSalary) : 'Not yet available', note: payslips[0]?.month || 'Your finalized payslip appears here' }
            ].map((item) => <article key={item.label} className={cardClass}><p className="text-xs font-medium text-slate-500">{item.label}</p><p className="mt-3 break-words text-2xl font-bold tracking-tight text-slate-950">{item.value}</p><p className="mt-2 text-[11px] leading-5 text-slate-500">{item.note}</p></article>)}</section>
            <section className={`${cardClass} flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between`}><div><p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Today · {today}</p><h2 className="mt-2 text-lg font-semibold text-slate-950">{todayRecord ? (todayRecord.checkOut ? 'Your workday is complete' : 'You’re checked in') : 'Ready to start your day?'}</h2><p className="mt-1 max-w-lg text-sm leading-6 text-slate-500">{todayRecord ? `Check-in recorded at ${new Date(todayRecord.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${todayRecord.checkOut ? `, and check-out at ${new Date(todayRecord.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : '.'}` : 'Your check-in is stamped securely by the server using your company’s local time.'}</p><p className="mt-2 text-[11px] leading-5 text-slate-400">Camera check-in is an optional feature. Web check-in never requests camera or location access.</p></div><div className="flex flex-wrap gap-2">{!todayRecord && <button disabled={saving} onClick={() => markAttendance('check-in')} className="rounded-xl bg-indigo-600 px-5 py-3 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Saving…' : 'Check in'}</button>}{todayRecord && !todayRecord.checkOut && <button disabled={saving} onClick={() => markAttendance('check-out')} className="rounded-xl bg-slate-900 px-5 py-3 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">{saving ? 'Saving…' : 'Check out'}</button>}<button onClick={() => setActiveTab('attendance')} className="rounded-xl border border-slate-200 px-4 py-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">View history</button></div></section>
            <section className={`${cardClass} !p-0`}><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="font-semibold text-slate-950">Recent activity</h2><p className="mt-1 text-xs text-slate-500">Your own attendance and leave records.</p></div><button onClick={() => setActiveTab('leave')} className="text-xs font-semibold text-indigo-700 hover:underline">View time off</button></div><div className="grid gap-3 p-4 sm:grid-cols-2">{attendanceHistory.slice(0, 4).map((record) => <article key={record._id} className="rounded-xl bg-slate-50 p-3.5"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-800">{record.date}</span><span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold capitalize text-slate-600">{record.status.replace('_', ' ')}</span></div><p className="mt-2 text-[11px] text-slate-500">{new Date(record.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} check-in{record.workHours ? ` · ${record.workHours} hours` : ''}</p></article>)}{!attendanceHistory.length && <p className="rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500 sm:col-span-2">Your attendance activity will show here after your first check-in.</p>}</div></section>
          </div>
        )}

        {activeTab === 'attendance' && <div className="space-y-5"><section className={`${cardClass} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}><div><h2 className="font-semibold text-slate-950">Your attendance history</h2><p className="mt-1 text-xs text-slate-500">Only your own work records are shown.</p></div><button onClick={() => setCorrectionOpen((open) => !open)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">{correctionOpen ? 'Close request' : 'Request a correction'}</button></section>{correctionOpen && <form onSubmit={submitCorrection} className={`${cardClass} grid gap-4 sm:grid-cols-2`}><div className="sm:col-span-2"><h2 className="font-semibold text-slate-950">Request an attendance correction</h2><p className="mt-1 text-xs text-slate-500">Your manager reviews every request before your attendance record is changed.</p></div><label className="text-xs font-semibold text-slate-700">Date<input type="date" required max={today} value={correction.date} onChange={(event) => setCorrection({ ...correction, date: event.target.value })} className={inputClass} /></label><label className="text-xs font-semibold text-slate-700">Requested check-in (optional)<input type="datetime-local" value={correction.checkIn} onChange={(event) => setCorrection({ ...correction, checkIn: event.target.value })} className={inputClass} /></label><label className="text-xs font-semibold text-slate-700">Requested check-out (optional)<input type="datetime-local" value={correction.checkOut} onChange={(event) => setCorrection({ ...correction, checkOut: event.target.value })} className={inputClass} /></label><label className="text-xs font-semibold text-slate-700 sm:col-span-2">Reason<textarea required minLength={5} maxLength={500} rows={3} value={correction.reason} onChange={(event) => setCorrection({ ...correction, reason: event.target.value })} placeholder="Briefly explain the attendance correction you need." className={inputClass} /></label><button disabled={saving} className="rounded-xl bg-indigo-600 px-4 py-3 text-xs font-semibold text-white sm:col-span-2">{saving ? 'Submitting…' : 'Send to HR for review'}</button></form>}<section className={`${cardClass} !p-0`}><div className="overflow-x-auto"><table className="w-full min-w-[580px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Date</th><th className="px-5 py-3">Check in</th><th className="px-5 py-3">Check out</th><th className="px-5 py-3">Hours</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{attendanceHistory.map((record) => <tr key={record._id}><td className="px-5 py-3.5 font-medium text-slate-900">{record.date}</td><td className="px-5 py-3.5 text-xs text-slate-600">{new Date(record.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td><td className="px-5 py-3.5 text-xs text-slate-600">{record.checkOut ? new Date(record.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</td><td className="px-5 py-3.5 text-xs text-slate-700">{record.workHours ? `${record.workHours} h` : '—'}</td><td className="px-5 py-3.5"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold capitalize text-slate-700">{record.status.replace('_', ' ')}</span></td></tr>)}{!attendanceHistory.length && <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-500">No attendance records yet.</td></tr>}</tbody></table></div></section></div>}

        {activeTab === 'leave' && <div className="space-y-5"><section className="grid gap-3 sm:grid-cols-3">{Object.entries(dashboard?.leaveBalance || {}).filter(([type]) => type !== 'unpaid').map(([type, remaining]) => <article key={type} className={cardClass}><p className="text-xs font-medium capitalize text-slate-500">{type} leave remaining</p><p className="mt-3 text-3xl font-bold text-slate-950">{remaining}</p><p className="mt-1 text-[11px] text-slate-500">Approved days are counted against your configured yearly quota.</p></article>)}</section><SmartLeaveInput onApplied={requestsRefresh} /><section className={`${cardClass} !p-0`}><div className="border-b border-slate-100 px-5 py-4 sm:px-6"><h2 className="font-semibold text-slate-950">Your leave requests</h2><p className="mt-1 text-xs text-slate-500">Requests remain pending until HR makes a decision.</p></div><div className="divide-y divide-slate-100">{leaveRequests.map((request) => <article key={request._id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><p className="text-sm font-semibold capitalize text-slate-900">{request.leaveType} leave <span className={`ml-2 rounded-full px-2 py-1 text-[10px] uppercase ${request.status === 'approved' ? 'bg-emerald-50 text-emerald-700' : request.status === 'rejected' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>{request.status}</span></p><p className="mt-1 text-xs text-slate-600">{request.startDate} to {request.endDate} · {request.daysCount} working {request.daysCount === 1 ? 'day' : 'days'}</p><p className="mt-1 text-xs text-slate-500">{request.reason}</p>{request.comment && <p className="mt-1 text-xs text-indigo-700">HR note: {request.comment}</p>}</div>{request.status === 'pending' && <button onClick={() => cancelLeave(request)} className="self-start rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 sm:self-center">Cancel request</button>}</article>)}{!leaveRequests.length && <p className="px-5 py-9 text-center text-sm text-slate-500">No leave requests yet. You can request time off above.</p>}</div></section></div>}

        {activeTab === 'payslips' && <section className={`${cardClass} !p-0`}><div className="border-b border-slate-100 px-5 py-4 sm:px-6"><h2 className="font-semibold text-slate-950">Your payslips</h2><p className="mt-1 text-xs text-slate-500">Payslips are available once payroll is finalized by your Admin.</p></div><div className="divide-y divide-slate-100">{payslips.map((payslip) => <article key={payslip._id} className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><FileText size={18} /></span><div><p className="font-semibold text-slate-900">Payslip · {payslip.month}</p><p className="mt-1 text-xs text-slate-500">Net {money(payslip.netSalary)} · Gross {money(payslip.grossSalary)}</p></div></div><button onClick={() => downloadPayslip(payslip)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Download size={14} /> Download PDF</button></article>)}{!payslips.length && <div className="px-5 py-12 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-50 text-slate-400"><FileText size={22} /></span><p className="mt-3 text-sm font-medium text-slate-700">No payslips yet</p><p className="mt-1 text-xs text-slate-500">Your payslips will appear after your Admin finalizes a payroll run.</p></div>}</div></section>}

        {activeTab === 'profile' && dashboard?.employee && <div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]"><section className={cardClass}><div className="flex items-center gap-4"><span className="grid h-14 w-14 place-items-center rounded-2xl bg-indigo-50 text-indigo-600"><UserRound size={23} /></span><div><h2 className="font-semibold text-slate-950">{dashboard.employee.firstName} {dashboard.employee.lastName}</h2><p className="mt-1 text-xs text-slate-500">{dashboard.employee.designation} · {dashboard.employee.department}</p></div></div><dl className="mt-5 space-y-3 border-t border-slate-100 pt-4 text-xs"><div className="flex justify-between gap-3"><dt className="text-slate-500">Employee ID</dt><dd className="font-medium text-slate-800">{dashboard.employee.employeeCode}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-500">Work email</dt><dd className="break-all font-medium text-slate-800">{dashboard.employee.email}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-500">Joined</dt><dd className="font-medium text-slate-800">{new Date(dashboard.employee.joiningDate).toLocaleDateString()}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-500">Status</dt><dd className="font-medium capitalize text-slate-800">{dashboard.employee.status}</dd></div></dl></section><form onSubmit={saveProfile} className={`${cardClass} space-y-4`}><div><h2 className="font-semibold text-slate-950">Your contact details</h2><p className="mt-1 text-xs text-slate-500">You can update your phone number and home address. Contact HR to change work details.</p></div><label className="block text-xs font-semibold text-slate-700">Phone number<input maxLength={40} value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} className={inputClass} /></label><label className="block text-xs font-semibold text-slate-700">Address<textarea rows={3} maxLength={300} value={profile.address} onChange={(event) => setProfile({ ...profile, address: event.target.value })} className={inputClass} /></label><button disabled={saving} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save contact details'}</button></form></div>}
      </WorkspaceLayout>
      <AIAssistantModal />
    </AuthGate>
  );
}

export default EmployeeDashboard;
