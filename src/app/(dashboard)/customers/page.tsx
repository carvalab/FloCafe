'use client';

import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import toast from 'react-hot-toast';
import { Plus, Search, X, Edit, Wallet, History, TrendingUp, TrendingDown } from 'lucide-react';
import type { Customer } from '@/lib/types';

export default function CustomersPage() {
  const { currentTenant } = useAuthStore();
  const currency = currentTenant?.currency === 'THB' ? '฿' : '₹';
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', country_code: '+91' });

  const [ledgerCustomer, setLedgerCustomer] = useState<Customer | null>(null);
  const [ledgerData, setLedgerData] = useState<{ balance: number; next_expiry: string | null; transactions: any[] } | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  const openLedger = async (c: Customer) => {
    setLedgerCustomer(c);
    setLedgerData(null);
    setLedgerLoading(true);
    try {
      const { data } = await api.get(`/customers/${c.id}/wallet`);
      setLedgerData(data);
    } catch {
      toast.error('Failed to load loyalty ledger');
    } finally {
      setLedgerLoading(false);
    }
  };

  const fmtDate = (d: string) => {
    try { return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return d; }
  };

  const fetchCustomers = async () => {
    try {
      const params = search ? { search } : {};
      const { data } = await api.get('/customers', { params });
      setCustomers(data.data || []);
    } catch {
      toast.error('Failed to load customers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCustomers(); }, [search]);

  const openAdd = () => {
    setEditingCustomer(null);
    setForm({ name: '', phone: '', email: '', country_code: '+91' });
    setShowForm(true);
  };

  const openEdit = (c: Customer) => {
    setEditingCustomer(c);
    setForm({ name: c.name, phone: c.phone || '', email: c.email || '', country_code: c.country_code || '+91' });
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingCustomer) {
        await api.put(`/customers/${editingCustomer.id}`, form);
        toast.success('Customer updated');
      } else {
        await api.post('/customers', form);
        toast.success('Customer added');
      }
      setShowForm(false);
      fetchCustomers();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save');
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
        <Button onClick={openAdd}><Plus size={16} className="mr-1" /> Add Customer</Button>
      </div>

      <div className="relative mb-4">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, phone, or email..."
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand outline-none"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-4 text-xs font-medium text-gray-500 uppercase">Customer</th>
              <th className="text-left p-4 text-xs font-medium text-gray-500 uppercase">Phone</th>
              <th className="text-center p-4 text-xs font-medium text-gray-500 uppercase">Visits</th>
              <th className="text-right p-4 text-xs font-medium text-gray-500 uppercase">Total Spent</th>
              <th className="text-right p-4 text-xs font-medium text-gray-500 uppercase">Loyalty</th>
              <th className="text-center p-4 text-xs font-medium text-gray-500 uppercase">Actions</th>
              <th className="text-center p-4 text-xs font-medium text-gray-500 uppercase">Ledger</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {customers.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="p-4">
                  <p className="font-medium text-gray-900">{c.name}</p>
                  <p className="text-xs text-gray-500">{c.email || '—'}</p>
                </td>
                <td className="p-4 text-sm text-gray-600">
                  {c.phone ? (c.country_code && !c.phone.startsWith(c.country_code) ? `${c.country_code}${c.phone}` : c.phone) : '—'}
                </td>
                <td className="p-4 text-center text-sm">{c.visits_count}</td>
                <td className="p-4 text-right font-medium">{currency}{Number(c.total_spent).toLocaleString()}</td>
                <td className="p-4 text-right">
                  {Number(c.wallet_balance) > 0 ? (
                    <span className="inline-flex items-center gap-1 text-purple-700 font-semibold text-sm">
                      <Wallet size={13} />
                      {Number(c.wallet_balance).toLocaleString()} pts
                    </span>
                  ) : (
                    <span className="text-gray-400 text-sm">—</span>
                  )}
                </td>
                <td className="p-4 text-center">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>
                    <Edit size={14} />
                  </Button>
                </td>
                <td className="p-4 text-center">
                  <Button variant="ghost" size="sm" onClick={() => openLedger(c)} title="View loyalty ledger">
                    <History size={14} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {customers.length === 0 && <p className="text-center text-gray-500 py-12">No customers found</p>}
      </div>

      {/* Loyalty Ledger Modal */}
      {ledgerCustomer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-xl">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Loyalty Ledger</h2>
                <p className="text-sm text-gray-500">{ledgerCustomer.name}</p>
              </div>
              <button onClick={() => setLedgerCustomer(null)} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200">
                <X size={16} className="text-gray-500" />
              </button>
            </div>

            {ledgerLoading ? (
              <div className="flex-1 flex items-center justify-center py-12 text-gray-400">Loading...</div>
            ) : ledgerData ? (
              <>
                {/* Summary row */}
                <div className="flex items-center gap-6 px-6 py-4 bg-gray-50 border-b border-gray-100">
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Total Balance</p>
                    <p className="text-2xl font-bold text-gray-900">{ledgerData.balance} <span className="text-sm font-normal text-gray-500">pts</span></p>
                  </div>
                  {ledgerData.next_expiry && (
                    <div>
                      <p className="text-xs text-gray-500 mb-0.5">Next Expiry</p>
                      <p className="text-sm font-semibold text-orange-500">{fmtDate(ledgerData.next_expiry)}</p>
                    </div>
                  )}
                </div>

                {/* Ledger table */}
                <div className="flex-1 overflow-y-auto">
                  {ledgerData.transactions.length === 0 ? (
                    <p className="text-center text-gray-400 py-12">No transactions yet</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Date</th>
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Description</th>
                          <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Points</th>
                          <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Expires</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {ledgerData.transactions.map((t: any) => (
                          <tr key={t.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtDate(t.created_at)}</td>
                            <td className="px-4 py-3 text-gray-700">{t.description || '—'}</td>
                            <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">
                              <span className={`inline-flex items-center gap-1 ${
                                t.type === 'credit' ? 'text-green-600' : 'text-red-500'
                              }`}>
                                {t.type === 'credit'
                                  ? <TrendingUp size={12} />
                                  : <TrendingDown size={12} />}
                                {t.type === 'credit' ? '+' : '-'}{t.amount}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right text-xs text-gray-400 whitespace-nowrap">
                              {t.expires_at ? fmtDate(t.expires_at) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">{editingCustomer ? 'Edit Customer' : 'Add Customer'}</h2>
              <button onClick={() => setShowForm(false)}><X size={20} className="text-gray-400" /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <input type="text" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-brand" required />
              <input type="tel" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-brand" required />
              <input type="email" placeholder="Email (optional)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-brand" />
              <Button type="submit" className="w-full">{editingCustomer ? 'Update' : 'Add'} Customer</Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}