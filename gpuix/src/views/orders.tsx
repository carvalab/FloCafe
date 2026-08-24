import React from 'react'
import { getDb } from '../lib/db'
import { C } from '../theme'

interface Row {
  id: number
  order_number: string
  type: string
  status: string
  total: number
}

const STATUS_COLOR: Record<string, string> = {
  pending: '#B45309',
  preparing: C.primary,
  ready: '#1A7F37',
  completed: C.success,
  cancelled: C.danger,
}

/** Most recent 200 orders, newest first. */
export function OrdersView({ currencySymbol }: { currencySymbol: string }) {
  const rows = getDb()
    .prepare('SELECT id, order_number, type, status, total FROM orders ORDER BY created_at DESC, id DESC LIMIT 200')
    .all() as Row[]

  return (
    <div testId="orders-view" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, padding: 24 }}>
      <text style={{ fontSize: 20, fontWeight: 700, color: C.text, paddingBottom: 12 }}>Recent orders</text>
      <virtual-list estimatedItemHeight={40} style={{ flexGrow: 1 }}>
        {rows.map((o) => (
          <div key={o.id} style={{ height: 40, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <text style={{ fontSize: 13.5, color: C.text, width: 130 }}>{o.order_number}</text>
            <text style={{ fontSize: 13, color: C.muted, width: 80 }}>{o.type}</text>
            <div
              style={{
                paddingHorizontal: 8,
                paddingTop: 3,
                paddingBottom: 3,
                borderRadius: 10,
                backgroundColor: C.item,
              }}
            >
              <text style={{ fontSize: 12, color: STATUS_COLOR[o.status] ?? C.muted }}>{o.status}</text>
            </div>
            <div style={{ flexGrow: 1 }} />
            <text style={{ fontSize: 13.5, color: C.text }}>
              {currencySymbol}
              {o.total.toFixed(2)}
            </text>
          </div>
        ))}
        {rows.length === 0 && <text style={{ fontSize: 13, color: C.muted }}>No orders yet</text>}
      </virtual-list>
    </div>
  )
}
