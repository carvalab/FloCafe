'use client';

import { PointerActivationConstraints, PointerSensor } from '@dnd-kit/dom';
import { DragDropProvider, type DragEndEvent } from '@dnd-kit/react';
import { useMemo, useState } from 'react';
import { ItemCard } from '@/components/kds/ItemCard';
import { KdsColumn } from '@/components/kds/KdsColumn';
import { KdsItemModal } from '@/components/kds/KdsItemModal';
import {
  STATUS_ORDER,
  type KitchenStatus,
  type KdsOrder,
  type KdsOrderItem,
} from '@/hooks/useKdsConnection';

export interface KdsKanbanBoardProps {
  orders: KdsOrder[];
  updating: number | null;
  updateItemStatus: (itemId: number, status: KitchenStatus, opts?: { silent?: boolean }) => Promise<void>;
}

interface DropData {
  status: KitchenStatus;
}

interface DragData {
  item: KdsOrderItem;
  fromStatus: KitchenStatus;
}

export function KdsKanbanBoard({ orders, updating, updateItemStatus }: KdsKanbanBoardProps) {
  const [modalItem, setModalItem] = useState<{ item: KdsOrderItem; orderNumber: string } | null>(null);

  // Flatten orders → per-item rows. The order group is preserved so chefs
  // see items in the same order they're used to from the tabs view.
  const itemsByStatus = useMemo(() => {
    const map: Record<KitchenStatus, Array<{ item: KdsOrderItem; orderNumber: string; tableName: string | null }>> = {
      pending: [],
      preparing: [],
      ready: [],
      served: [],
    };
    for (const order of orders) {
      for (const item of order.items || []) {
        const status = (item.status || 'pending') as KitchenStatus;
        map[status].push({ item, orderNumber: order.order_number, tableName: order.table?.name ?? null });
      }
    }
    return map;
  }, [orders]);

  async function handleDragEnd(event: DragEndEvent) {
    if (event.canceled) return;
    const sourceData = event.operation.source?.data as DragData | undefined;
    const targetData = event.operation.target?.data as DropData | undefined;
    if (!event.operation.target || !sourceData || !targetData) return;

    const from = sourceData.fromStatus;
    const to = targetData.status;
    const itemId = sourceData.item.id;
    if (from === to) return;

    // Silent: the drag itself is the confirmation — toasts on every drop get noisy.
    await updateItemStatus(itemId, to, { silent: true });
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <DragDropProvider
        sensors={(defaults) => [
          ...defaults.filter((sensor) => sensor !== PointerSensor),
          PointerSensor.configure({
            activationConstraints: [
              new PointerActivationConstraints.Delay({ value: 300, tolerance: 8 }),
            ],
            preventActivation: () => false,
          }),
        ]}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-3 px-1 overflow-x-auto flex-1 min-h-0">
          {STATUS_ORDER.map((status) => {
            const rows = itemsByStatus[status];
            return (
              <KdsColumn key={status} status={status} count={rows.length}>
                {rows.map(({ item, orderNumber, tableName }) => (
                  <div
                    key={item.id}
                    className={updating === item.id ? 'pointer-events-none opacity-60' : undefined}
                  >
                    <ItemCard
                      item={item}
                      orderNumber={orderNumber}
                      tableName={tableName}
                      onOpen={() => setModalItem({ item, orderNumber })}
                    />
                  </div>
                ))}
              </KdsColumn>
            );
          })}
        </div>
      </DragDropProvider>

      {modalItem && (
        <KdsItemModal
          item={modalItem.item}
          orderNumber={modalItem.orderNumber}
          updating={updating === modalItem.item.id}
          onClose={() => setModalItem(null)}
          onUpdateStatus={(itemId, status) => {
            updateItemStatus(itemId, status);
            setModalItem(null);
          }}
        />
      )}
    </div>
  );
}
