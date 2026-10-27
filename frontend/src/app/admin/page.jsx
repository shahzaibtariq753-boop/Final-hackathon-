'use client';

import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Building2, Check, Clock3, Download, Megaphone, RefreshCw, Shield, UserPlus, Users, Wallet } from 'lucide-react';
import API from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import AuthGate from '../../components/AuthGate';
import AIAssistantModal from '../../components/AIAssistantModal';
import { AnnouncementForm, WorkspaceLayout } from '../../components/WorkspaceLayout';

const tabs = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'people', label: 'People', icon: Users },
  { id: 'settings', label: 'Company', icon: Building2 },
  { id: 'payroll', label: 'Payroll', icon: Wallet },
  { id: 'announcements', label: 'Updates', icon: Megaphone },
  { id: 'audit', label: 'Audit log', icon: Shield }
];
const inputClass = 'mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';
const cardClass = 'rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6';
const money = (value) => `PKR ${Number(value || 0).toLocaleString()}`;
const dateString = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function AdminDashboard() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');
  const [dashboard, setDashboard] = useState(null);
  const [users, setUsers] = useState([]);
  const [settings, setSettings] = useState(null);
  const [payroll, setPayroll] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [hrEmail, setHrEmail] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [feedback, setFeedback] = useState('');
  const [aiSummary, setAiSummary] = useState('');
  const [range, setRange] = useState(() => {
    const today = dateString(new Date());
    return { from: `${today.slice(0, 4)}-01-01`, to: today };
  });

  const loadData = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const [dash, userList, company, runs] = await Promise.all([
        API.get('/dashboard/admin', { params: range }),
        API.get('/users'),
        API.get('/organization'),
        API.get('/payroll')
      ]);
      setDashboard(dash.data);
      setUsers(userList.data);
      setSettings({
        companyName: company.data.companyName || '',
        timeZone: company.data.timeZone || 'Asia/Karachi',
        officeStart: company.data.officeStart || '09:00',
        graceMinutes: company.data.graceMinutes ?? 15,
        halfDayUnderHours: company.data.halfDayUnderHours ?? 5,
        weekend: (company.data.weekend || ['Saturday', 'Sunday']).join(', '),
        officeLocation: company.data.officeLocation || { lat: 24.8607, lng: 67.0011, radiusMeters: 150 },
        quotas: company.data.quotas || { annual: 14, sick: 8, casual: 10 },
        departments: (company.data.departments || []).join(', '),
        designations: (company.data.designations || []).join(', '),
        publicHolidays: (company.data.publicHolidays || []).map(({ date, name }) => `${date} | ${name}`).join('\n')
      });
      setPayroll(runs.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load the company workspace. Check the backend connection and try again.');
    } finally {
      setBusy(false);
    }
  }, [range]);

  useEffect(() => { loadData(); }, [loadData]);

  const createHr = async (event) => {
    event.preventDefault();
    setFeedback('');
    setError('');
    try {
      const { data } = await API.post('/users/hr', { email: hrEmail });
      setHrEmail('');
      setTemporaryPassword(data.temporaryPassword);
      setFeedback(`HR account created for ${data.user.email}. Share this temporary password securely; it will only be shown here once.`);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to create the HR account.');
    }
  };

  const updateAccount = async (account, updates) => {
    setError('');
    setFeedback('');
    try {
      const { data } = await API.patch(`/users/${account._id}`, updates);
      if (data.temporaryPassword) {
        setTemporaryPassword(data.temporaryPassword);
        setFeedback(`Temporary password reset for ${account.email}. Share it securely; it will only be shown here once.`);
      }
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to update this account.');
    }
  };

  const saveSettings = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setFeedback('');
    const holidays = settings.publicHolidays.split(/\r?\n/).filter(Boolean).map((line) => {
      const [date, ...name] = line.split('|');
      return { date: date.trim(), name: name.join('|').trim() };
    });
    try {
      await API.put('/organization', {
        ...settings,
        graceMinutes: Number(settings.graceMinutes),
        halfDayUnderHours: Number(settings.halfDayUnderHours),
        weekend: settings.weekend.split(',').map((day) => day.trim()).filter(Boolean),
        departments: settings.departments.split(',').map((item) => item.trim()).filter(Boolean),
        designations: settings.designations.split(',').map((item) => item.trim()).filter(Boolean),
        publicHolidays: holidays
      });
      setFeedback('Company settings have been saved.');
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to save company settings.');
    } finally {
      setBusy(false);
    }
  };

  const finalizePayroll = async (run) => {
    if (!window.confirm(`Finalize ${run.month}? Once finalized, this payroll is permanently locked.`)) return;
    try {
      await API.patch(`/payroll/${run._id}/finalize`);
      setFeedback(`Payroll for ${run.month} has been finalized.`);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to finalize this payroll.');
    }
  };

  const downloadCsv = async () => {
    try {
      const { data } = await API.get('/employees/export.csv', { responseType: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(data);
      link.download = 'hcm-employees.csv';
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to export the employee directory.');
    }
  };

  const createSummary = async () => {
    setError('');
    try {
      const { data } = await API.post('/ai/summary', {});
      setAiSummary(data.summary);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to create the dashboard summary.');
    }
  };

  return (
    <AuthGate roles={['Admin']}>
      <WorkspaceLayout
        title={`Good to see you${user?.email ? `, ${user.email.split('@')[0]}` : ''}`}
        description="Your company snapshot, payroll approvals, people and workspace settings — together in one place."
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        actions={<div className="flex flex-wrap items-center gap-2"><label className="text-[10px] font-medium text-slate-500">From<input aria-label="Dashboard start date" type="date" value={range.from} max={range.to} onChange={(event) => setRange({ ...range, from: event.target.value })} className="ml-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700" /></label><label className="text-[10px] font-medium text-slate-500">To<input aria-label="Dashboard end date" type="date" value={range.to} min={range.from} max={dateString(new Date())} onChange={(event) => setRange({ ...range, to: event.target.value })} className="ml-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700" /></label><button onClick={loadData} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Refresh</button></div>}
      >
        {error && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
        {feedback && <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{feedback}</p>}
        {temporaryPassword && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><div><p className="font-semibold">One-time temporary password</p><p className="mt-1 font-mono">{temporaryPassword}</p><p className="mt-1 text-xs">Copy and share this securely; it won’t be shown again.</p></div><button onClick={() => { navigator.clipboard.writeText(temporaryPassword); setFeedback('Temporary password copied.'); }} className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold">Copy</button></div>}

        {activeTab === 'overview' && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: 'Active team', value: dashboard?.headcount ?? '—', note: 'Active and probationary employees', icon: Users, color: 'bg-indigo-50 text-indigo-600' },
                { label: 'Monthly payroll cost', value: money(dashboard?.payrollCost), note: 'Current monthly salary forecast', icon: Wallet, color: 'bg-emerald-50 text-emerald-600' },
                { label: 'Average salary', value: money(dashboard?.averageSalary), note: 'Gross salary across the company', icon: BarChart3, color: 'bg-violet-50 text-violet-600' },
                { label: 'Attrition this period', value: `${dashboard?.attritionRate ?? 0}%`, note: 'Exited employees in selected period', icon: Clock3, color: 'bg-amber-50 text-amber-600' }
              ].map((item) => {
                const Icon = item.icon;
                return <article key={item.label} className={cardClass}><div className="flex items-start justify-between"><div><p className="text-xs font-medium text-slate-500">{item.label}</p><p className="mt-3 break-words text-xl font-bold tracking-tight text-slate-950">{item.value}</p></div><span className={`grid h-10 w-10 place-items-center rounded-xl ${item.color}`}><Icon size={19} /></span></div><p className="mt-2 text-[11px] text-slate-500">{item.note}</p></article>;
              })}
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <section className={cardClass}><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-950">Team by department</h2><p className="mt-1 text-xs text-slate-500">Live employee directory totals</p></div><button onClick={downloadCsv} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Download size={14} /> Export</button></div><div className="mt-5 space-y-4">{(dashboard?.headcountByDepartment || []).length ? dashboard.headcountByDepartment.map((item, index) => <div key={item._id}><div className="mb-1.5 flex justify-between text-xs"><span className="font-medium text-slate-700">{item._id}</span><span className="text-slate-500">{item.count} {item.count === 1 ? 'person' : 'people'}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${['bg-indigo-500', 'bg-violet-500', 'bg-sky-500', 'bg-emerald-500'][index % 4]}`} style={{ width: `${Math.min(100, (item.count / Math.max(1, dashboard.headcount)) * 100)}%` }} /></div></div>) : <p className="rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500">No employees yet. Start by creating an HR account and onboarding your team.</p>}</div></section>
              <section className={cardClass}><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-950">Quick AI insights</h2><p className="mt-1 text-xs text-slate-500">Summarized from this company’s current records.</p></div><button onClick={createSummary} className="rounded-xl bg-indigo-600 px-3.5 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700">Summarize data</button></div>{aiSummary ? <p className="mt-4 whitespace-pre-line rounded-xl bg-indigo-50 p-4 text-sm leading-6 text-indigo-950">{aiSummary}</p> : <p className="mt-4 rounded-xl border border-dashed border-slate-200 p-5 text-center text-sm text-slate-500">AI summaries use live company data and become available once you add your AI API key.</p>}<div className="mt-4 grid grid-cols-2 gap-3">{(dashboard?.payrollRuns || []).slice(0, 2).map((run) => <div key={run._id} className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-800">{run.month} payroll</p><p className="mt-1 text-[11px] text-slate-500">{run.status} · {money(run.totalNet)}</p></div>)}</div></section>
            </div>
          </div>
        )}

        {activeTab === 'people' && (
          <div className="space-y-5">
            <form onSubmit={createHr} className={`${cardClass} flex flex-col gap-4 sm:flex-row sm:items-end`}>
              <label className="flex-1 text-xs font-semibold text-slate-700">Add an HR teammate<input type="email" required value={hrEmail} onChange={(event) => setHrEmail(event.target.value)} placeholder="hr@yourcompany.com" className={inputClass} /></label>
              <button className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-xs font-semibold text-white hover:bg-indigo-700"><UserPlus size={15} /> Create HR login</button>
            </form>
            <section className={`${cardClass} !p-0`}>
              <div className="border-b border-slate-100 px-5 py-4 sm:px-6"><h2 className="font-semibold text-slate-950">Team accounts</h2><p className="mt-1 text-xs text-slate-500">Temporary passwords require a password change at first sign-in.</p></div>
              <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Account</th><th className="px-5 py-3">Role</th><th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{users.map((account) => <tr key={account._id}><td className="px-5 py-3.5"><p className="font-medium text-slate-900">{account.email}</p><p className="mt-0.5 text-xs text-slate-500">{account.employeeId ? `${account.employeeId.employeeCode} · ${account.employeeId.firstName} ${account.employeeId.lastName}` : 'Company account'}</p></td><td className="px-5 py-3.5"><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">{account.role}</span></td><td className="px-5 py-3.5"><span className={`text-xs font-medium ${account.isActive ? 'text-emerald-700' : 'text-slate-400'}`}>{account.isActive ? 'Active' : 'Disabled'}</span></td><td className="px-5 py-3.5 text-right"><div className="flex justify-end gap-2"><button onClick={() => updateAccount(account, { resetPassword: true })} className="rounded-lg border border-slate-200 px-2.5 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">Reset password</button><button onClick={() => updateAccount(account, { isActive: !account.isActive })} className="rounded-lg border border-slate-200 px-2.5 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">{account.isActive ? 'Disable' : 'Enable'}</button></div></td></tr>)}{!users.length && <tr><td colSpan={4} className="px-5 py-10 text-center text-sm text-slate-500">No HR or employee accounts yet.</td></tr>}</tbody></table></div>
            </section>
          </div>
        )}

        {activeTab === 'settings' && settings && (
          <form onSubmit={saveSettings} className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
            <section className={`${cardClass} space-y-4`}>
              <div><h2 className="font-semibold text-slate-950">Company profile & work rules</h2><p className="mt-1 text-xs text-slate-500">These rules apply to future attendance and leave records.</p></div>
              <label className="block text-xs font-semibold text-slate-700">Company name<input required value={settings.companyName} onChange={(event) => setSettings({ ...settings, companyName: event.target.value })} className={inputClass} /></label>
              <label className="block text-xs font-semibold text-slate-700">Company time zone<input required value={settings.timeZone} onChange={(event) => setSettings({ ...settings, timeZone: event.target.value })} placeholder="Asia/Karachi" className={inputClass} /></label>
              <div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-700">Office starts<input type="time" required value={settings.officeStart} onChange={(event) => setSettings({ ...settings, officeStart: event.target.value })} className={inputClass} /></label><label className="text-xs font-semibold text-slate-700">Grace period (minutes)<input type="number" min="0" max="180" required value={settings.graceMinutes} onChange={(event) => setSettings({ ...settings, graceMinutes: event.target.value })} className={inputClass} /></label><label className="text-xs font-semibold text-slate-700">Half-day after (hours)<input type="number" min="0" max="24" step="0.5" required value={settings.halfDayUnderHours} onChange={(event) => setSettings({ ...settings, halfDayUnderHours: event.target.value })} className={inputClass} /></label><label className="text-xs font-semibold text-slate-700">Weekend days<input required value={settings.weekend} onChange={(event) => setSettings({ ...settings, weekend: event.target.value })} placeholder="Saturday, Sunday" className={inputClass} /></label></div>
              <div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-700">Office latitude<input type="number" min="-90" max="90" step="any" value={settings.officeLocation.lat} onChange={(event) => setSettings({ ...settings, officeLocation: { ...settings.officeLocation, lat: Number(event.target.value) } })} className={inputClass} /></label><label className="text-xs font-semibold text-slate-700">Office longitude<input type="number" min="-180" max="180" step="any" value={settings.officeLocation.lng} onChange={(event) => setSettings({ ...settings, officeLocation: { ...settings.officeLocation, lng: Number(event.target.value) } })} className={inputClass} /></label><label className="text-xs font-semibold text-slate-700">Office radius (metres)<input type="number" min="1" step="1" value={settings.officeLocation.radiusMeters} onChange={(event) => setSettings({ ...settings, officeLocation: { ...settings.officeLocation, radiusMeters: Number(event.target.value) } })} className={inputClass} /></label></div>
            </section>
            <div className="space-y-5">
              <section className={`${cardClass} space-y-4`}><div><h2 className="font-semibold text-slate-950">Organization lists</h2><p className="mt-1 text-xs text-slate-500">Separate each item with a comma.</p></div><label className="block text-xs font-semibold text-slate-700">Departments<textarea rows={3} value={settings.departments} onChange={(event) => setSettings({ ...settings, departments: event.target.value })} className={inputClass} /></label><label className="block text-xs font-semibold text-slate-700">Job titles<textarea rows={3} value={settings.designations} onChange={(event) => setSettings({ ...settings, designations: event.target.value })} className={inputClass} /></label><div className="grid grid-cols-3 gap-3">{Object.entries(settings.quotas).map(([type, amount]) => <label key={type} className="text-xs font-semibold capitalize text-slate-700">{type}<input type="number" min="0" value={amount} onChange={(event) => setSettings({ ...settings, quotas: { ...settings.quotas, [type]: Number(event.target.value) } })} className={inputClass} /></label>)}</div></section>
              <section className={`${cardClass} space-y-3`}><div><h2 className="font-semibold text-slate-950">Public holidays</h2><p className="mt-1 text-xs leading-5 text-slate-500">One per line in YYYY-MM-DD | Holiday name format.</p></div><textarea rows={5} value={settings.publicHolidays} onChange={(event) => setSettings({ ...settings, publicHolidays: event.target.value })} placeholder={'2026-12-25 | Holiday'} className={inputClass} /><button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"><Check size={16} /> {busy ? 'Saving…' : 'Save company settings'}</button></section>
            </div>
          </form>
        )}

        {activeTab === 'payroll' && <section className={`${cardClass} !p-0`}><div className="border-b border-slate-100 px-5 py-4 sm:px-6"><h2 className="font-semibold text-slate-950">Review and finalize payroll</h2><p className="mt-1 text-xs text-slate-500">Finalizing locks a payroll run. HR must create a draft before it appears here.</p></div><div className="divide-y divide-slate-100">{payroll.map((run) => <article key={run._id} className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><p className="font-semibold text-slate-900">{run.month} payroll <span className={`ml-2 rounded-full px-2 py-1 text-[10px] uppercase ${run.status === 'finalized' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{run.status}</span></p><p className="mt-1 text-xs text-slate-500">Gross {money(run.totalGross)} · Net {money(run.totalNet)}</p></div>{run.status === 'draft' ? <button onClick={() => finalizePayroll(run)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-700"><Check size={14} /> Finalize & lock</button> : <span className="text-xs text-emerald-700">Locked{run.finalizedBy?.email ? ` by ${run.finalizedBy.email}` : ''}</span>}</article>)}{!payroll.length && <p className="px-5 py-10 text-center text-sm text-slate-500">No payroll runs have been created yet. Ask HR to prepare a draft.</p>}</div></section>}

        {activeTab === 'announcements' && <AnnouncementForm onPosted={loadData} />}

        {activeTab === 'audit' && <section className={`${cardClass} !p-0`}><div className="border-b border-slate-100 px-5 py-4 sm:px-6"><h2 className="font-semibold text-slate-950">Recent company activity</h2><p className="mt-1 text-xs text-slate-500">Protected, read-only audit history.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Time</th><th className="px-5 py-3">Who</th><th className="px-5 py-3">Action</th><th className="px-5 py-3">Record</th></tr></thead><tbody className="divide-y divide-slate-100">{(dashboard?.audit || []).map((log) => <tr key={log._id}><td className="whitespace-nowrap px-5 py-3.5 text-xs text-slate-500">{new Date(log.createdAt).toLocaleString()}</td><td className="px-5 py-3.5 text-xs font-medium text-slate-800">{log.actor}</td><td className="px-5 py-3.5"><span className="rounded-lg bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700">{log.action}</span></td><td className="px-5 py-3.5 text-xs text-slate-600">{log.entity}</td></tr>)}{!dashboard?.audit?.length && <tr><td colSpan={4} className="px-5 py-10 text-center text-sm text-slate-500">No activity recorded yet.</td></tr>}</tbody></table></div></section>}
      </WorkspaceLayout>
      <AIAssistantModal />
    </AuthGate>
  );
}

export default AdminDashboard;
