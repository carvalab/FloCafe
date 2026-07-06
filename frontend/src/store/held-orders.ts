import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartItem } from '@/lib/types';

interface HeldOrder {
  tableId: number;
  items: CartItem[];
  customerId: number | string | null;
  guestCount: number;
  orderNotes: string;
  heldAt: string;
}

interface HeldOrdersState {
  orders: Record<number, HeldOrder>;
  holdOrder: (tableId: number, items: CartItem[], customerId: number | string | null, guestCount: number, orderNotes?: string) => void;
  restoreOrder: (tableId: number) => HeldOrder | null;
  removeHeldOrder: (tableId: number) => void;
  hasHeldOrder: (tableId: number) => boolean;
  getHeldOrder: (tableId: number) => HeldOrder | undefined;
}

export const useHeldOrdersStore = create<HeldOrdersState>()(
  persist(
    (set, get) => ({
      orders: {},

      holdOrder: (tableId, items, customerId, guestCount, orderNotes = '') => {
        set((state) => ({
          orders: {
            ...state.orders,
            [tableId]: { tableId, items, customerId, guestCount, orderNotes, heldAt: new Date().toISOString() },
          },
        }));
      },

      restoreOrder: (tableId) => {
        const order = get().orders[tableId];
        if (!order) return null;
        set((state) => {
          const { [tableId]: _, ...rest } = state.orders;
          return { orders: rest };
        });
        return order;
      },

      removeHeldOrder: (tableId) => {
        set((state) => {
          const { [tableId]: _, ...rest } = state.orders;
          return { orders: rest };
        });
      },

      hasHeldOrder: (tableId) => !!get().orders[tableId],

      getHeldOrder: (tableId) => get().orders[tableId],
    }),
    { name: 'held-orders' }
  )
);
