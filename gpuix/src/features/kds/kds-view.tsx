import React from 'react'
import { getDb } from '../../shared/db'
import { updateOrderStatus } from '../orders/orders'
import { C } from '../../shared/theme'

interface Item {
  id: number
  order_id: number
  product_name: string
  quantity: number
  status: string
}

/**
 * Kitchen queue: one card per live order's items.
 * ponytail: single-screen queue — station routing and item-level states
 * arrive with kitchen_stations parity if the KDS window split is ever needed.
 */
export function KdsView() {
  const [tick, setTick] = React.useState(0)
  const items = getDb()
    .prepare(
      `SELECT oi.id, oi.order_id, oi.product_name, oi.quantity, oi.status
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.status IN ('pending', 'preparing') ORDER BY o.created_at`,
    )
    .all() as Item[]
  const byOrder = new Map<number, Item[]>()
  for (const i of items) byOrder.set(i.order_id, [...(byOrder.get(i.order_id) ?? []), i])

  const advance = (orderId: number) => {
    const order: any = getDb().prepare('SELECT status FROM orders WHERE id = ?').get(orderId)
    try {
      updateOrderStatus(orderId, order.status === 'pending' ? 'preparing' : 'ready')
      setTick((t) => t + 1)
    } catch {}
  }

  return (
    <div testId="kds-view" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, padding: 24 }}>
      <text style={{ fontSize: 20, fontWeight: 700, color: C.text, paddingBottom: 12 }}>Kitchen queue</text>
      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 12, overflowY: 'scroll' }}>
        {[...byOrder.entries()].map(([orderId, orderItems]) => (
          <div
            key={orderId}
            testId={`kds-order-${orderId}`}
            style={{
              width: 240,
              backgroundColor: C.card,
              borderWidth: 1,
              borderColor: C.border,
              borderRadius: 10,
              padding: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <text style={{ fontSize: 13, color: C.muted }}>Order #{items.find((i) => i.order_id === orderId)?.order_id}</text>
            {orderItems.map((i) => (
              <text key={i.id} style={{ fontSize: 14, color: C.text }}>
                {i.quantity}× {i.product_name}
              </text>
            ))}
          </div>
        ))}
        {byOrder.size === 0 && <text style={{ fontSize: 13, color: C.muted }}>Queue empty</text>}
      </div>
      {/* advance buttons */}
      <div style={{ display: 'flex', flexDirection: 'row', gap: 10, paddingTop: 6, flexWrap: 'wrap' }}>
        {[...byOrder.keys()].map((orderId) => (
          <div
            key={orderId}
            testId={`kds-advance-${orderId}`}
            onClick={() => advance(orderId)}
            style={{
              paddingHorizontal: 12,
              paddingTop: 6,
              paddingBottom: 6,
              borderRadius: 7,
              backgroundColor: C.primary,
              cursor: 'pointer',
            }}
          >
            <text style={{ fontSize: 12.5, color: C.onPrimary }}>Advance #{orderId}</text>
          </div>
        ))}
      </div>
    </div>
  )
}
