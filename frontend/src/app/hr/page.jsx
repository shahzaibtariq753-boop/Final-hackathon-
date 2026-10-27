'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Check, ClipboardList, Download, FileUp, LayoutDashboard, Megaphone, RefreshCw, UserRoundPlus, Users, Wallet, X } from 'lucide-react';
import API from '../../lib/api';
import AuthGate from '../../components/AuthGate';
import AIAssistantModal from '../../components/AIAssistantModal';
import { AnnouncementForm, WorkspaceLayout } from '../../components/WorkspaceLayout';

const tabs = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'employees', label: 'Employees', icon: Users },
  { id: 'attendance', label: 'Attendance', icon: CalendarClock },
  { id: 'leave', label: 'Leave inbox', icon: ClipboardList },
  { id: 'payroll', label: 'Payroll', icon: Wallet },
  { id: 'announcements', label: 'Updates', icon: Megaphone }
];
const inputClass = 'mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';
const cardClass = 'rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6';
const dateString = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const money = (value) => `PKR ${Number(value || 0).toLocaleString()}`;

function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(field.trim());
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error('This CSV contains an unclosed quoted field.');
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  const columns = ['employeeCode', 'firstName', 'lastName', 'email', 'phone', 'department', 'designation', 'joiningDate', 'basicSalary'];
  const header = rows.shift()?.map((item) => item.toLowerCase());
  if (!header || !columns.every((column) => header.includes(column.toLowerCase()))) {
    throw new Error(`The CSV needs these column headers: ${columns.join(', ')}.`);
  }
  return rows.map((values) => Object.fromEntries(header.map((name, index) => [name, values[index] || ''])))
    .map((record) => Object.fromEntries(Object.entries(record).map(([key, value]) => [key.toLowerCase(), value])));
}

function HRDashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  const [overview, setOverview] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [corrections, setCorrections] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [payrollRuns, setPayrollRuns] = useState([]);
  const [settings, setSettings] = useState(null);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [employeePage, setEmployeePage] = useState(1);
  const [employeeTotal, setEmployeeTotal] = useState(0);
  const [employeePages, setEmployeePages] = useState(0);
  const [selectedDate, setSelectedDate] = useState(dateString(new Date()));
  const [range, setRange] = useState(() => {
    const today = dateString(new Date());
    return { from: `${today.slice(0, 7)}-01`, to: today };
  });
  const [payrollMonth, setPayrollMonth] = useState(dateString(new Date()).slice(0, 7));
  const [employeeForm, setEmployeeForm] = useState(null);
  const [payrollResult, setPayrollResult] = useState(null);
  const [dryRun, setDryRun] = useState(null);
  const [temporaryCredentials, setTemporaryCredentials] = useState([]);
  const [comment, setComment] = useState({});
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiSummary, setAiSummary] = useState('');

  const loadCore = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const [dash, board, correctionList, requests, runs, company] = await Promise.all([
        API.get('/dashboard/hr', { params: { ...range, department: departmentFilter || undefined } }),
        API.get('/attendance/board', { params: { date: selectedDate } }),
        API.get('/attendance/corrections'),
        API.get('/leave/requests?status=pending'),
        API.get('/payroll'),
        API.get('/organization')
      ]);
      setOverview(dash.data);
      setAttendance(board.data);
      setCorrections(correctionList.data);
      setLeaveRequests(requests.data);
      setPayrollRuns(runs.data);
      setSettings(company.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load HR data. Check the backend connection and try again.');
    } finally {
      setBusy(false);
    }
  }, [departmentFilter, selectedDate, range]);

  const loadEmployees = useCallback(async () => {
    setError('');
    try {
      const { data } = await API.get('/employees', { params: { search: search || undefined, department: departmentFilter || undefined, limit: 25, page: employeePage } });
      setEmployees(data.employees);
      setEmployeeTotal(data.total);
      setEmployeePages(data.pages);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load the employee directory.');
    }
  }, [departmentFilter, employeePage, search]);

  useEffect(() => { loadCore(); }, [loadCore]);
  useEffect(() => { if (activeTab === 'employees') loadEmployees(); }, [activeTab, loadEmployees]);

  const createEmployee = async (event) => {
    event.preventDefault();
    setFeedback('');
    try {
      const { data } = await API.post('/employees', { ...employeeForm, basicSalary: Number(employeeForm.basicSalary) });
      setTemporaryCredentials([{ email: data.employee.email, temporaryPassword: data.temporaryPassword }]);
      setFeedback('Employee and sign-in account created. Share the temporary password securely; it is shown once.');
      setEmployeeForm(null);
      await Promise.all([loadEmployees(), loadCore()]);
    } catch (err) {
      setError(err.response?.data?.error || 'Employee registration failed.');
    }
  };

  const reviewLeave = async (request, action) => {
    setError('');
    try {
      await API.patch(`/leave/${request._id}/decision`, { action, comment: comment[request._id] || '' });
      setFeedback(`Leave request ${action}.`);
      await loadCore();
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to update this leave request.');
    }
  };

  const reviewCorrection = async (request, action) => {
    setError('');
    try {
      await API.patch(`/attendance/corrections/${request._id}/decision`, { action, comment: comment[request._id] || '' });
      setFeedback(`Attendance correction ${action}.`);
      await loadCore();
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to review this correction.');
    }
  };

  const updateStatus = async (employee, status) => {
    setError('');
    try {
      await API.patch(`/employees/${employee._id}`, {
        status,
        ...(status === 'exited' ? { leavingDate: dateString(new Date()) } : { leavingDate: null })
      });
      setFeedback(`${employee.firstName} ${employee.lastName} is now ${status}.`);
      await Promise.all([loadEmployees(), loadCore()]);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to update the employee.');
    }
  };

  const runPayroll = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { data } = await API.post('/payroll/draft', { month: payrollMonth });
      setPayrollResult(data.run);
      setFeedback(`Payroll draft for ${payrollMonth} is ready for Admin review.`);
      await loadCore();
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to calculate this payroll.');
    } finally {
      setBusy(false);
    }
  };

  const exportEmployees = async () => {
    try {
      const { data } = await API.get('/employees/export.csv', { responseType: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(data);
      link.download = 'hcm-employees.csv';
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to export employees.');
    }
  };

  const checkImport = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setDryRun(null);
    try {
      const records = parseCsv(await file.text());
      const { data } = await API.post('/employees/import/dry-run', { rows: records });
      setDryRun(data);
      setFeedback(data.invalid ? `${data.valid} ready to import; ${data.invalid} need fixing.` : `${data.valid} rows are ready to import.`);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Unable to validate this CSV.');
    }
  };

  const commitImport = async () => {
    setBusy(true);
    setError('');
    try {
      const validRows = dryRun.rows.filter((row) => row.valid).map((row) => row.value);
      const { data } = await API.post('/employees/import', { rows: validRows });
      setTemporaryCredentials(data.accounts);
      setFeedback(`${data.created} employees imported. Share these temporary passwords securely; they are shown once.`);
      setDryRun(null);
      await Promise.all([loadEmployees(), loadCore()]);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to import employees.');
    } finally {
      setBusy(false);
    }
  };

  const summarize = async () => {
    setError('');
    try {
      const { data } = await API.post('/ai/summary', { department: departmentFilter || undefined });
      setAiSummary(data.summary);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to summarize the HR dashboard.');
    }
  };

  const todayRecords = attendance || [];

  return (
    <AuthGate roles={['Admin', 'HR']}>
      <WorkspaceLayout
        title="People operations"
        description="Onboard teammates, support daily attendance, review requests and prepare accurate monthly payroll."
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        actions={<div className="flex flex-wrap items-center gap-2"><select aria-label="Filter by department" value={departmentFilter} onChange={(event) => { setDepartmentFilter(event.target.value); setEmployeePage(1); }} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-700"><option value="">All departments</option>{(settings?.departments || []).map((department) => <option key={department}>{department}</option>)}</select><label className="text-[10px] font-medium text-slate-500">From<input aria-label="Dashboard start date" type="date" value={range.from} max={range.to} onChange={(event) => setRange({ ...range, from: event.target.value })} className="ml-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700" /></label><label className="text-[10px] font-medium text-slate-500">To<input aria-label="Dashboard end date" type="date" value={range.to} min={range.from} max={dateString(new Date())} onChange={(event) => setRange({ ...range, to: event.target.value })} className="ml-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700" /></label><button onClick={loadCore} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Refresh</button></div>}
      >
        {error && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
        {feedback && <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{feedback}</p>}
        {temporaryCredentials.length > 0 && <section className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold text-amber-950">One-time employee sign-in details</h2><p className="mt-1 text-xs leading-5 text-amber-900">Copy these details and share them securely. Passwords are only displayed now, and each person must change theirs at first sign-in.</p></div><button onClick={() => setTemporaryCredentials([])} aria-label="Hide temporary credentials"><X size={16} /></button></div><div className="mt-3 space-y-2">{temporaryCredentials.map((item) => <div key={item.email} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-white p-3 text-xs"><span className="font-medium text-slate-800">{item.email}</span><code className="font-mono text-indigo-700">{item.temporaryPassword}</code></div>)}</div><button onClick={() => { navigator.clipboard.writeText(temporaryCredentials.map((item) => `${item.email}: ${item.temporaryPassword}`).join('\n')); setFeedback('Sign-in details copied. Share them securely.'); }} className="mt-3 rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-900">Copy sign-in details</button></section>}

        {activeTab === 'overview' && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
              { title: 'Active team', value: overview?.headcount ?? '—', hint: 'Active and probationary employees' },
              { title: 'Present today', value: todayRecords.filter((item) => ['present', 'late', 'half_day', 'missing_checkout'].includes(item.status)).length, hint: 'Attendance recorded for today' },
              { title: 'Late arrivals', value: todayRecords.filter((item) => item.status === 'late').length, hint: 'Based on configured office hours' },
              { title: 'Pending approvals', value: (overview?.pendingLeaves?.length || 0) + corrections.length, hint: 'Leave requests and attendance corrections' }
            ].map((item) => <article key={item.title} className={cardClass}><p className="text-xs font-medium text-slate-500">{item.title}</p><p className="mt-3 text-3xl font-bold tracking-tight text-slate-950">{item.value}</p><p className="mt-2 text-[11px] text-slate-500">{item.hint}</p></article>)}</div>
            <div className="grid gap-5 lg:grid-cols-2">
              <section className={cardClass}><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-950">Headcount by department</h2><p className="mt-1 text-xs text-slate-500">Current active and probationary team members.</p></div><button onClick={() => setActiveTab('employees')} className="text-xs font-semibold text-indigo-700 hover:underline">View directory</button></div><div className="mt-5 space-y-3">{(overview?.byDepartment || []).map((item) => <div key={item._id} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3"><span className="text-sm font-medium text-slate-700">{item._id}</span><span className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">{item.headcount}</span></div>)}{!overview?.byDepartment?.length && <p className="rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500">Your employee directory will appear here after onboarding.</p>}</div></section>
              <section className={cardClass}><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-950">Attendance at a glance</h2><p className="mt-1 text-xs text-slate-500">Live records for the selected day.</p></div><button onClick={() => setActiveTab('attendance')} className="text-xs font-semibold text-indigo-700 hover:underline">Attendance board</button></div><div className="mt-4 space-y-2">{todayRecords.slice(0, 5).map((record) => <div key={record._id} className="flex items-center justify-between gap-2 border-b border-slate-100 py-2.5"><div className="min-w-0"><p className="truncate text-sm font-medium text-slate-800">{record.employeeId?.firstName} {record.employeeId?.lastName}</p><p className="text-[11px] text-slate-500">{record.employeeId?.department} · {record.date}</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold capitalize text-slate-600">{record.status.replace('_', ' ')}</span></div>)}{!todayRecords.length && <p className="rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500">No attendance has been recorded today yet.</p>}</div></section>
            </div>
            <section className={`${cardClass} flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`}><div><h2 className="font-semibold text-slate-950">Make sense of this month</h2><p className="mt-1 text-xs text-slate-500">AI uses the same live HR data shown on your dashboard.</p></div><button onClick={summarize} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700">Summarize HR data</button>{aiSummary && <p className="whitespace-pre-line text-sm leading-6 text-slate-700 sm:max-w-xl">{aiSummary}</p>}</section>
          </div>
        )}

        {activeTab === 'employees' && (
          <div className="space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><label className="flex-1 text-xs font-semibold text-slate-700 sm:max-w-sm">Search directory<input value={search} onChange={(event) => { setSearch(event.target.value); setEmployeePage(1); }} placeholder="Name, work email or employee ID" className={inputClass} /></label><div className="flex flex-wrap gap-2"><button onClick={exportEmployees} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Download size={14} /> Export CSV</button><label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"><FileUp size={14} /> Import CSV<input type="file" accept=".csv,text/csv" onChange={checkImport} className="sr-only" /></label><button onClick={() => setEmployeeForm({ employeeCode: '', firstName: '', lastName: '', email: '', phone: '', address: '', department: settings?.departments?.[0] || '', designation: settings?.designations?.[0] || '', joiningDate: dateString(new Date()), basicSalary: '' })} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3.5 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700"><UserRoundPlus size={14} /> Add employee</button></div></div>
            {dryRun && <section className={`${cardClass} space-y-4`}><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-950">CSV import preview</h2><p className="mt-1 text-xs text-slate-500">{dryRun.valid} valid · {dryRun.invalid} need attention · {dryRun.total} total</p></div>{dryRun.valid > 0 && <button disabled={busy} onClick={commitImport} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">Import {dryRun.valid} valid rows</button>}</div><div className="max-h-56 space-y-2 overflow-y-auto">{dryRun.rows.filter((row) => !row.valid).map((row) => <p key={row.row} className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">Row {row.row}: {row.issues.join(' ')}</p>)}{!dryRun.invalid && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">All rows look good. Import to create employee accounts.</p>}</div></section>}
            {employeeForm && <form onSubmit={createEmployee} className={`${cardClass} space-y-4`}><div className="flex items-center justify-between"><div><h2 className="font-semibold text-slate-950">Onboard a teammate</h2><p className="mt-1 text-xs text-slate-500">An employee login and temporary password are created securely.</p></div><button type="button" onClick={() => setEmployeeForm(null)} aria-label="Close form"><X size={18} /></button></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[['employeeCode', 'Employee ID'], ['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Work email'], ['phone', 'Phone'], ['basicSalary', 'Monthly basic salary (PKR)'], ['joiningDate', 'Joining date']].map(([field, label]) => <label key={field} className="text-xs font-semibold text-slate-700">{label}<input type={field === 'joiningDate' ? 'date' : field === 'email' ? 'email' : field === 'basicSalary' ? 'number' : 'text'} min={field === 'basicSalary' ? '1' : undefined} required={!['phone'].includes(field)} value={employeeForm[field]} onChange={(event) => setEmployeeForm({ ...employeeForm, [field]: event.target.value })} className={inputClass} /></label>)}<label className="text-xs font-semibold text-slate-700">Department<select required value={employeeForm.department} onChange={(event) => setEmployeeForm({ ...employeeForm, department: event.target.value })} className={inputClass}>{(settings?.departments || []).map((item) => <option key={item}>{item}</option>)}</select></label><label className="text-xs font-semibold text-slate-700">Job title<select required value={employeeForm.designation} onChange={(event) => setEmployeeForm({ ...employeeForm, designation: event.target.value })} className={inputClass}>{(settings?.designations || []).map((item) => <option key={item}>{item}</option>)}</select></label></div><button className="rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700">Create employee login</button></form>}
            <section className={`${cardClass} !p-0`}><div className="border-b border-slate-100 px-5 py-4 sm:px-6"><h2 className="font-semibold text-slate-950">Employee directory</h2><p className="mt-1 text-xs text-slate-500">Showing {employees.length ? (employeePage - 1) * 25 + 1 : 0}–{Math.min(employeePage * 25, employeeTotal)} of {employeeTotal} employee profiles. Salary details are only available to authorized HR users.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Employee</th><th className="px-5 py-3">Department</th><th className="px-5 py-3">Start date</th><th className="px-5 py-3">Basic salary</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Set status</th></tr></thead><tbody className="divide-y divide-slate-100">{employees.map((employee) => <tr key={employee._id}><td className="px-5 py-3.5"><p className="font-medium text-slate-900">{employee.firstName} {employee.lastName}</p><p className="mt-0.5 text-xs text-slate-500">{employee.employeeCode} · {employee.email}</p></td><td className="px-5 py-3.5 text-xs text-slate-700">{employee.department}<span className="block text-slate-500">{employee.designation}</span></td><td className="px-5 py-3.5 text-xs text-slate-600">{new Date(employee.joiningDate).toLocaleDateString()}</td><td className="px-5 py-3.5 text-xs text-slate-700">{money(employee.basicSalary)}</td><td className="px-5 py-3.5"><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize ${employee.status === 'exited' ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700'}`}>{employee.status}</span></td><td className="px-5 py-3.5"><select aria-label={`Update status for ${employee.firstName}`} value={employee.status} onChange={(event) => updateStatus(employee, event.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"><option value="active">Active</option><option value="probation">Probation</option><option value="exited">Exited</option></select></td></tr>)}{!employees.length && <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-500">No employees match this search. Add a teammate to get started.</td></tr>}</tbody></table></div><div className="flex items-center justify-between border-t border-slate-100 px-5 py-3"><button onClick={() => setEmployeePage((page) => Math.max(1, page - 1))} disabled={employeePage <= 1} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40">Previous</button><p className="text-xs text-slate-500">Page {employeePages ? employeePage : 0} of {employeePages}</p><button onClick={() => setEmployeePage((page) => Math.min(employeePages, page + 1))} disabled={employeePage >= employeePages} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40">Next</button></div></section>
          </div>
        )}

        {activeTab === 'attendance' && <div className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-semibold text-slate-950">Daily attendance</h2><p className="mt-1 text-xs text-slate-500">Server-stamped check-ins, late arrivals and correction requests.</p></div><label className="text-xs font-semibold text-slate-700">Choose date<input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="ml-2 rounded-lg border border-slate-200 px-3 py-2 text-xs" /></label></div><section className={`${cardClass} !p-0`}><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Employee</th><th className="px-5 py-3">Department</th><th className="px-5 py-3">Check-in</th><th className="px-5 py-3">Check-out</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100">        {attendance.map((record) => <tr key={record._id}><td className="px-5 py-3.5 font-medium text-slate-900">{record.employeeId?.firstName} {record.employeeId?.lastName}<span className="block text-xs font-normal text-slate-500">{record.employeeId?.employeeCode}</span></td><td className="px-5 py-3.5 text-xs text-slate-600">{record.employeeId?.department}</td><td className="px-5 py-3.5 text-xs text-slate-600">{record.checkIn ? new Date(record.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</td><td className="px-5 py-3.5 text-xs text-slate-600">{record.checkOut ? new Date(record.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</td><td className="px-5 py-3.5"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold capitalize text-slate-700">{record.status === 'on_leave' ? `On leave${record.leaveType ? ` · ${record.leaveType}` : ''}` : record.status === 'missing_checkout' ? 'Missing checkout' : record.status.replace('_', ' ')}</span></td></tr>)}{!attendance.length && <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-500">No one has checked in on this day.</td></tr>}</tbody></table></div></section><section className={`${cardClass} !p-0`}><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold text-slate-950">Attendance correction requests</h2><p className="mt-1 text-xs text-slate-500">Review employee explanations before updating the attendance record.</p></div><div className="divide-y divide-slate-100">{corrections.map((item) => <article key={item._id} className="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_1.2fr_auto] lg:items-center"><div><p className="text-sm font-semibold text-slate-900">{item.employeeId?.firstName} {item.employeeId?.lastName} · {item.date}</p><p className="mt-1 text-xs text-slate-600">{item.reason}</p></div><label className="text-[11px] font-medium text-slate-600">Reviewer note<input value={comment[item._id] || ''} onChange={(event) => setComment({ ...comment, [item._id]: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs" /></label><div className="flex gap-2"><button onClick={() => reviewCorrection(item, 'approved')} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white">Approve</button><button onClick={() => reviewCorrection(item, 'rejected')} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700">Reject</button></div></article>)}{!corrections.length && <p className="px-5 py-8 text-center text-sm text-slate-500">No corrections waiting for review.</p>}</div></section></div>}

        {activeTab === 'leave' && <section className={`${cardClass} !p-0`}><div className="border-b border-slate-100 px-5 py-4 sm:px-6"><h2 className="font-semibold text-slate-950">Leave approval inbox</h2><p className="mt-1 text-xs text-slate-500">Review leave type, working days, dates and employee reason.</p></div><div className="divide-y divide-slate-100">{leaveRequests.map((request) => <article key={request._id} className="grid gap-4 px-5 py-5 lg:grid-cols-[1fr_1fr_auto] lg:items-center sm:px-6"><div><p className="font-semibold text-slate-900">{request.employeeId?.firstName} {request.employeeId?.lastName}<span className="ml-2 text-xs font-normal text-slate-500">{request.employeeId?.department}</span></p><p className="mt-1 text-xs capitalize text-slate-600">{request.leaveType} · {request.daysCount} working {request.daysCount === 1 ? 'day' : 'days'} · {request.startDate} to {request.endDate}</p><p className="mt-2 text-sm leading-5 text-slate-700">{request.reason}</p></div><label className="text-[11px] font-medium text-slate-600">Comment to employee<input value={comment[request._id] || ''} onChange={(event) => setComment({ ...comment, [request._id]: event.target.value })} placeholder="Optional decision note" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-xs" /></label><div className="flex gap-2"><button onClick={() => reviewLeave(request, 'approved')} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2.5 text-xs font-semibold text-white"><Check size={14} /> Approve</button><button onClick={() => reviewLeave(request, 'rejected')} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-2.5 text-xs font-semibold text-rose-700"><X size={14} /> Reject</button></div></article>)}{!leaveRequests.length && <p className="px-5 py-10 text-center text-sm text-slate-500">Your approval inbox is clear.</p>}</div></section>}

        {activeTab === 'payroll' && <div className="space-y-5"><form onSubmit={runPayroll} className={`${cardClass} flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between`}><div><h2 className="font-semibold text-slate-950">Prepare a monthly draft</h2><p className="mt-1 max-w-xl text-xs leading-5 text-slate-500">Gross = 1.5× basic salary. Attendance, approved leave, public holidays, joining/leaving dates and illustrative tax slabs are applied.</p></div><div className="flex gap-2"><input required type="month" value={payrollMonth} onChange={(event) => setPayrollMonth(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm" /><button disabled={busy} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">Calculate draft</button></div></form>{payrollResult && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Draft ready for {payrollResult.month}: gross {money(payrollResult.totalGross)} · net {money(payrollResult.totalNet)}.</p>}<section className={`${cardClass} !p-0`}><div className="border-b border-slate-100 px-5 py-4 sm:px-6"><h2 className="font-semibold text-slate-950">Payroll history</h2><p className="mt-1 text-xs text-slate-500">Admin reviews drafts and finalizes each month.</p></div><div className="divide-y divide-slate-100">{payrollRuns.map((run) => <article key={run._id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><p className="font-semibold text-slate-900">{run.month}<span className={`ml-2 rounded-full px-2 py-1 text-[10px] uppercase ${run.status === 'finalized' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{run.status}</span></p><p className="mt-1 text-xs text-slate-500">Gross {money(run.totalGross)} · Net {money(run.totalNet)}</p></div><p className="text-xs text-slate-500">{run.finalizedBy?.email ? `Approved by ${run.finalizedBy.email}` : 'Waiting for Admin approval'}</p></article>)}{!payrollRuns.length && <p className="px-5 py-9 text-center text-sm text-slate-500">No payroll has been prepared yet.</p>}</div></section></div>}

        {activeTab === 'announcements' && <AnnouncementForm onPosted={loadCore} />}
      </WorkspaceLayout>
      <AIAssistantModal />
    </AuthGate>
  );
}

export default HRDashboard;
