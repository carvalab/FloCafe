import { create } from 'zustand';
import type { CartItem } from '@/lib/types';
import api from '@/lib/api';

export interface HeldOrder {
  id?: string;
  tableId: string;
  items: CartItem[];
  customerId: number | string | null;
  guestCount: number;
  orderNotes: string;
  heldAt: string;
}

interface HeldOrdersState {
  orders: Record<string, HeldOrder>;
  fetchHeldOrders: () => Promise<void>;
  holdOrder: (tableId: string, items: CartItem[], customerId: number | string | null, guestCount: number, orderNotes?: string) => Promise<void>;
  restoreOrder: (tableId: string) => Promise<HeldOrder | null>;
  removeHeldOrder: (tableId: string) => Promise<void>;
  hasHeldOrder: (tableId: string) => boolean;
  getHeldOrder: (tableId: string) => HeldOrder | undefined;
}

export const useHeldOrdersStore = create<HeldOrdersState>()((set, get) => ({
  orders: {},

  fetchHeldOrders: async () => {
    try {
      const { data } = await api.get('/held-orders');
      if (data && data.orders) {
        const newOrders: Record<string, HeldOrder> = {};
        for (const order of data.orders) {
          newOrders[order.tableId] = order;
        }
        set({ orders: newOrders });
      }
    } catch (err) {
      console.error('Failed to fetch held orders', err);
    }
  },

  holdOrder: async (tableId, items, customerId, guestCount, orderNotes = '') => {
    try {
      await api.post('/held-orders', { tableId, items, customerId, guestCount, orderNotes });
      set((state) => ({
        orders: {
          ...state.orders,
          [tableId]: { tableId, items, customerId, guestCount, orderNotes, heldAt: new Date().toISOString() },
        },
      }));
    } catch (err) {
      console.error('Failed to hold order', err);
      throw err;
    }
  },

  restoreOrder: async (tableId) => {
    const order = get().orders[tableId];
    if (!order) return null;
    try {
      await api.delete(`/held-orders/${tableId}`);
      set((state) => {
        const rest = { ...state.orders };
        delete rest[tableId];
        return { orders: rest };
      });
      return order;
    } catch (err) {
      console.error('Failed to restore order', err);
      throw err;
    }
  },

  removeHeldOrder: async (tableId) => {
    try {
      await api.delete(`/held-orders/${tableId}`);
      set((state) => {
        const rest = { ...state.orders };
        delete rest[tableId];
        return { orders: rest };
      });
    } catch (err) {
      console.error('Failed to remove held order', err);
      throw err;
    }
  },

  hasHeldOrder: (tableId) => !!get().orders[tableId],

  getHeldOrder: (tableId) => get().orders[tableId],
}));
