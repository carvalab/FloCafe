'use client';

import { useDraggable } from '@dnd-kit/react';
import { STATUS_CONFIG, type KitchenStatus, type KdsOrderItem } from '@/hooks/useKdsConnection';

export interface ItemCardProps {
  item: KdsOrderItem;
  orderNumber: string;
  tableName?: string | null;
  onOpen?: () => void;
}

export function ItemCard({ item, orderNumber, tableName, onOpen }: ItemCardProps) {
  const itemStatus = (item.status || 'pending') as KitchenStatus;
  const config = STATUS_CONFIG[itemStatus];

  const { ref, isDragging } = useDraggable({
    id: `item-${item.id}`,
    data: { item, fromStatus: itemStatus },
  });

  return (
    <div
      ref={ref}
      className={`rounded-lg border bg-white shadow-sm hover:shadow transition select-none cursor-grab active:cursor-grabbing ${config.border} ${isDragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={onOpen}
          className="flex-1 min-w-0 text-left px-2.5 py-2 cursor-pointer active:scale-[0.98] transition"
          aria-label={`Open ${item.product_name} details`}
        >
          <div className="flex items-baseline gap-1.5 mb-0.5">
            <span className={`text-[11px] font-bold ${config.text}`}>{item.quantity}×</span>
            <span className="text-[11px] text-gray-500 truncate">
              #{orderNumber}
              {tableName ? ` · ${tableName}` : ''}
            </span>
          </div>
          <div className="flex items-start gap-2">
            <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${config.color}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 leading-tight break-words">{item.product_name}</p>
              {item.addons && item.addons.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {item.addons.slice(0, 3).map((addon, i) => (
                    <span
                      key={`${addon.id ?? addon.name}-${i}`}
                      className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200"
                    >
                      + {addon.name}
                    </span>
                  ))}
                  {item.addons.length > 3 && (
                    <span className="text-[10px] text-gray-400 px-1">+{item.addons.length - 3}</span>
                  )}
                </div>
              )}
              {item.special_instructions && (
                <p className="mt-1 text-[10px] text-red-700 italic leading-tight break-words font-medium">
                  ⚠ {item.special_instructions}
                </p>
              )}
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}
