'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Banknote, CreditCard, Smartphone, Sparkles, ArrowLeftRight, CheckCircle2, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { useCartStore } from '@/store/cart';
import { useTaxPreview } from '@/hooks/use-tax-preview';
import TaxBreakdown from '@/components/pos/TaxBreakdown';

interface LoyaltySettings {
  loyalty_enabled: boolean;
  loyalty_redemption_rate: number;
}

interface Props {
  currency: string;
  onClose: () => void;
  onConfirm: (method: string, amount: number) => void;
}

const PAYMENT_METHODS = [
  { key: 'cash', label: 'Cash', icon: Banknote, emoji: '💵' },
  { key: 'card', label: 'Card', icon: CreditCard, emoji: '💳' },
  { key: 'upi',  label: 'UPI',  icon: Smartphone, emoji: '📱' },
] as const;

export default function PrepaidCheckoutModal({ currency, onClose, onConfirm }: Props) {
  const cart = useCartStore();
  const total = cart.subtotal();
  const { tax, loading: taxLoading } = useTaxPreview(cart.items, cart.customerId);
  const displayTotal = tax ? tax.total : total;
  const customer = cart.customer;

  const [selectedMethod, setSelectedMethod] = useState<string>('cash');
  const [cashGiven, setCashGiven] = useState('');
  const [loyaltySettings, setLoyaltySettings] = useState<LoyaltySettings | null>(null);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [nextExpiry, setNextExpiry] = useState<string | null>(null);
  const cashInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get('/settings/loyalty')
      .then((res) => setLoyaltySettings(res.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (customer?.id) {
      api.get(`/customers/${customer.id}/wallet`)
        .then((res) => {
          setWalletBalance(Number(res.data.balance) || 0);
          setNextExpiry(res.data.next_expiry || null);
        })
        .catch(() => {});
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: resets wallet state when customer changes
      setWalletBalance(null);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: resets wallet state when customer changes
      setNextExpiry(null);
    }
  }, [customer?.id]);

  useEffect(() => {
    if (selectedMethod === 'cash') {
      setTimeout(() => cashInputRef.current?.focus(), 50);
    }
  }, [selectedMethod]);

  const cashGivenNum = parseFloat(cashGiven) || 0;
  const change = selectedMethod === 'cash' && cashGivenNum > displayTotal
    ? parseFloat((cashGivenNum - displayTotal).toFixed(2))
    : 0;
  const isCashValid = selectedMethod !== 'cash' || cashGivenNum >= displayTotal;

  const fmtExpiry = (d: string) => {
    try { return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return d; }
  };

  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Checkout</h2>
            <p className="text-xs text-gray-400 mt-0.5 capitalize">
              {cart.orderType.replace('_', '-')} order
            </p>
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
              <div className="flex-1">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-widest">
                  {taxLoading ? 'Subtotal' : 'Total Due'}
                </p>
                {taxLoading ? (
                  <div className="h-10 w-32 bg-white/10 rounded animate-pulse mt-1" />
                ) : (
                  <p className="text-4xl font-bold mt-1 tracking-tight">
                    {currency}{fmt(displayTotal)}
                  </p>
                )}
                <p className="text-xs text-slate-400 mt-1.5">
                  {cart.itemCount()} item{cart.itemCount() !== 1 ? 's' : ''}
                </p>
                {/* Tax breakdown */}
                {!taxLoading && tax && tax.tax_amount > 0 && (
                  <div className="mt-2 space-y-1">
                    <div className="flex justify-between text-xs text-slate-300">
                      <span>Subtotal</span>
                      <span>{currency}{fmt(tax.subtotal)}</span>
                    </div>
                    <TaxBreakdown
                      taxAmount={tax.tax_amount}
                      taxBreakdown={tax.tax_breakdown}
                      currency={currency}
                    />
                    {tax.round_off !== 0 && (
                      <div className="flex justify-between text-xs text-slate-300">
                        <span>Round off</span>
                        <span>{tax.round_off > 0 ? '+' : ''}{currency}{fmt(tax.round_off)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {customer && (
                <div className="text-right ml-4 shrink-0">
                  <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center mb-1 ml-auto">
                    <User size={16} className="text-white/70" />
                  </div>
                  <p className="text-sm font-semibold text-white leading-tight">{customer.name}</p>
                </div>
              )}
            </div>
          </div>

          {/* Loyalty Info Strip (staff reference) */}
          {loyaltySettings?.loyalty_enabled && customer && (
            <div className="flex items-center gap-2 px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl">
              <Sparkles size={13} className="text-gray-400 shrink-0" />
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
                <span className="text-gray-700 font-medium">Loyalty</span>
                <span className="font-semibold text-gray-700">
                  {walletBalance !== null
                    ? `${walletBalance} pts (≈ ${currency}${fmt(Math.floor(walletBalance / (loyaltySettings?.loyalty_redemption_rate || 100)))})`
                    : '…'}
                </span>
                {nextExpiry && (
                  <span className="text-orange-500">Expires {fmtExpiry(nextExpiry)}</span>
                )}
              </div>
            </div>
          )}

          {/* Payment Method */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-0.5">
              Payment Method
            </p>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.key}
                  onClick={() => setSelectedMethod(m.key)}
                  className={`relative flex flex-col items-center gap-1.5 py-3.5 rounded-xl border-2 transition-all duration-150 ${
                    selectedMethod === m.key
                      ? 'border-brand bg-brand/5 shadow-sm scale-[1.02]'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  {selectedMethod === m.key && (
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-brand" />
                  )}
                  <span className="text-xl">{m.emoji}</span>
                  <span className={`text-xs font-semibold ${
                    selectedMethod === m.key ? 'text-brand' : 'text-gray-600'
                  }`}>
                    {m.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Cash Given + Change Returned */}
          {selectedMethod === 'cash' && (
            <div className="space-y-3">
              {/* Cash Given Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-0.5">
                  Cash Given
                </label>
                <div
                  className={`flex items-center gap-2 border-2 rounded-xl px-3.5 py-2.5 transition-colors bg-white ${
                    cashGiven && !isCashValid
                      ? 'border-red-300 focus-within:border-red-400'
                      : 'border-gray-200 focus-within:border-brand'
                  }`}
                >
                  <span className="text-sm font-semibold text-gray-400">{currency}</span>
                  <input
                    ref={cashInputRef}
                    type="number"
                    value={cashGiven}
                    onChange={(e) => setCashGiven(e.target.value)}
                    placeholder={fmt(displayTotal)}
                    className="flex-1 text-base font-bold text-gray-900 outline-none bg-transparent placeholder:text-gray-300"
                    step="1"
                    min="0"
                  />
                  {cashGiven && (
                    <button
                      onClick={() => setCashGiven('')}
                      className="text-gray-300 hover:text-gray-500 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                {cashGiven && !isCashValid && (
                  <p className="text-xs text-red-500 px-0.5">
                    Cash given must be at least {currency}{fmt(displayTotal)}
                  </p>
                )}
              </div>

              {/* Change Returned */}
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
            </div>
          )}
        </div>

        {/* Pay Button */}
        <div className="px-5 pb-6 pt-3 border-t border-gray-100">
          <Button
            onClick={() => onConfirm(selectedMethod, displayTotal)}
            disabled={!isCashValid || taxLoading}
            className="w-full h-12 text-base font-semibold rounded-xl"
            size="lg"
          >
            {taxLoading ? 'Calculating tax...' : `Confirm Payment · ${currency}${fmt(displayTotal)}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
