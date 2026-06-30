'use client';

import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/button';
import { CreditCard, Trash2, RotateCcw, Clock, MessageCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import PaymentModal from '@/components/pos/PaymentModal';
import { shareBillViaWhatsApp } from '@/lib/whatsapp-share';
import type { Order, Bill } from '@/lib/types';
import { getCurrencySymbol } from '@/lib/countries';

const itemStatusConfig: Record<string, { icon: string; color: string; label: string }> = {
  pending: { icon: '⏳', color: 'text-yellow-600', label: 'Waiting' },
  preparing: { icon: '🔵', color: 'text-blue-600', label: 'Preparing' },
  ready: { icon: '🟢', color: 'text-green-600', label: 'Ready' },
  served: { icon: '✅', color: 'text-purple-600', label: 'Served' },
  cancelled: { icon: '❌', color: 'text-red-400', label: 'Cancelled' },
};

type FilterType = 'all' | 'active' | 'unpaid';

export default function OrdersPage() {
  const { currentTenant } = useAuthStore();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('active');
  const [paymentBill, setPaymentBill] = useState<Bill | null>(null);
  const [generatingBill, setGeneratingBill] = useState<number | null>(null);

  const currency = getCurrencySymbol(currentTenant?.currency || 'INR');

  const isOwnerOrManager = currentTenant?.role === 'owner' || currentTenant?.role === 'manager';

  const fetchOrders = async () => {
    try {
      const { data } = await api.get('/orders', { params: { per_page: 50 } });
      setOrders(data.orders || []);
    } catch {
      toast.error('Failed to load orders');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 15000);
    return () => clearInterval(interval);
  }, []);

  const isOrderPaid = (order: Order) => order.bill?.payment_status === 'paid';

  const getTimeSince = (dateStr: string) => {
    const minutes = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
  };

  const filteredOrders = orders.filter((order) => {
    if (filter === 'all') return true;
    if (filter === 'active') return !['completed', 'cancelled'].includes(order.status);
    if (filter === 'unpaid') return order.bill && order.bill.payment_status !== 'paid';
    return true;
  });

  const handleCheckout = async (orderId: number) => {
    setGeneratingBill(orderId);
    try {
      const { data } = await api.post('/bills/generate', { order_id: orderId });
      setPaymentBill(data.bill);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message || 'Failed to generate bill');
    } finally {
      setGeneratingBill(null);
    }
  };

  const handlePaymentComplete = () => {
    setPaymentBill(null);
    fetchOrders();
  };

  const deleteItem = async (orderId: number, itemId: number) => {
    if (!isOwnerOrManager) {
      toast.error('Only owners and managers can remove items');
      return;
    }
    if (!confirm('Remove this item?')) return;
    try {
      await api.patch(`/orders/${orderId}/items/${itemId}/cancel`, { reason: 'Removed by manager' });
      toast.success('Item removed');
      fetchOrders();
    } catch {
      toast.error('Failed to remove item');
    }
  };

  const restoreItem = async (orderId: number, itemId: number) => {
    if (!isOwnerOrManager) return;
    try {
      await api.patch(`/orders/${orderId}/items/${itemId}/restore`);
      toast.success('Item restored');
      fetchOrders();
    } catch {
      toast.error('Failed to restore item');
    }
  };

  const handleWhatsAppShare = (order: Order) => {
    if (!order.bill) {
      toast.error('Bill not found');
      return;
    }
    if (!order.customer?.phone) {
      toast.error('Customer phone number not available');
      return;
    }

    try {
      shareBillViaWhatsApp(
        order.bill,
        { phone: order.customer.phone, country_code: order.customer.country_code },
        { business_name: currentTenant?.business_name || 'Store', currency: currentTenant?.currency || 'INR' }
      );
    } catch {
      toast.error('Failed to open WhatsApp');
    }
  };

  const showCheckout = (order: Order) => {
    return !isOrderPaid(order) && !['completed', 'cancelled'].includes(order.status);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
        <div className="flex gap-2">
          {(['all', 'active', 'unpaid'] as FilterType[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize ${
                filter === f
                  ? 'bg-brand text-white'
                  : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-400'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Orders List */}
      {loading ? (
        <div className="flex items-center justify-center flex-1">
          <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="flex items-center justify-center flex-1 text-gray-400">
          <p>No orders found</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-4">
          {filteredOrders.map((order) => {
            const activeItems = (order.items || []).filter((i: any) => i.status !== 'cancelled');
            const cancelledItems = (order.items || []).filter((i: any) => i.status === 'cancelled');
            const paid = isOrderPaid(order);

            return (
              <div
                key={order.id}
                className="bg-white rounded-xl border border-gray-100 overflow-hidden"
              >
                {/* Order Header */}
                <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-gray-900">#{order.order_number}</span>
                    <span className="text-sm text-gray-500 capitalize">{order.type.replace('_', ' ')}</span>
                    {order.table && (
                      <span className="text-sm text-orange-600 font-medium">{order.table.name}</span>
                    )}
                    <span className="flex items-center gap-1 text-xs text-gray-400">
                      <Clock size={12} />
                      {getTimeSince(order.created_at)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {paid && (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Paid</span>
                    )}
                    {paid && order.customer?.phone && (
                      <button
                        onClick={() => handleWhatsAppShare(order)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-green-500 hover:bg-green-600 text-white text-xs font-medium transition-colors"
                        title="Share via WhatsApp"
                      >
                        <MessageCircle size={14} />
                        Share
                      </button>
                    )}
                    <span className="font-bold text-gray-900">{currency}{Number(order.total).toLocaleString()}</span>
                  </div>
                </div>

                {/* Items */}
                <div className="px-4 py-3">
                  <div className="space-y-2">
                    {activeItems.map((item: any) => {
                      const config = itemStatusConfig[item.status] || itemStatusConfig.pending;
                      return (
                        <div key={item.id} className="flex items-center justify-between py-1.5">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="text-xs" title={config.label}>{config.icon}</span>
                            <span className={`text-sm font-medium ${config.color}`}>
                              {item.quantity}x
                            </span>
                            <span className="text-sm text-gray-900 truncate">{item.product_name}</span>
                            {item.special_instructions && (
                              <span className="text-xs text-red-500 italic truncate">"{item.special_instructions}"</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-600">{currency}{Number(item.total).toLocaleString()}</span>
                            {item.status === 'pending' && isOwnerOrManager && !paid && (
                              <button
                                onClick={() => deleteItem(order.id, item.id)}
                                className="p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors"
                                title="Remove item"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Cancelled items */}
                  {cancelledItems.length > 0 && isOwnerOrManager && (
                    <div className="mt-2 pt-2 border-t border-gray-50">
                      {cancelledItems.map((item: any) => (
                        <div key={item.id} className="flex items-center justify-between py-1 opacity-50">
                          <div className="flex items-center gap-2">
                            <span className="text-xs">❌</span>
                            <span className="text-xs text-gray-400 line-through">
                              {item.quantity}x {item.product_name}
                            </span>
                          </div>
                          <button
                            onClick={() => restoreItem(order.id, item.id)}
                            className="p-1 rounded hover:bg-green-50 text-green-400 hover:text-green-600"
                            title="Restore"
                          >
                            <RotateCcw size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Footer with actions */}
                {showCheckout(order) && (
                  <div className="px-4 py-3 border-t border-gray-100 flex justify-end">
                    <Button
                      onClick={() => handleCheckout(order.id)}
                      disabled={generatingBill === order.id}
                      size="sm"
                    >
                      <CreditCard size={14} className="mr-1.5" />
                      {generatingBill === order.id ? 'Generating...' : 'Checkout'}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Payment Modal */}
      {paymentBill && (
        <PaymentModal
          bill={paymentBill}
          currency={currency}
          onClose={() => setPaymentBill(null)}
          onPaid={handlePaymentComplete}
        />
      )}
    </div>
  );
}
