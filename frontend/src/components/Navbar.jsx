'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, ChevronDown, Menu, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import API from '../lib/api';

const roleHomes = { Admin: '/admin', HR: '/hr', Employee: '/employee' };
const dashboardNames = { Admin: 'Admin workspace', HR: 'People operations', Employee: 'My workspace' };

export default function Navbar() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const isAuthPage = ['/login', '/setup', '/change-password'].includes(pathname);

  useEffect(() => {
    if (!user || isAuthPage) return;
    let active = true;
    API.get('/notifications')
      .then(({ data }) => {
        if (active) setUnread(data.filter((item) => !item.readAt).length);
      })
      .catch((error) => console.error('Unable to load notifications:', error));
    return () => { active = false; };
  }, [isAuthPage, pathname, user]);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-[68px] max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href={user ? roleHomes[user.role] || '/' : '/'} className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-700 text-base font-bold text-white shadow-md shadow-indigo-200">H</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold tracking-tight text-slate-950">HCM <span className="text-indigo-600">Lite</span></span>
            {user && <span className="hidden text-[11px] text-slate-500 sm:block">{dashboardNames[user.role] || user.role}</span>}
          </span>
        </Link>

        <div className="flex items-center gap-2 sm:gap-3">
          {user && !isAuthPage && (
            <>
              <span className="hidden max-w-48 truncate rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 md:inline">{user.email}</span>
              <button
                onClick={() => window.dispatchEvent(new Event('hcm:open-notifications'))}
                aria-label={`${unread} unread notifications`}
                className="relative grid h-10 w-10 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              >
                <Bell size={18} />
                {unread > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white" />}
              </button>
              <Link href="/change-password" className="hidden items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 sm:flex">
                Account <ChevronDown size={14} />
              </Link>
              <button onClick={logout} className="hidden rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 sm:block">
                Sign out
              </button>
              <button onClick={() => setMenuOpen((open) => !open)} aria-label={menuOpen ? 'Close menu' : 'Open menu'} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-600 sm:hidden">
                {menuOpen ? <X size={18} /> : <Menu size={18} />}
              </button>
            </>
          )}
          {!user && !isAuthPage && <Link href="/login" className="rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700">Sign in</Link>}
        </div>
      </div>
      {menuOpen && user && (
        <div className="border-t border-slate-100 bg-white px-4 py-3 shadow-lg sm:hidden">
          <p className="truncate px-3 pb-2 text-xs text-slate-500">{user.email}</p>
          <Link href={roleHomes[user.role] || '/'} onClick={() => setMenuOpen(false)} className="block rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Dashboard</Link>
          <Link href="/change-password" onClick={() => setMenuOpen(false)} className="block rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Change password</Link>
          <button onClick={logout} className="mt-1 block w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-rose-600 hover:bg-rose-50">Sign out</button>
        </div>
      )}
    </header>
  );
}
