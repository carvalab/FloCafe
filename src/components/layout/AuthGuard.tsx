'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import api from '@/lib/api';

export function getLandingPage(role?: string, businessType?: string): string {
  return '/pos';
}

const PUBLIC_PATHS = ['/kds', '/auth/login', '/auth/register', '/setup'];

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, currentTenant, loading, loadFromStorage } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();
  const [needsSetup, setNeedsSetup] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(true);

  const isPublicPath = PUBLIC_PATHS.some(p => pathname === p || pathname?.startsWith(p + '/'));

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    if (!isPublicPath && !loading && !user) {
      api.get('/auth/setup/status')
        .then(({ data }) => {
          if (data.needsSetup) {
            setNeedsSetup(true);
            router.push('/setup');
          }
        })
        .catch(() => {})
        .finally(() => setCheckingSetup(false));
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: transitions auth state machine from checking to ready
      setCheckingSetup(false);
    }
  }, [isPublicPath, loading, user, router]);

  useEffect(() => {
    if (isPublicPath) return;
    if (!checkingSetup && !loading) {
      if (!user) {
        if (!needsSetup) {
          router.push('/auth/login');
        }
      } else if (!currentTenant) {
        router.push('/auth/login?select_tenant=true');
      }
    }
  }, [user, currentTenant, loading, router, pathname, isPublicPath, checkingSetup, needsSetup]);

  if (isPublicPath || needsSetup) {
    return <>{children}</>;
  }

  if (loading || checkingSetup) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-brand border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-500 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user || !currentTenant) return null;

  return <>{children}</>;
}
