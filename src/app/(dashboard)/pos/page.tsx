'use client';

import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useCartStore } from '@/store/cart';
import { useHeldOrdersStore } from '@/store/held-orders';
import { usePosSettingsStore } from '@/store/pos-settings';
import toast from 'react-hot-toast';
import { ShoppingCart, X, Menu } from 'lucide-react';
import type { Addon, Category, Product, Table, Bill, Order } from '@/lib/types';
import {
  Drawer, DrawerContent, DrawerTrigger,
} from '@/components/ui/drawer';

import ProductGrid from '@/components/pos/ProductGrid';
import CartPanel from '@/components/pos/CartPanel';
import AddonModal from '@/components/pos/AddonModal';
import CustomerSearch from '@/components/pos/CustomerSearch';
import TablePickerModal from '@/components/pos/TablePickerModal';
import TableCheckoutModal from '@/components/pos/TableCheckoutModal';
import PaymentModal from '@/components/pos/PaymentModal';
import PosTopbar from '@/components/pos/PosTopbar';
import { usePrinterStore } from '@/hooks/usePrinter';

export default function POSPage() {
  const { currentTenant } = useAuthStore();
  const isRestaurant = (currentTenant?.business_type ?? 'restaurant') === 'restaurant';
  const cart = useCartStore();
  const heldOrders = useHeldOrdersStore();
  const { customerMandatory, autoPrintKot, billingType } = usePosSettingsStore();

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  // Modal state
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [addonProduct, setAddonProduct] = useState<Product | null>(null);
  const [checkoutTable, setCheckoutTable] = useState<Table | null>(null);
  const [paymentBill, setPaymentBill] = useState<Bill | null>(null);
  const [showCustomerPrompt, setShowCustomerPrompt] = useState(false);
  const [showPrepaidCheckout, setShowPrepaidCheckout] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const currency = currentTenant?.currency === 'THB' ? '฿' : '₹';
  const { printBill, printKot } = usePrinterStore();

  const refreshTables = async () => {
    if (!isRestaurant) return;
    try {
      const { data } = await api.get('/tables?active=1');
      setTables(data.tables || []);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const requests: Promise<{ data: Record<string, unknown> }>[] = [
          api.get('/categories?active=1'),
          api.get('/products?active=1'),
        ];
        if (isRestaurant) requests.push(api.get('/tables?active=1'));
        const [catRes, prodRes, tableRes] = await Promise.all(requests);
        setCategories((catRes.data.categories as Category[]) || []);
        setProducts((prodRes.data.products as Product[]) || []);
        if (tableRes) setTables((tableRes.data.tables as Table[]) || []);
      } catch {
        toast.error('Failed to load menu data');
      }
    };
    fetchData();
  }, [isRestaurant]);

  const handleProductClick = (product: Product) => {
    if (product.addon_groups && product.addon_groups.length > 0) {
      setAddonProduct(product);
    } else {
      cart.addItem(product);
    }
  };

  const handleAddonAdd = (product: Product, quantity: number, addons: Addon[], instructions: string) => {
    cart.addItem(product, quantity, addons, instructions);
  };

  const handlePlaceOrder = async () => {
    if (cart.items.length === 0) {
      toast.error('Cart is empty');
      return;
    }
    if (customerMandatory && !cart.customerId) {
      setShowCustomerPrompt(true);
      return;
    }
    if (isRestaurant && cart.orderType === 'dine_in' && !cart.tableId) {
      setShowTablePicker(true);
      return;
    }

    // Takeaway / delivery / online → collect payment immediately
    if (cart.orderType !== 'dine_in') {
      setShowPrepaidCheckout(true);
      return;
    }

    // Dine-in → place order, kitchen gets the ticket, payment collected later
    setSubmitting(true);
    try {
      const { data } = await api.post('/orders', {
        table_id: cart.tableId,
        customer_id: cart.customerId,
        type: cart.orderType,
        guest_count: cart.guestCount,
        items: cart.items.map((item) => ({
          product_id: item.product.id,
          quantity: item.quantity,
          addons: item.addons.length > 0
            ? item.addons.map((a) => ({ id: a.id, name: a.name, price: a.price }))
            : null,
          special_instructions: item.special_instructions || null,
        })),
      });

      toast.success(`Order #${data.order.order_number} placed!`);
      if (cart.tableId) heldOrders.removeHeldOrder(cart.tableId);
      cart.clearCart();
      setMobileCartOpen(false);
      await refreshTables();

      if (autoPrintKot) {
        try {
          await printKot(data.order as Order);
        } catch (err) {
          console.error('[POS] KOT print failed:', err);
          const msg = err instanceof Error ? err.message : 'check printer connection';
          toast.error(`KOT print failed: ${msg}`);
        }
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string; error?: string } } };
      toast.error(error.response?.data?.message || error.response?.data?.error || 'Failed to place order');
    } finally {
      setSubmitting(false);
    }
  };

  // Handle prepaid checkout - place order and pay in one step
  const handlePrepaidCheckout = async (method: string, amount: number) => {
    setShowPrepaidCheckout(false);
    setSubmitting(true);
    try {
      // Step 1: Create the order
      const { data: orderData } = await api.post('/orders', {
        table_id: cart.tableId,
        customer_id: cart.customerId,
        type: cart.orderType,
        guest_count: cart.guestCount,
        items: cart.items.map((item) => ({
          product_id: item.product.id,
          quantity: item.quantity,
          addons: item.addons.length > 0
            ? item.addons.map((a) => ({ id: a.id, name: a.name, price: a.price }))
            : null,
          special_instructions: item.special_instructions || null,
        })),
      });

      // Step 2: Generate bill
      const { data: billData } = await api.post('/bills/generate', { order_id: orderData.order.id });

      // Step 3: Record payment
      await api.post(`/bills/${billData.bill.id}/payment`, { amount, method });

      toast.success(`Order #${orderData.order.order_number} paid!`);
      if (cart.tableId) heldOrders.removeHeldOrder(cart.tableId);
      cart.clearCart();
      setMobileCartOpen(false);
      await refreshTables();

      if (autoPrintKot) {
        try {
          await printKot(orderData.order as Order);
        } catch (err) {
          console.error('[POS] KOT print failed:', err);
          const msg = err instanceof Error ? err.message : 'check printer connection';
          toast.error(`KOT print failed: ${msg}`);
        }
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string; error?: string } } };
      toast.error(error.response?.data?.message || error.response?.data?.error || 'Failed to process order');
    } finally {
      setSubmitting(false);
    }
  };


  const handleSelectAvailableTable = (tableId: number, customer?: { id: number; name: string; phone: string } | null) => {
    cart.setTableId(tableId);
    if (customer) {
      cart.setCustomer({ ...customer, email: null, visits_count: 0, total_spent: 0, last_visit_at: null, country_code: '' });
    }
    setShowTablePicker(false);
  };

  const handleSelectOccupiedTable = (table: Table) => {
    setShowTablePicker(false);
    setCheckoutTable(table);
  };

  const handleSelectHeldTable = (tableId: number) => {
    const held = heldOrders.restoreOrder(tableId);
    if (held) {
      cart.loadItems(held.items, tableId, held.customerId, held.guestCount);
      cart.setOrderType('dine_in');
    }
    setShowTablePicker(false);
  };

  const handleAddItemsToOrder = (table: Table, order: Order) => {
    setCheckoutTable(null);
    cart.setTableId(table.id);
    cart.setOrderType('dine_in');
    toast(`Adding items to order #${order.order_number}. Place order when ready.`, { icon: 'ℹ️' });
  };

  // Add cart items directly to existing order
  const handleAddCartToOrder = async (table: Table, order: Order) => {
    if (cart.items.length === 0) {
      toast.error('Cart is empty');
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/orders/${order.id}/items`, {
        items: cart.items.map((item) => ({
          product_id: item.product.id,
          quantity: item.quantity,
          addons: item.addons.length > 0
            ? item.addons.map((a) => ({ id: a.id, name: a.name, price: a.price }))
            : null,
          special_instructions: item.special_instructions || null,
        })),
      });
      toast.success(`Items added to order #${order.order_number}`);
      cart.clearCart();
      setCheckoutTable(null);
      refreshTables();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message || 'Failed to add items');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePaymentComplete = async () => {
    const bill = paymentBill; // capture before clearing state
    setPaymentBill(null);
    setCheckoutTable(null);
    refreshTables();

    if (bill && currentTenant) {
      try {
        await printBill(bill, {
          business_name: currentTenant.business_name,
          currency,
        });
      } catch {
        // Non-fatal: print failure should not block the checkout flow.
        toast.error('Receipt print failed — check printer connection');
      }
    }
  };

  const cartPanelProps = {
    tables,
    currency,
    submitting,
    onPlaceOrder: handlePlaceOrder,
    onShowTablePicker: () => setShowTablePicker(true),
  };

  const itemCount = cart.itemCount();

  return (
    <>
    <PosTopbar />

    {/* Main content area */}
    <div className="flex flex-1 min-h-0 overflow-hidden p-4 gap-4">
      {/* Sidebar toggle button - only visible on desktop */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="hidden md:flex md:items-center md:justify-center w-8 h-8 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-gray-50 transition-colors shrink-0"
        title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
      >
        {sidebarOpen ? <X size={16} className="text-gray-600" /> : <Menu size={16} className="text-gray-600" />}
      </button>
      
      {/* Product Grid — full width on mobile, flex-1 on desktop */}
      <div className="flex-1 min-w-0 h-full flex flex-col">
        <ProductGrid
          categories={categories}
          products={products}
          selectedCategory={selectedCategory}
          setSelectedCategory={setSelectedCategory}
          search={search}
          setSearch={setSearch}
          currency={currency}
          onProductClick={handleProductClick}
          sidebarOpen={sidebarOpen}
        />
      </div>

      {/* Desktop Cart — hidden on mobile or when sidebar is closed */}
      {sidebarOpen && (
        <div className="hidden md:flex md:w-80 md:shrink-0 h-full">
          <CartPanel {...cartPanelProps} />
        </div>
      )}
    </div>

    {/* Mobile: Floating Cart Button + Bottom Sheet — outside flex container */}
    <Drawer open={mobileCartOpen} onOpenChange={setMobileCartOpen}>
      <DrawerTrigger asChild>
        <button className="fixed bottom-5 right-5 z-40 w-14 h-14 bg-brand text-white rounded-full shadow-lg flex items-center justify-center hover:bg-brand-hover transition-colors md:hidden">
          <ShoppingCart size={22} />
          {itemCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">
              {itemCount}
            </span>
          )}
        </button>
      </DrawerTrigger>
      <DrawerContent className="max-h-[85vh]">
        <div className="overflow-y-auto max-h-[80vh] px-2 pb-2">
          <CartPanel {...cartPanelProps} variant="drawer" />
        </div>
      </DrawerContent>
    </Drawer>

    {/* Modals */}
      {isRestaurant && showTablePicker && (
        <TablePickerModal
          tables={tables}
          selectedTableId={cart.tableId}
          onSelectAvailable={handleSelectAvailableTable}
          onSelectOccupied={handleSelectOccupiedTable}
          onSelectHeld={handleSelectHeldTable}
          onClose={() => setShowTablePicker(false)}
        />
      )}

      {addonProduct && (
        <AddonModal
          product={addonProduct}
          currency={currency}
          onAdd={handleAddonAdd}
          onClose={() => setAddonProduct(null)}
        />
      )}

      {checkoutTable && (
        <TableCheckoutModal
          table={checkoutTable}
          currency={currency}
          cartItemCount={cart.itemCount()}
          onClose={() => setCheckoutTable(null)}
          onAddItems={handleAddItemsToOrder}
          onPayment={(bill) => { setCheckoutTable(null); setPaymentBill(bill); }}
          onAddCartToOrder={handleAddCartToOrder}
        />
      )}

      {paymentBill && (
        <PaymentModal
          bill={paymentBill}
          currency={currency}
          onClose={() => setPaymentBill(null)}
          onPaid={handlePaymentComplete}
        />
      )}

      {showCustomerPrompt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">Select Customer</h3>
              <button onClick={() => setShowCustomerPrompt(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">A customer is required before placing an order.</p>
            <CustomerSearch onSelected={() => setShowCustomerPrompt(false)} />
          </div>
        </div>
      )}

      {/* Prepaid Checkout Modal - Payment BEFORE order is placed */}
      {showPrepaidCheckout && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">Prepaid Checkout</h3>
              <button onClick={() => setShowPrepaidCheckout(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">Enter payment to complete order.</p>
            
            {/* Cart Summary */}
            <div className="bg-gray-50 rounded-xl p-4 mb-4">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-500">Items</span>
                <span>{cart.itemCount()}</span>
              </div>
              <div className="flex justify-between font-bold text-lg">
                <span>Total</span>
                <span className="text-brand">{currency}{cart.subtotal().toLocaleString()}</span>
              </div>
            </div>

            {/* Payment Method Selection */}
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700">Payment Method</p>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => handlePrepaidCheckout('cash', cart.subtotal())}
                  className="py-3 rounded-xl border-2 border-gray-200 hover:border-brand hover:bg-brand/5 transition-colors"
                >
                  <span className="block text-lg">💵</span>
                  <span className="text-xs font-medium text-gray-600">Cash</span>
                </button>
                <button
                  onClick={() => handlePrepaidCheckout('card', cart.subtotal())}
                  className="py-3 rounded-xl border-2 border-gray-200 hover:border-brand hover:bg-brand/5 transition-colors"
                >
                  <span className="block text-lg">💳</span>
                  <span className="text-xs font-medium text-gray-600">Card</span>
                </button>
                <button
                  onClick={() => handlePrepaidCheckout('upi', cart.subtotal())}
                  className="py-3 rounded-xl border-2 border-gray-200 hover:border-brand hover:bg-brand/5 transition-colors"
                >
                  <span className="block text-lg">📱</span>
                  <span className="text-xs font-medium text-gray-600">UPI</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
