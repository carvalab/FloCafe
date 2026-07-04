'use client';

import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/button';
import { CreditCard, Trash2, RotateCcw, Clock, MessageCircle, Printer, XCircle, Lock, Star, Percent, DollarSign, Search, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import PaymentModal from '@/components/pos/PaymentModal';
import { shareBillViaWhatsApp } from '@/lib/whatsapp-share';
import type { OrderItem } from '@/lib/types';
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
  const [printingBillId, setPrintingBillId] = useState<number | null>(null);
  const [confirmPrintBillId, setConfirmPrintBillId] = useState<number | null>(null);
  const [cancellingOrderId, setCancellingOrderId] = useState<number | null>(null);
  const [cancelModalOrder, setCancelModalOrder] = useState<Order | null>(null);
  const [loyaltyEnabled, setLoyaltyEnabled] = useState<Record<number, boolean>>({});
  const [discountModalOrder, setDiscountModalOrder] = useState<Order | null>(null);
  const [discountType, setDiscountType] = useState<'percentage' | 'amount'>('percentage');
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [discountReason, setDiscountReason] = useState<string>('');
  const [addItemsOrder, setAddItemsOrder] = useState<Order | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTable, setFilterTable] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [tables, setTables] = useState<any[]>([]);

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

  useEffect(() => {
    const fetchTables = async () => {
      try {
        const { data } = await api.get('/tables');
        setTables(data.tables || []);
      } catch {
        // Ignore error
      }
    };
    fetchTables();
  }, []);

  const isOrderPaid = (order: Order) => order.bill?.payment_status === 'paid';

  const getTimeSince = (dateStr: string) => {
    const minutes = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
  };

  const filteredOrders = orders.filter((order) => {
    // Tab filter
    if (filter === 'active' && ['completed', 'cancelled'].includes(order.status)) return false;
    if (filter === 'unpaid' && !(order.bill && order.bill.payment_status !== 'paid')) return false;

    // Search by order number
    if (searchQuery && !order.order_number.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    // Filter by table
    if (filterTable && order.table_id !== filterTable) {
      return false;
    }
    // Filter by type
    if (filterType && order.type !== filterType) {
      return false;
    }
    // Filter by status
    if (filterStatus === 'active' && ['completed', 'cancelled'].includes(order.status)) {
      return false;
    }
    if (filterStatus === 'completed' && order.status !== 'completed') {
      return false;
    }
    if (filterStatus === 'cancelled' && order.status !== 'cancelled') {
      return false;
    }
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

  const handlePrint = async (billId: number) => {
    setPrintingBillId(billId);
    try {
      await api.post(`/bills/${billId}/print`, { print_type: 'receipt' });
      toast.success('Receipt printed successfully');
    } catch {
      toast.error('Failed to print receipt');
    } finally {
      setPrintingBillId(null);
      setConfirmPrintBillId(null);
    }
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

  const handleLoyaltyToggle = async (orderId: number, enabled: boolean) => {
    try {
      await api.patch(`/orders/${orderId}/loyalty`, { loyalty_enabled: enabled });
      setLoyaltyEnabled(prev => ({ ...prev, [orderId]: enabled }));
      toast.success(enabled ? 'Loyalty points enabled' : 'Loyalty points disabled');
    } catch {
      toast.error('Failed to update loyalty setting');
    }
  };

  const handleApplyDiscount = async () => {
    if (!discountModalOrder) return;

    try {
      await api.patch(`/orders/${discountModalOrder.id}/discount`, {
        discount_type: discountType,
        discount_value: discountValue,
        discount_reason: discountReason || undefined,
      });
      toast.success('Discount applied successfully');
      fetchOrders();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to apply discount');
    } finally {
      setDiscountModalOrder(null);
      setDiscountValue(0);
      setDiscountReason('');
    }
  };

  const showCheckout = (order: Order) => {
    return !isOrderPaid(order) && !['completed', 'cancelled'].includes(order.status);
  };

  const handleNewOrderForTable = (table: any) => {
    // Navigate to POS page with table pre-selected
    window.location.href = `/pos?table_id=${table.id}`;
  };

  const handleCancelOrder = async () => {
    if (!cancelModalOrder) return;

    const reason = (document.getElementById('cancelReason') as HTMLInputElement)?.value;
    const freeTable = (document.getElementById('freeTable') as HTMLInputElement)?.checked;
    const overridePin = (document.getElementById('overridePin') as HTMLInputElement)?.value;

    setCancellingOrderId(cancelModalOrder.id);
    try {
      await api.patch(`/orders/${cancelModalOrder.id}/status`, {
        status: 'cancelled',
        reason: reason || undefined,
        free_table: freeTable || false,
        override_pin: overridePin || undefined,
      });
      toast.success('Order cancelled successfully');
      fetchOrders();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to cancel order');
    } finally {
      setCancellingOrderId(null);
      setCancelModalOrder(null);
    }
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

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Search by order number */}
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by order number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand bg-white"
          />
        </div>

        {/* Table filter */}
        <select
          value={filterTable}
          onChange={(e) => setFilterTable(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        >
          <option value="">All Tables</option>
          {tables.map((table: any) => (
            <option key={table.id} value={String(table.id)}>
              {table.name}
            </option>
          ))}
        </select>

        {/* Type filter */}
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        >
          <option value="">All Types</option>
          <option value="dine_in">Dine In</option>
          <option value="takeaway">Takeaway</option>
          <option value="delivery">Delivery</option>
        </select>

        {/* Status filter */}
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
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
            const activeItems = (order.items || []).filter((i: OrderItem) => i.status !== 'cancelled');
            const cancelledItems = (order.items || []).filter((i: OrderItem) => i.status === 'cancelled');
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
                    {order.customer && (
                      <label className="flex items-center gap-1 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={loyaltyEnabled[order.id] ?? true}
                          onChange={(e) => handleLoyaltyToggle(order.id, e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 text-yellow-500 focus:ring-yellow-500"
                        />
                        <Star size={14} className="text-yellow-500 fill-yellow-500" />
                        <span className="text-xs text-gray-600 font-medium">Award points</span>
                      </label>
                    )}
                    <span className="font-bold text-gray-900">{currency}{Number(order.total).toLocaleString()}</span>
                  </div>
                </div>

                {/* Items */}
                <div className="px-4 py-3">
                  <div className="space-y-2">
                    {activeItems.map((item: OrderItem) => {
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
                              <span className="text-xs text-red-500 italic truncate">&quot;{item.special_instructions}&quot;</span>
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
                      {cancelledItems.map((item: OrderItem) => (
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
                {(showCheckout(order) || order.bill || !['completed', 'cancelled'].includes(order.status)) && (
                  <div className="px-4 py-3 border-t border-gray-100 flex justify-end gap-2">
                    {order.bill && (
                      <Button
                        variant="outline"
                        onClick={() => setConfirmPrintBillId(order.bill!.id)}
                        disabled={printingBillId === order.bill.id}
                        size="sm"
                      >
                        <Printer size={14} className="mr-1.5" />
                        {printingBillId === order.bill.id ? 'Printing...' : 'Print'}
                      </Button>
                    )}
                    {showCheckout(order) && (
                      <Button
                        onClick={() => handleCheckout(order.id)}
                        disabled={generatingBill === order.id}
                        size="sm"
                      >
                        <CreditCard size={14} className="mr-1.5" />
                        {generatingBill === order.id ? 'Generating...' : 'Checkout'}
                      </Button>
                    )}
                    {showCheckout(order) && (
                      <Button
                        variant="outline"
                        onClick={() => setDiscountModalOrder(order)}
                        size="sm"
                        className="border-purple-300 text-purple-600 hover:bg-purple-50 hover:text-purple-700"
                      >
                        <Percent size={14} className="mr-1.5" />
                        Discount
                      </Button>
                    )}
                    {!['completed', 'cancelled'].includes(order.status) && (
                      <Button
                        variant="outline"
                        onClick={() => setAddItemsOrder(order)}
                        size="sm"
                        className="border-green-300 text-green-600 hover:bg-green-50 hover:text-green-700"
                      >
                        <Plus size={14} className="mr-1.5" />
                        Add Item
                      </Button>
                    )}
                    {order.status === 'completed' && order.table && (
                      <Button
                        variant="outline"
                        onClick={() => handleNewOrderForTable(order.table)}
                        size="sm"
                        className="border-blue-300 text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                      >
                        <Plus size={14} className="mr-1.5" />
                        New Order
                      </Button>
                    )}
                    {!['completed', 'cancelled'].includes(order.status) && (
                      <Button
                        variant="outline"
                        onClick={() => setCancelModalOrder(order)}
                        disabled={cancellingOrderId === order.id}
                        size="sm"
                        className={
                          order.status === 'pending'
                            ? 'border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700'
                            : 'border-orange-300 text-orange-600 hover:bg-orange-50 hover:text-orange-700'
                        }
                      >
                        {order.status === 'pending' ? (
                          <XCircle size={14} className="mr-1.5" />
                        ) : (
                          <Lock size={14} className="mr-1.5" />
                        )}
                        {cancellingOrderId === order.id ? 'Cancelling...' : 'Cancel'}
                      </Button>
                    )}
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

      {/* Print Confirmation Modal */}
      {confirmPrintBillId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-lg font-bold text-gray-900 mb-2">Print Receipt</h2>
            <p className="text-sm text-gray-600 mb-6">Are you sure you want to print this receipt?</p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmPrintBillId(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => handlePrint(confirmPrintBillId)}
                disabled={printingBillId === confirmPrintBillId}
              >
                <Printer size={14} className="mr-1.5" />
                {printingBillId === confirmPrintBillId ? 'Printing...' : 'Confirm Print'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Order Modal */}
      {cancelModalOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Cancel Order #{cancelModalOrder.order_number}</h2>

            <div className="space-y-4">
              <div>
                <label htmlFor="cancelReason" className="block text-sm font-medium text-gray-700 mb-1">
                  Reason (optional)
                </label>
                <input
                  id="cancelReason"
                  type="text"
                  placeholder="Enter reason for cancellation"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>

              {cancelModalOrder.type === 'dine_in' && cancelModalOrder.table && (
                <div className="flex items-center gap-2">
                  <input
                    id="freeTable"
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                  />
                  <label htmlFor="freeTable" className="text-sm text-gray-700">
                    Free table {cancelModalOrder.table.name}
                  </label>
                </div>
              )}

              {cancelModalOrder.status !== 'pending' && (
                <div>
                  <label htmlFor="overridePin" className="block text-sm font-medium text-gray-700 mb-1">
                    Override PIN
                  </label>
                  <input
                    id="overridePin"
                    type="password"
                    placeholder="Enter manager PIN"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCancelModalOrder(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCancelOrder}
                disabled={cancellingOrderId === cancelModalOrder.id}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {cancellingOrderId === cancelModalOrder.id ? 'Cancelling...' : 'Confirm Cancel'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Discount Modal */}
      {discountModalOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Apply Discount - Order #{discountModalOrder.order_number}</h2>

            <div className="space-y-4">
              {/* Discount Type Toggle */}
              <div className="flex rounded-lg overflow-hidden border border-gray-200">
                <button
                  onClick={() => { setDiscountType('percentage'); setDiscountValue(0); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium transition-colors ${
                    discountType === 'percentage'
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <Percent size={14} />
                  Percentage
                </button>
                <button
                  onClick={() => { setDiscountType('amount'); setDiscountValue(0); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium transition-colors ${
                    discountType === 'amount'
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <DollarSign size={14} />
                  Amount
                </button>
              </div>

              {/* Discount Value */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {discountType === 'percentage' ? 'Discount Percentage' : 'Discount Amount'}
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                    {discountType === 'percentage' ? '%' : currency}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={discountType === 'percentage' ? 100 : Number(discountModalOrder.total)}
                    step={discountType === 'percentage' ? 1 : 0.01}
                    value={discountValue || ''}
                    onChange={(e) => setDiscountValue(Number(e.target.value))}
                    placeholder={discountType === 'percentage' ? '0' : '0.00'}
                    className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* Discount Reason */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reason (optional)
                </label>
                <input
                  type="text"
                  value={discountReason}
                  onChange={(e) => setDiscountReason(e.target.value)}
                  placeholder="Enter reason for discount"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>

              {/* Preview */}
              <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Subtotal</span>
                  <span className="text-gray-900">{currency}{Number(discountModalOrder.total).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-purple-600">
                    Discount
                    {discountType === 'percentage' && discountValue > 0 && (
                      <span className="text-gray-400 ml-1">({discountValue}%)</span>
                    )}
                  </span>
                  <span className="text-purple-600">
                    -{currency}{
                      discountType === 'percentage'
                        ? (Number(discountModalOrder.total) * discountValue / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : Number(discountValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    }
                  </span>
                </div>
                <div className="border-t border-gray-200 pt-1.5 flex justify-between text-sm font-bold">
                  <span className="text-gray-900">New Total</span>
                  <span className="text-gray-900">
                    {currency}{
                      discountType === 'percentage'
                        ? (Number(discountModalOrder.total) * (1 - discountValue / 100)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : (Number(discountModalOrder.total) - discountValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    }
                  </span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDiscountModalOrder(null);
                  setDiscountValue(0);
                  setDiscountReason('');
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleApplyDiscount}
                disabled={discountValue <= 0}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                <Percent size={14} className="mr-1.5" />
                Apply Discount
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
