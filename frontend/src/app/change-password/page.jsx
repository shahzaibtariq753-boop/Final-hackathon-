'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import API from '../../lib/api';
import AuthGate from '../../components/AuthGate';
import { useAuth } from '../../context/AuthContext';

export default function ChangePasswordPage() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (form.newPassword.length < 10) return setError('Choose a password with at least 10 characters.');
    if (form.newPassword !== form.confirmPassword) return setError('The new passwords do not match.');
    setLoading(true);
    try {
      await API.post('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword
      });
      logout();
      router.replace('/login');
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to change your password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthGate>
      <main className="grid min-h-[calc(100vh-68px)] place-items-center bg-[#f5f7fb] p-4">
        <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50 sm:p-8">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-indigo-50 text-indigo-600"><KeyRound size={22} /></span>
          <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-indigo-600">Secure your account</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">{user?.mustChangePassword ? 'Set your own password' : 'Change your password'}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{user?.mustChangePassword ? 'You signed in with a temporary password. Choose a new one before continuing to your workspace.' : 'A fresh password helps keep your work account secure.'}</p>
          {error && <p role="alert" className="mt-5 rounded-xl bg-rose-50 px-3.5 py-3 text-sm text-rose-800">{error}</p>}
          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block text-xs font-semibold text-slate-700">Current password<input required autoComplete="current-password" type="password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></label>
            <label className="block text-xs font-semibold text-slate-700">New password<input required minLength={10} autoComplete="new-password" type="password" value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /><span className="mt-1 block text-[11px] font-normal text-slate-500">At least 10 characters and different from your current password.</span></label>
            <label className="block text-xs font-semibold text-slate-700">Confirm new password<input required minLength={10} autoComplete="new-password" type="password" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></label>
            <button disabled={loading} className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50">{loading ? 'Updating password…' : 'Update password & sign in again'}</button>
          </form>
        </section>
      </main>
    </AuthGate>
  );
}
