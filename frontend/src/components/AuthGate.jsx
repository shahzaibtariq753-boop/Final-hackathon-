'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../context/AuthContext';

export default function AuthGate({ roles, children }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (user.mustChangePassword && pathname !== '/change-password') {
      router.replace('/change-password');
      return;
    }
    if (roles && !roles.includes(user.role)) router.replace(roleHomes[user.role] || '/login');
  }, [loading, pathname, roles, router, user]);

  if (loading || !user || (user.mustChangePassword && pathname !== '/change-password') || (roles && !roles.includes(user.role))) {
    return <main className="grid min-h-[60vh] place-items-center"><p className="text-sm text-slate-500">Preparing your workspace…</p></main>;
  }

  return children;
}
