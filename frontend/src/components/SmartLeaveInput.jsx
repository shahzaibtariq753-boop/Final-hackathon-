'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import API from '../lib/api';

const fieldClass = 'mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';

export default function SmartLeaveInput({ onApplied }) {
  const [prompt, setPrompt] = useState('');
  const [extracted, setExtracted] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const handleParse = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setFeedback('');
    try {
      const { data } = await API.post('/ai/smart-leave', { sentence: prompt });
      setExtracted(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to understand your request. You can also fill out the leave form below.');
    } finally {
      setLoading(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setFeedback('');
    try {
      await API.post('/leave/apply', extracted);
      setFeedback('Your leave request was sent to HR for review.');
      setExtracted(null);
      setPrompt('');
      onApplied?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to submit your request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4"><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-indigo-600"><Sparkles size={14} /> Optional AI helper</p><h2 className="mt-2 font-semibold text-slate-950">Apply for leave</h2><p className="mt-1 text-xs leading-5 text-slate-500">Describe your request in plain words to prefill the form. You will review and confirm before it is submitted.</p></div>
      <form onSubmit={handleParse} className="flex flex-col gap-2 sm:flex-row">
        <input aria-label="Describe your leave request" minLength={5} maxLength={500} required value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="For example: I need casual leave next Monday for a family event" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
        <button disabled={loading || !prompt.trim()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"><Sparkles size={14} /> {loading ? 'Preparing…' : 'Prefill with AI'}</button>
      </form>
      {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>}
      {feedback && <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{feedback}</p>}

      <form onSubmit={submit} className="mt-5 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-2">
        <label className="text-xs font-semibold text-slate-700">Leave type<select required value={extracted?.leaveType || ''} onChange={(event) => setExtracted({ ...extracted, leaveType: event.target.value })} className={fieldClass}><option value="" disabled>Select type</option><option value="annual">Annual</option><option value="sick">Sick</option><option value="casual">Casual</option><option value="unpaid">Unpaid</option></select></label>
        <label className="text-xs font-semibold text-slate-700">Reason<input required maxLength={1000} value={extracted?.reason || ''} onChange={(event) => setExtracted({ ...extracted, reason: event.target.value })} placeholder="Briefly explain your request" className={fieldClass} /></label>
        <label className="text-xs font-semibold text-slate-700">First day<input type="date" required value={extracted?.startDate || ''} onChange={(event) => setExtracted({ ...extracted, startDate: event.target.value })} className={fieldClass} /></label>
        <label className="text-xs font-semibold text-slate-700">Last day<input type="date" required value={extracted?.endDate || ''} onChange={(event) => setExtracted({ ...extracted, endDate: event.target.value })} className={fieldClass} /></label>
        <button disabled={submitting} className="rounded-xl bg-slate-900 px-4 py-3 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50 sm:col-span-2">{submitting ? 'Sending request…' : 'Review & submit leave request'}</button>
      </form>
    </section>
  );
}
