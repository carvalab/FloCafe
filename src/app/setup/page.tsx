'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { ShoppingCart, UtensilsCrossed, Scissors, Sparkles, ArrowRight, ArrowLeft, Check } from 'lucide-react';
import toast from 'react-hot-toast';

const BUSINESS_TYPES = [
  {
    type: 'retail',
    label: 'Retail Store',
    description: 'For shops selling physical products',
    icon: ShoppingCart,
    color: 'bg-blue-500',
  },
  {
    type: 'restaurant',
    label: 'Restaurant',
    description: 'For food service with table & order management',
    icon: UtensilsCrossed,
    color: 'bg-orange-500',
  },
  {
    type: 'salon',
    label: 'Salon & Spa',
    description: 'For beauty and wellness services',
    icon: Scissors,
    color: 'bg-pink-500',
  },
];

export default function SetupPage() {
  const router = useRouter();
  const { login, loadFromStorage } = useAuthStore();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [setupMode, setSetupMode] = useState<'fresh' | 'demo' | null>(null);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    business_name: '',
    business_type: 'retail' as 'retail' | 'restaurant' | 'salon',
  });

  const handleStartFresh = () => {
    setSetupMode('fresh');
    setStep(2);
  };

  const handleUseDemo = () => {
    setSetupMode('demo');
    setStep(3);
  };

  const completeSetup = (data: { access_token: string; tenant: Record<string, unknown> }) => {
    localStorage.setItem('token', data.access_token);
    localStorage.setItem('tenant', JSON.stringify(data.tenant));
    loadFromStorage();
    toast.success(setupMode === 'fresh' ? 'Account created successfully!' : 'Demo data loaded!');
    router.push('/pos');
  };

  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (form.password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/setup/initialize', {
        name: form.name,
        email: form.email,
        password: form.password,
        business_type: form.business_type,
        business_name: form.business_name || undefined,
      });
      completeSetup(data);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      toast.error(error.response?.data?.error || 'Failed to create account');
    } finally {
      setLoading(false);
    }
  };

  const handleBusinessTypeSubmit = async () => {
    setLoading(true);
    try {
      if (setupMode === 'fresh') {
        const { data } = await api.post('/auth/setup/initialize', {
          name: form.name,
          email: form.email,
          password: form.password,
          business_type: form.business_type,
          business_name: form.business_name || undefined,
        });
        completeSetup(data);
      } else {
        await api.post('/auth/setup/seed', {
          business_type: form.business_type,
          business_name: form.business_name || 'Demo Store',
          password: 'admin123',
        });
        await login('admin@flo.local', 'admin123');
        toast.success('Demo data loaded!');
        router.push('/pos');
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      toast.error(error.response?.data?.error || 'Failed to complete setup');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted px-4 py-12">
      <div className="w-full max-w-xl">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="Flo" width={80} height={52} className="mx-auto mb-4" />
          <h1 className="text-3xl font-bold">Welcome to Flo</h1>
          <p className="text-muted-foreground mt-2">Let&apos;s get you set up in a few steps</p>
        </div>

        <div className="flex justify-center gap-2 mb-8">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`w-3 h-3 rounded-full transition-colors ${
                s === step ? 'bg-primary' : s < step ? 'bg-primary/50' : 'bg-muted'
              }`}
            />
          ))}
        </div>

        <Card>
          <CardContent className="pt-6">
            {step === 1 && (
              <div className="space-y-6">
                <div className="text-center">
                  <h2 className="text-xl font-semibold mb-2">How would you like to start?</h2>
                  <p className="text-muted-foreground text-sm">Choose how to set up your store</p>
                </div>

                <div className="grid gap-4">
                  <button
                    onClick={handleStartFresh}
                    className="flex items-center gap-4 p-4 border-2 border-gray-200 rounded-xl hover:border-primary hover:bg-primary/5 transition-all text-left group"
                  >
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                      <Sparkles className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <div className="font-semibold">Start Fresh</div>
                      <div className="text-sm text-muted-foreground">Create your account and add your own products</div>
                    </div>
                    <ArrowRight className="w-5 h-5 ml-auto text-muted-foreground" />
                  </button>

                  <button
                    onClick={handleUseDemo}
                    className="flex items-center gap-4 p-4 border-2 border-gray-200 rounded-xl hover:border-primary hover:bg-primary/5 transition-all text-left group"
                  >
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                      <Check className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <div className="font-semibold">Load Demo Data</div>
                      <div className="text-sm text-muted-foreground">Get started quickly with sample products and settings</div>
                    </div>
                    <ArrowRight className="w-5 h-5 ml-auto text-muted-foreground" />
                  </button>
                </div>
              </div>
            )}

            {step === 2 && setupMode === 'fresh' && (
              <div className="space-y-6">
                <button
                  onClick={() => setStep(1)}
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>

                <div className="text-center">
                  <h2 className="text-xl font-semibold mb-2">Create Admin Account</h2>
                  <p className="text-muted-foreground text-sm">This account will have full access to your store</p>
                </div>

                <form onSubmit={handleAdminSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Your Name</Label>
                    <Input
                      id="name"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="John Doe"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder="john@store.com"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="password">Password</Label>
                      <Input
                        id="password"
                        type="password"
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        placeholder="Min 8 characters"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="confirmPassword">Confirm Password</Label>
                      <Input
                        id="confirmPassword"
                        type="password"
                        value={form.confirmPassword}
                        onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                        placeholder="Re-enter password"
                        required
                      />
                    </div>
                  </div>

                  <Button type="submit" disabled={loading} className="w-full" size="lg">
                    {loading ? 'Creating Account...' : 'Continue'}
                  </Button>
                </form>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-6">
                {setupMode === 'fresh' && (
                  <button
                    onClick={() => setStep(2)}
                    className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" /> Back
                  </button>
                )}

                <div className="text-center">
                  <h2 className="text-xl font-semibold mb-2">What type of store are you setting up?</h2>
                  <p className="text-muted-foreground text-sm">This helps us customize the experience for you</p>
                </div>

                <div className="space-y-3">
                  {BUSINESS_TYPES.map((bt) => {
                    const Icon = bt.icon;
                    const isSelected = form.business_type === bt.type;
                    return (
                      <button
                        key={bt.type}
                        onClick={() => setForm({ ...form, business_type: bt.type as 'retail' | 'restaurant' | 'salon' })}
                        className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left ${
                          isSelected ? 'border-primary bg-primary/5' : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className={`w-12 h-12 rounded-xl ${bt.color} flex items-center justify-center`}>
                          <Icon className="w-6 h-6 text-white" />
                        </div>
                        <div className="flex-1">
                          <div className="font-semibold">{bt.label}</div>
                          <div className="text-sm text-muted-foreground">{bt.description}</div>
                        </div>
                        {isSelected && <Check className="w-5 h-5 text-primary" />}
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="business_name">Store Name (optional)</Label>
                  <Input
                    id="business_name"
                    value={form.business_name}
                    onChange={(e) => setForm({ ...form, business_name: e.target.value })}
                    placeholder="My Awesome Store"
                  />
                </div>

                <Button
                  onClick={handleBusinessTypeSubmit}
                  disabled={loading}
                  className="w-full"
                  size="lg"
                >
                  {loading ? (
                    setupMode === 'fresh' ? 'Creating Account...' : 'Loading Demo Data...'
                  ) : (
                    <>
                      Complete Setup <ArrowRight className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
