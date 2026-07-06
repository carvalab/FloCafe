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
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null); // null = still checking

  const isPublicPath = PUBLIC_PATHS.some(p => pathname === p || pathname?.startsWith(p + '/'));

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  // Single effect: determine where to redirect after auth state + setup status are known
  useEffect(() => {
    if (loading) return; // wait for auth state to load
    if (isPublicPath) return; // don't redirect from public paths

    // If we don't know setup status yet, fetch it
    if (needsSetup === null) {
      api.get('/auth/setup/status')
        .then(({ data }) => {
          setNeedsSetup(data.needsSetup);
        })
        .catch((err) => {
          console.error('[AuthGuard] Failed to check setup status:', err);
          // On error, assume no setup needed — let login handle it
          setNeedsSetup(false);
        });
      return; // wait for the result before redirecting
    }

    // Auth loaded + setup status known + not on public path
    if (!user) {
      if (needsSetup) {
        router.push('/setup');
      } else {
        router.push('/auth/login');
      }
    } else if (!currentTenant) {
      router.push('/auth/login?select_tenant=true');
    }
  }, [loading, user, currentTenant, isPublicPath, needsSetup, router]);

  if (isPublicPath || needsSetup === true) {
    return <>{children}</>;
  }

  if (loading || needsSetup === null) {
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
