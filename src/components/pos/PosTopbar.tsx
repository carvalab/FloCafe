'use client';

import PrinterStatus from './PrinterStatus';
import CustomerSearch from './CustomerSearch';
import { useCartStore } from '@/store/cart';
import { useAuthStore } from '@/store/auth';
import { MapPin } from 'lucide-react';
import type { Table } from '@/lib/types';

interface Props {
  tables: Table[];
  onShowTablePicker: () => void;
}

export default function PosTopbar({ tables, onShowTablePicker }: Props) {
  const cart = useCartStore();
  const { currentTenant } = useAuthStore();
  const isRestaurant = (currentTenant?.business_type ?? 'restaurant') === 'restaurant';
  const showTableBtn = isRestaurant && cart.orderType === 'dine_in';

  return (
    <div className="flex items-center gap-2 border-b bg-white shrink-0 px-4 py-2">
      <div className="flex-1 min-w-0">
        <CustomerSearch variant="topbar" />
      </div>

      {/* Select Table — between customer search and printer */}
      {showTableBtn && (
        <button
          onClick={onShowTablePicker}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border font-medium transition-colors whitespace-nowrap ${
            cart.tableId
              ? 'bg-orange-500 text-white border-orange-500 hover:bg-orange-600'
              : 'bg-amber-50 border-amber-400 text-amber-700 hover:bg-amber-100'
          }`}
        >
          <MapPin size={14} />
          {cart.tableId
            ? `Table: ${tables.find(t => t.id === cart.tableId)?.name || cart.tableId}`
            : 'Select Table'}
        </button>
      )}

      <div className="shrink-0">
        <PrinterStatus />
      </div>
    </div>
  );
}
