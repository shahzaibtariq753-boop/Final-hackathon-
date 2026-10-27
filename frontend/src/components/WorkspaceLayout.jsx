'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCheck, Megaphone, Plus, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import API from '../lib/api';

export function WorkspaceLayout({ title, description, tabs, activeTab, onTabChange, actions, children }) {
  const { user } = useAuth();
  const [announcements, setAnnouncements] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [error, setError] = useState('');

  const loadNotices = useCallback(async () => {
    try {
      const [announcementResponse, notificationResponse] = await Promise.all([
        API.get('/announcements'),
        API.get('/notifications')
      ]);
      setAnnouncements(announcementResponse.data);
      setNotifications(notificationResponse.data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to load updates. Refresh the page to try again.');
    }
  }, []);

  useEffect(() => {
    if (user) loadNotices();
  }, [loadNotices, user]);

  useEffect(() => {
    const showNotices = () => setNoticeOpen(true);
    window.addEventListener('hcm:open-notifications', showNotices);
    return () => window.removeEventListener('hcm:open-notifications', showNotices);
  }, []);

  const markRead = async (id) => {
    try {
      const { data } = await API.patch(`/notifications/${id}/read`);
      setNotifications((items) => items.map((item) => item._id === id ? data : item));
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to mark this notification as read.');
    }
  };

  const unreadCount = notifications.filter((item) => !item.readAt).length;

  return (
    <main className="min-h-[calc(100vh-68px)] bg-[#f5f7fb]">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <section className="flex flex-col justify-between gap-5 rounded-3xl border border-slate-200/70 bg-white p-5 shadow-sm shadow-slate-200/40 sm:flex-row sm:items-end sm:p-7">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.12em] text-indigo-600">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" /> {user?.role} workspace
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">{title}</h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </section>

        {error && <div role="alert" className="flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X size={16} /></button></div>}

        {announcements.length > 0 && (
          <section className="flex gap-3 overflow-x-auto pb-1" aria-label="Company announcements">
            {announcements.slice(0, 3).map((announcement) => (
              <article key={announcement._id} className="min-w-[250px] flex-1 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4 sm:min-w-0">
                <p className="flex items-center gap-2 text-xs font-semibold text-indigo-700"><Megaphone size={14} /> Company update</p>
                <h2 className="mt-2 text-sm font-semibold text-slate-900">{announcement.title}</h2>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{announcement.message}</p>
              </article>
            ))}
          </section>
        )}

        <nav aria-label="Workspace sections" className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.id)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-semibold transition sm:px-4 ${
                  activeTab === tab.id ? 'bg-slate-900 text-white shadow-sm' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                <Icon size={15} /> {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0">{children}</div>
      </div>

      {noticeOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30" onClick={() => setNoticeOpen(false)}>
          <aside role="dialog" aria-modal="true" aria-label="Notifications" onClick={(event) => event.stopPropagation()} className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div><h2 className="font-semibold text-slate-950">Notifications</h2><p className="mt-0.5 text-xs text-slate-500">{unreadCount} unread updates</p></div>
              <div className="flex gap-2">
                <button onClick={loadNotices} aria-label="Refresh notifications" className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><CheckCheck size={17} /></button>
                <button onClick={() => setNoticeOpen(false)} aria-label="Close notifications" className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><X size={18} /></button>
              </div>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {notifications.length === 0 && <p className="rounded-2xl bg-slate-50 p-5 text-center text-sm text-slate-500">You’re all caught up. New updates will appear here.</p>}
              {notifications.map((notification) => (
                <article key={notification._id} className={`rounded-2xl border p-4 ${notification.readAt ? 'border-slate-100 bg-white' : 'border-indigo-100 bg-indigo-50/60'}`}>
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white text-indigo-600 ring-1 ring-indigo-100"><Bell size={15} /></span>
                    <div className="min-w-0 flex-1"><p className="text-sm leading-5 text-slate-800">{notification.message}</p><p className="mt-1 text-[11px] text-slate-500">{new Date(notification.createdAt).toLocaleString()}</p></div>
                    {!notification.readAt && <button onClick={() => markRead(notification._id)} className="shrink-0 text-[11px] font-semibold text-indigo-700 hover:underline">Mark read</button>}
                  </div>
                </article>
              ))}
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}

export function AnnouncementForm({ onPosted }) {
  const [form, setForm] = useState({ title: '', message: '', audience: 'all' });
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setFeedback('');
    try {
      await API.post('/announcements', form);
      setForm({ title: '', message: '', audience: 'all' });
      setFeedback('Your announcement has been published.');
      onPosted?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Unable to publish the announcement.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div><h2 className="font-semibold text-slate-950">Share an update</h2><p className="mt-1 text-xs leading-5 text-slate-500">Post a clear announcement for your team.</p></div>
      <label className="block text-xs font-semibold text-slate-700">Title<input required maxLength={160} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="mt-1.5 block w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></label>
      <label className="block text-xs font-semibold text-slate-700">Message<textarea required maxLength={4000} rows={4} value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} className="mt-1.5 block w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></label>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="text-xs font-semibold text-slate-700">Visible to<select value={form.audience} onChange={(event) => setForm({ ...form, audience: event.target.value })} className="ml-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs"><option value="all">Everyone</option><option value="HR">HR team</option><option value="Employee">Employees</option></select></label>
        <button disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"><Plus size={15} /> {loading ? 'Publishing…' : 'Publish update'}</button>
      </div>
      {feedback && <p role="status" className="text-xs text-emerald-700">{feedback}</p>}
      {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
    </form>
  );
}
