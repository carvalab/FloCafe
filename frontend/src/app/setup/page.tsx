'use client';

import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, ArrowRight, Check, Database, KeyRound, Sparkles, UtensilsCrossed } from 'lucide-react';
import toast from 'react-hot-toast';

type SetupProfile = 'empty' | 'express' | 'demo';
type ServiceModel = 'qsr' | 'finedine';

const SETUP_PROFILES: Array<{
  value: SetupProfile;
  label: string;
  badge?: string;
  description: string;
  details: string;
}> = [
  {
    value: 'empty',
    label: 'Empty',
    description: 'Owner account and required settings only.',
    details: 'Use this when the client wants to enter every product, table, and customer manually.',
  },
  {
    value: 'express',
    label: 'Express',
    badge: 'Recommended',
    description: 'Minimal ready-to-sell restaurant setup.',
    details: 'Seeds basic food and beverage categories, a few starter products, and tables for FineDine.',
  },
  {
    value: 'demo',
    label: 'Demo',
    description: 'Sample data for training and testing.',
    details: 'Seeds products, tables, sample customers, and staff users so the client can explore the system.',
  },
];

const SERVICE_MODELS: Array<{
  value: ServiceModel;
  label: string;
  description: string;
  details: string;
}> = [
  {
    value: 'qsr',
    label: 'QSR',
    description: 'Prepaid counter service',
    details: 'Best for quick-service restaurants where payment is taken before fulfilment.',
  },
  {
    value: 'finedine',
    label: 'FineDine',
    description: 'Table management and postpaid billing',
    details: 'Best for restaurants that seat guests, manage tables, and collect payment after service.',
  },
];

export default function SetupPage() {
  const { logout } = useAuthStore();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<SetupProfile>('express');
  const [serviceModel, setServiceModel] = useState<ServiceModel>('qsr');
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    business_name: '',
  });
  const [termsAccepted, setTermsAccepted] = useState(false);
  const passwordsEntered = form.password.length > 0 && form.confirmPassword.length > 0;
  const passwordsMatch = !passwordsEntered || form.password === form.confirmPassword;

  const [masterPinAvailable, setMasterPinAvailable] = useState<boolean | null>(null);
  const [masterPin, setMasterPin] = useState('');
  const [masterPinConfirm, setMasterPinConfirm] = useState('');
  const masterPinValid = /^\d{4}$/.test(masterPin) && masterPin === masterPinConfirm;

  useEffect(() => {
    api.get('/auth/setup/status')
      .then(({ data }) => setMasterPinAvailable(!!data.masterPinAvailable))
      .catch(() => setMasterPinAvailable(false));
  }, []);

  const completeSetup = () => {
    logout();
    toast.success('Setup complete');
    window.location.replace('/auth/login');
  };

  const validateOwner = () => {
    if (!form.name.trim() || !form.email.trim() || !form.password) {
      toast.error('Name, email, and password are required');
      return false;
    }
    if (form.password !== form.confirmPassword) {
      toast.error('Passwords do not match');
      return false;
    }
    if (!termsAccepted) {
      toast.error('You must agree to the Terms and Conditions, Privacy Policy, and No Warranty Disclaimer to continue');
      return false;
    }
    return true;
  };

  const handleOwnerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateOwner()) setStep(2);
  };

  const handleCompleteSetup = async () => {
    if (!validateOwner()) {
      setStep(1);
      return;
    }
    if (masterPinAvailable && !masterPinValid) {
      toast.error('Set a 4-digit Master PIN to continue');
      setStep(2);
      return;
    }

    setLoading(true);
    try {
      await api.post('/auth/setup/initialize', {
        name: form.name,
        email: form.email,
        password: form.password,
        business_type: 'restaurant',
        business_name: form.business_name || undefined,
        setup_profile: profile,
        service_model: serviceModel,
        terms_accepted: termsAccepted,
        master_pin: masterPinAvailable ? masterPin : undefined,
      });
      completeSetup();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      toast.error(error.response?.data?.error || 'Failed to complete setup');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted px-4 py-12">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="Flo" width={80} height={52} className="mx-auto mb-4" />
          <h1 className="text-3xl font-bold">Welcome to FloCafe</h1>
          <p className="text-muted-foreground mt-2">Create the owner account and choose the restaurant setup.</p>
        </div>

        <div className="flex justify-center gap-2 mb-8">
          {[1, 2, 3, 4].map((s) => (
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
                  <h2 className="text-xl font-semibold mb-2">Create Owner Account</h2>
                  <p className="text-muted-foreground text-sm">This first user gets full owner access on this POS.</p>
                </div>

                <form onSubmit={handleOwnerSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Owner Name</Label>
                    <Input
                      id="name"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Owner name"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Owner Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder="owner@restaurant.com"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="password">Password</Label>
                      <Input
                        id="password"
                        type="password"
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        placeholder="Enter password"
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
                  {passwordsEntered && (
                    <p className={`text-xs font-medium ${passwordsMatch ? 'text-green-600' : 'text-red-600'}`}>
                      {passwordsMatch ? 'Passwords match' : 'Passwords do not match'}
                    </p>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="business_name">Restaurant Name</Label>
                    <Input
                      id="business_name"
                      value={form.business_name}
                      onChange={(e) => setForm({ ...form, business_name: e.target.value })}
                      placeholder="Restaurant name"
                    />
                  </div>

                  <label className="flex items-start gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={termsAccepted}
                      onChange={(e) => setTermsAccepted(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300"
                      required
                    />
                    <span>
                      I agree to the FloPOS{' '}
                      <a href="https://flopos.com/terms" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                        Terms and Conditions
                      </a>
                      ,{' '}
                      <a href="https://flopos.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                        Privacy Policy
                      </a>
                      , and{' '}
                      <a href="https://flopos.com/disclaimer" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                        No Warranty Disclaimer
                      </a>
                      .
                    </span>
                  </label>

                  <Button type="submit" disabled={!passwordsMatch || !termsAccepted} className="w-full" size="lg">
                    Continue <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </form>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6">
                <button
                  onClick={() => setStep(1)}
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>

                <div className="text-center">
                  <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                    <KeyRound className="w-5 h-5 text-primary" />
                  </div>
                  <h2 className="text-xl font-semibold mb-2">Set Master PIN</h2>
                  <p className="text-muted-foreground text-sm">
                    A 4-digit PIN known only to you, required to back up, restore, or initialize this database — separate from your login password.
                    If you forget it, you can reset it later from Settings while logged in as owner.
                  </p>
                </div>

                {masterPinAvailable === false ? (
                  <p className="text-sm text-center text-muted-foreground bg-muted rounded-lg p-4">
                    Master PIN protection isn&apos;t available on this device. You can continue without it.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="master-pin">PIN</Label>
                      <Input
                        id="master-pin"
                        type="password"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={4}
                        value={masterPin}
                        onChange={(e) => setMasterPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        placeholder="••••"
                        className="text-center text-lg tracking-[0.5em]"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="master-pin-confirm">Confirm PIN</Label>
                      <Input
                        id="master-pin-confirm"
                        type="password"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={4}
                        value={masterPinConfirm}
                        onChange={(e) => setMasterPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        placeholder="••••"
                        className="text-center text-lg tracking-[0.5em]"
                      />
                    </div>
                  </div>
                )}

                <Button
                  onClick={() => setStep(3)}
                  disabled={masterPinAvailable === true && !masterPinValid}
                  className="w-full"
                  size="lg"
                >
                  Continue <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-6">
                <button
                  onClick={() => setStep(2)}
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>

                <div className="text-center">
                  <h2 className="text-xl font-semibold mb-2">Choose Setup Data</h2>
                  <p className="text-muted-foreground text-sm">Select how much data should be created on first launch.</p>
                </div>

                <div className="grid gap-4">
                  {SETUP_PROFILES.map((item) => {
                    const selected = profile === item.value;
                    const Icon = item.value === 'demo' ? Database : item.value === 'express' ? Sparkles : UtensilsCrossed;
                    return (
                      <button
                        key={item.value}
                        onClick={() => setProfile(item.value)}
                        className={`p-4 rounded-xl border-2 text-left transition-all ${
                          selected ? 'border-primary bg-primary/5' : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-start gap-4">
                          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
                            <Icon className="w-5 h-5 text-primary" />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">{item.label}</span>
                              {item.badge && (
                                <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                                  {item.badge}
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground mt-1">{item.description}</div>
                            <div className="text-xs text-muted-foreground mt-2">{item.details}</div>
                          </div>
                          {selected && <Check className="w-5 h-5 text-primary" />}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <Button onClick={() => setStep(4)} className="w-full" size="lg">
                  Continue <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-6">
                <button
                  onClick={() => setStep(3)}
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>

                <div className="text-center">
                  <h2 className="text-xl font-semibold mb-2">Choose Restaurant Flow</h2>
                  <p className="text-muted-foreground text-sm">FloCafe is restaurant-only. Pick the billing model for this outlet.</p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {SERVICE_MODELS.map((item) => {
                    const selected = serviceModel === item.value;
                    return (
                      <button
                        key={item.value}
                        onClick={() => setServiceModel(item.value)}
                        className={`p-5 rounded-xl border-2 text-left transition-all ${
                          selected ? 'border-primary bg-primary/5' : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold text-lg">{item.label}</div>
                            <div className="text-sm text-muted-foreground mt-1">{item.description}</div>
                            <div className="text-xs text-muted-foreground mt-3">{item.details}</div>
                          </div>
                          {selected && <Check className="w-5 h-5 text-primary shrink-0" />}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <Button onClick={handleCompleteSetup} disabled={loading} className="w-full" size="lg">
                  {loading ? 'Completing Setup...' : (
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
