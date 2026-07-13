'use client';

import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import toast from 'react-hot-toast';
import { Plus, X, Edit, RotateCcw } from 'lucide-react';
import type { Staff } from '@/lib/types';

const VALID_ROLES = ['owner', 'manager', 'cashier', 'waiter', 'chef'];

const roleLabels: Record<string, string> = {
  owner: 'Owner',
  manager: 'Manager',
  cashier: 'Cashier',
  waiter: 'Waiter',
  chef: 'Chef (KDS)',
};

const roleColors: Record<string, string> = {
  owner: 'bg-red-100 text-red-800',
  manager: 'bg-purple-100 text-purple-800',
  cashier: 'bg-blue-100 text-blue-800',
  waiter: 'bg-green-100 text-green-800',
  chef: 'bg-orange-100 text-orange-800',
};

export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [showResetPw, setShowResetPw] = useState(false);
  const [resetPwStaff, setResetPwStaff] = useState<Staff | null>(null);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'waiter',
    pin: '',
  });
  const [newPassword, setNewPassword] = useState('');

  const fetchStaff = async () => {
    try {
      const { data } = await api.get('/staff');
      setStaff(data.staff || []);
    } catch {
      toast.error('Failed to load staff');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStaff(); }, []);

  const openAdd = () => {
    setEditingStaff(null);
    setForm({ name: '', email: '', password: '', role: 'waiter', pin: '' });
    setShowForm(true);
  };

  const openEdit = (s: Staff) => {
    setEditingStaff(s);
    setForm({ name: s.name, email: s.email || '', password: '', role: s.role, pin: '' });
    setShowForm(true);
  };

  const openResetPw = (s: Staff) => {
    setResetPwStaff(s);
    setNewPassword('');
    setShowResetPw(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingStaff) {
        await api.put(`/staff/${editingStaff.id}`, {
          name: form.name,
          email: form.email || null,
          role: form.role,
          ...(form.password ? { password: form.password } : {}),
          ...(form.pin ? { pin: form.pin } : {}),
        });
        toast.success('Staff updated');
      } else {
        await api.post('/staff', {
          name: form.name,
          email: form.email || null,
          password: form.password,
          role: form.role,
          ...(form.pin ? { pin: form.pin } : {}),
        });
        toast.success('Staff added');
      }
      setShowForm(false);
      fetchStaff();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      toast.error(error.response?.data?.error || 'Failed to save');
    }
  };

  const handleResetPassword = async () => {
    if (!resetPwStaff || !newPassword) return;
    try {
      await api.put(`/staff/${resetPwStaff.id}`, { password: newPassword });
      toast.success('Password reset successfully');
      setShowResetPw(false);
    } catch {
      toast.error('Failed to reset password');
    }
  };

  const toggleActive = async (s: Staff) => {
    try {
      await api.post(`/staff/${s.id}/${s.is_active ? 'deactivate' : 'reactivate'}`);
      fetchStaff();
    } catch {
      toast.error('Failed to update');
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Staff</h1>
        <Button onClick={openAdd}><Plus size={16} className="mr-1" /> Add Staff</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {staff.map((s) => (
          <div key={s.id} className={`bg-white rounded-xl p-5 border ${s.is_active ? 'border-gray-100' : 'border-gray-200 opacity-60'}`}>
            <div className="flex justify-between items-start mb-3">
              <div>
                <p className="font-bold text-gray-900">{s.name}</p>
                <p className="text-xs text-gray-500">{s.email || '—'}</p>
                {s.pin_hash && (
                  <p className="text-xs text-green-600 mt-1">✓ PIN set</p>
                )}
              </div>
              <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${roleColors[s.role] || 'bg-gray-100 text-gray-800'}`}>
                {roleLabels[s.role] || s.role}
              </span>
            </div>
            <div className="flex gap-2 mt-3">
              <Button variant="outline" size="sm" onClick={() => openEdit(s)}>
                <Edit size={14} className="mr-1" /> Edit
              </Button>
              <Button variant="outline" size="sm" onClick={() => openResetPw(s)}>
                <RotateCcw size={14} className="mr-1" /> Reset PW
              </Button>
              <button
                onClick={() => toggleActive(s)}
                className={`text-xs font-medium px-2 py-1 ${s.is_active ? 'text-red-500 hover:text-red-700' : 'text-green-500 hover:text-green-700'}`}
              >
                {s.is_active ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {staff.length === 0 && <p className="text-center text-gray-500 py-12">No staff members yet</p>}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">{editingStaff ? 'Edit Staff' : 'Add Staff'}</h2>
              <button onClick={() => setShowForm(false)}><X size={20} className="text-gray-400" /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <input
                type="text" placeholder="Name" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-brand" required
              />
              <input
                type="email" placeholder="Email (optional)" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-brand"
              />
              <input
                type="password" placeholder={editingStaff ? 'New Password (leave empty to keep)' : 'Password'}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-brand"
                required={!editingStaff}
              />
              <div>
                <input
                  type="text" placeholder={editingStaff ? 'New PIN (leave empty to keep)' : 'PIN (4-6 digits)'}
                  value={form.pin}
                  onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                  className="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-brand"
                  maxLength={6}
                  pattern="[0-9]*"
                  inputMode="numeric"
                />
                <p className="text-xs text-gray-500 mt-1">Used for manager approvals (cancelling orders, etc.)</p>
              </div>
              <select
                value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-brand"
              >
                {VALID_ROLES.map((r) => (
                  <option key={r} value={r}>{roleLabels[r]}</option>
                ))}
              </select>
              <Button type="submit" className="w-full">{editingStaff ? 'Update' : 'Add'} Staff</Button>
            </form>
          </div>
        </div>
      )}

      {showResetPw && resetPwStaff && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">Reset Password</h2>
              <button onClick={() => setShowResetPw(false)}><X size={20} className="text-gray-400" /></button>
            </div>
            <p className="text-sm text-gray-600 mb-4">Reset password for <strong>{resetPwStaff.name}</strong></p>
            <div className="space-y-4">
              <input
                type="password" placeholder="New Password" value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-brand"
              />
              <Button onClick={handleResetPassword} className="w-full">Reset Password</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}