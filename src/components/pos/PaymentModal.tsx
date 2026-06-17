'use client';

import { useState, useEffect } from 'react';
import { X, CreditCard, Banknote, Smartphone, Wallet, Plus, Trash2, ArrowLeftRight, CheckCircle2, Sparkles, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import type { Bill } from '@/lib/types';
import { useCartStore } from '@/store/cart';

interface Props {
  bill: Bill;
  currency: string;
  onClose: () => void;
  onPaid: () => void;
}

const methods = [
  { key: 'cash', label: 'Cash', icon: Banknote },
  { key: 'card', label: 'Card', icon: CreditCard },
  { key: 'upi', label: 'UPI', icon: Smartphone },
] as const;

interface Payment {
  method: string;
  amount: string;
}

export default function PaymentModal({ bill, currency, onClose, onPaid }: Props) {
  const remaining = Number(bill.balance);
  const cartCustomerId = useCartStore((s) => s.customerId);
  const cartCustomer = useCartStore((s) => s.customer);
  const effectiveCustomerId = bill.customer_id || cartCustomerId || null;
  const [payments, setPayments] = useState<Payment[]>([
    { method: 'cash', amount: remaining.toString() },
  ]);
  const [processing, setProcessing] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [walletAmount, setWalletAmount] = useState('');
  const [nextExpiry, setNextExpiry] = useState<string | null>(null);
  const [loyaltySettings, setLoyaltySettings] = useState<{
    loyalty_enabled: boolean;
    loyalty_points_per_rs: number;
    loyalty_redeem_value: number;
  } | null>(null);

  useEffect(() => {
    const custId = bill.customer_id || cartCustomerId;
    if (custId) {
      api.get(`/customers/${custId}/wallet`)
        .then((res) => {
          setWalletBalance(Number(res.data.balance) || 0);
          setNextExpiry(res.data.next_expiry || null);
        })
        .catch(() => setWalletBalance(0));
    }
    api.get('/settings/loyalty')
      .then((res) => setLoyaltySettings(res.data))
      .catch(() => {});
  }, [bill.customer_id, cartCustomerId]);

  const updatePayment = (idx: number, field: keyof Payment, value: string) => {
    setPayments(payments.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  };

  const addSplit = () => {
    const allocated = payments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
    const rest = Math.max(0, remaining - allocated);
    setPayments([...payments, { method: 'card', amount: rest.toFixed(2) }]);
  };

  const removeSplit = (idx: number) => {
    if (payments.length <= 1) return;
    setPayments(payments.filter((_, i) => i !== idx));
  };

  const walletAmt = parseFloat(walletAmount) || 0;
  const totalPayment = payments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0) + walletAmt;

  const hasCash = payments.some((p) => p.method === 'cash');
  const totalCashEntered = payments.filter((p) => p.method === 'cash').reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const change = hasCash && totalPayment > remaining + 0.009
    ? parseFloat((totalPayment - remaining).toFixed(2))
    : 0;

  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const handlePay = async () => {
    if (totalPayment < remaining - 0.01) {
      toast.error('Payment amount is less than balance');
      return;
    }
    if (walletAmt > 0 && walletBalance !== null && walletAmt > walletBalance) {
      toast.error('Wallet amount exceeds available balance');
      return;
    }
    setProcessing(true);
    try {
      let pointsEarned = 0;
      for (const p of payments) {
        const amt = parseFloat(p.amount);
        if (amt <= 0) continue;
        const res = await api.post(`/bills/${bill.id}/payment`, { amount: amt, method: p.method, customer_id: effectiveCustomerId });
        if (res.data?.loyaltyPointsEarned > 0) pointsEarned = res.data.loyaltyPointsEarned;
      }
      if (walletAmt > 0) {
        const res = await api.post(`/bills/${bill.id}/payment`, { amount: walletAmt, method: 'wallet', customer_id: effectiveCustomerId });
        if (res.data?.loyaltyPointsEarned > 0) pointsEarned = res.data.loyaltyPointsEarned;
      }
      if (pointsEarned > 0) {
        toast.success(`Payment recorded! ${pointsEarned} loyalty points credited.`);
      } else {
        toast.success('Payment recorded!');
      }
      onPaid();
    } catch {
      toast.error('Payment failed');
    } finally {
      setProcessing(false);
    }
  };

  const fmtExpiry = (d: string) => {
    try { return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return d; }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Payment</h2>
            <p className="text-xs text-gray-400 mt-0.5">Bill #{bill.bill_number}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[75vh] overflow-y-auto">

          {/* Amount + Customer Card */}
          <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl px-5 py-4 text-white">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-slate-400 uppercase tracking-widest">Total Due</p>
                <p className="text-4xl font-bold mt-1 tracking-tight">{currency}{fmt(remaining)}</p>
              </div>
              {cartCustomer && (
                <div className="text-right ml-4 shrink-0">
                  <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center mb-1 ml-auto">
                    <User size={16} className="text-white/70" />
                  </div>
                  <p className="text-sm font-semibold text-white leading-tight">{cartCustomer.name}</p>
                </div>
              )}
            </div>
          </div>

          {/* Loyalty Info Strip (staff reference) */}
          {loyaltySettings?.loyalty_enabled && effectiveCustomerId && (
            <div className="flex items-center gap-2 px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl">
              <Sparkles size={13} className="text-gray-400 shrink-0" />
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
                <span className="text-gray-700 font-medium">Loyalty</span>
                <span className="font-semibold text-gray-700">{walletBalance !== null ? walletBalance : '…'} pts</span>
                {nextExpiry && (
                  <span className="text-orange-500">Expires {fmtExpiry(nextExpiry)}</span>
                )}
              </div>
            </div>
          )}

          {payments.map((p, idx) => (
            <div key={idx} className="space-y-2 bg-gray-50 rounded-xl p-3">
              <div className="flex gap-1.5">
                {methods.map((m) => {
                  const Icon = m.icon;
                  return (
                    <button
                      key={m.key}
                      onClick={() => updatePayment(idx, 'method', m.key)}
                      className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                        p.method === m.key ? 'bg-brand text-white' : 'bg-white text-gray-600 border border-gray-200 hover:border-brand/40'
                      }`}
                    >
                      <Icon size={16} />
                      {m.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 text-sm">{currency}</span>
                <input
                  type="number"
                  value={p.amount}
                  onChange={(e) => updatePayment(idx, 'amount', e.target.value)}
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand"
                  step="0.01"
                  min="0"
                />
                {payments.length > 1 && (
                  <button onClick={() => removeSplit(idx)} className="text-red-400 hover:text-red-600">
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}

          <button
            onClick={addSplit}
            className="w-full py-2 text-sm border border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-brand hover:text-brand transition-colors flex items-center justify-center gap-1"
          >
            <Plus size={14} /> Split Payment
          </button>

          {/* Change Returned */}
          {hasCash && (
            <div className={`rounded-xl px-4 py-3 flex items-center justify-between border-2 transition-all duration-200 ${
              change > 0
                ? 'bg-emerald-50 border-emerald-200'
                : 'bg-gray-50 border-gray-200'
            }`}>
              <div className="flex items-center gap-2.5">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center ${
                  change > 0 ? 'bg-emerald-100' : 'bg-gray-200'
                }`}>
                  {change > 0
                    ? <CheckCircle2 size={15} className="text-emerald-600" />
                    : <ArrowLeftRight size={13} className="text-gray-400" />
                  }
                </div>
                <span className={`text-sm font-semibold ${
                  change > 0 ? 'text-emerald-800' : 'text-gray-400'
                }`}>
                  Change Returned
                </span>
              </div>
              <span className={`text-xl font-bold tabular-nums ${
                change > 0 ? 'text-emerald-600' : 'text-gray-300'
              }`}>
                {currency}{change > 0 ? fmt(change) : '0.00'}
              </span>
            </div>
          )}

          {bill.customer_id && walletBalance !== null && (
            <div className={`border rounded-xl p-3 space-y-2 ${walletBalance > 0 ? 'bg-purple-50 border-purple-200' : 'bg-gray-50 border-gray-200'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wallet size={16} className={walletBalance > 0 ? 'text-purple-600' : 'text-gray-400'} />
                  <span className={`text-sm font-medium ${walletBalance > 0 ? 'text-purple-900' : 'text-gray-500'}`}>Loyalty Wallet</span>
                </div>
                <span className={`text-sm font-semibold ${walletBalance > 0 ? 'text-purple-700' : 'text-gray-400'}`}>
                  {walletBalance > 0 ? `${currency}${walletBalance.toLocaleString()} available` : 'No balance'}
                </span>
              </div>
              {walletBalance > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 text-sm">{currency}</span>
                  <input
                    type="number"
                    value={walletAmount}
                    onChange={(e) => {
                      const v = e.target.value;
                      const max = Math.min(walletBalance, remaining);
                      const clamped = parseFloat(v) > max ? max.toFixed(2) : v;
                      setWalletAmount(clamped);
                      // Auto-reduce first payment so total stays at remaining
                      const walletUsed = parseFloat(clamped) || 0;
                      setPayments((prev) => prev.map((p, i) =>
                        i === 0 ? { ...p, amount: Math.max(0, remaining - walletUsed).toFixed(2) } : p
                      ));
                    }}
                    placeholder={`0 – ${Math.min(walletBalance, remaining).toFixed(2)}`}
                    className="flex-1 px-3 py-2 text-sm border border-purple-200 rounded-lg outline-none focus:ring-2 focus:ring-purple-400 bg-white"
                    step="0.01"
                    min="0"
                    max={Math.min(walletBalance, remaining)}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 pb-5 border-t border-gray-100 pt-3">
          <Button onClick={handlePay} disabled={processing || totalPayment < remaining - 0.01} className="w-full" size="lg">
            {processing ? 'Processing...' : `Pay ${currency}${fmt(totalPayment)}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
