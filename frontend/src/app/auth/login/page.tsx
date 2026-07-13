'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getLandingPage } from '@/components/layout/AuthGuard';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import toast from 'react-hot-toast';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, selectTenant, user, tenants, currentTenant, loadFromStorage } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showTenantSelect, setShowTenantSelect] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/setup/status')
      .then(r => r.json())
      .then(data => {
        if (data.needsSetup) router.replace('/setup');
      })
      .catch(() => {});

    fetch('/api/health')
      .then(r => r.json())
      .then(data => {
        if (data.status !== 'ok') {
          setDbError(data.db || 'Database error — the app may not function correctly.');
        }
      })
      .catch(() => {});
  }, [router]);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    if (user && currentTenant) {
      router.push(getLandingPage(currentTenant.role));
    } else if (user && tenants.length === 1) {
      // Only one business — auto-select it
      handleTenantSelect(tenants[0].id);
    } else if (user && tenants.length > 1) {
      setShowTenantSelect(true);
    }
    if (searchParams.get('select_tenant') === 'true' && user) {
      setShowTenantSelect(true);
    }
  }, [user, tenants, currentTenant, router, searchParams, handleTenantSelect]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setLoginError(null);
    try {
      await login(email, password);
      toast.success('Login successful!');
    } catch (err: unknown) {
      const error = err as { response?: { status?: number; data?: { error?: string } } };
      if (error.response?.status === 401) {
        setLoginError('Invalid email or password');
      } else {
        const msg = error.response?.data?.error || 'Login failed — the database may have an error.';
        setDbError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleTenantSelect = async (tenantId: number) => {
    setLoading(true);
    try {
      await selectTenant(tenantId);
      // useEffect on currentTenant will handle the redirect
    } catch {
      toast.error('Failed to select business');
    } finally {
      setLoading(false);
    }
  };

  if (showTenantSelect) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-md">
          <Card>
            <CardContent className="pt-6">
              <h2 className="text-2xl font-bold mb-2">Select Business</h2>
              <p className="text-muted-foreground text-sm mb-6">Choose which business to manage</p>
              <div className="space-y-3">
                {tenants.map((tenant) => (
                  <button
                    key={tenant.id}
                    onClick={() => handleTenantSelect(tenant.id)}
                    disabled={loading}
                    className="w-full text-left p-4 border rounded-lg hover:border-primary hover:bg-accent transition-colors group"
                  >
                    <div className="font-semibold group-hover:text-primary">{tenant.business_name}</div>
                    <div className="text-sm text-muted-foreground mt-0.5">{tenant.business_type} &middot; {tenant.role}</div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="Flo" width={120} height={77} className="mx-auto mb-3" />
          <p className="text-muted-foreground mt-2">Sign in to manage your business</p>
        </div>
        {dbError && (
          <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <strong>Database error:</strong> {dbError}
          </div>
        )}
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" required />
              </div>
              {loginError && (
                <p className="text-sm text-destructive text-center">{loginError}</p>
              )}
              <Button type="submit" disabled={loading} className="w-full" size="lg">
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
