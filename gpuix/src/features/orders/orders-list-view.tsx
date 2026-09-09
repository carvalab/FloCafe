import React from 'react'
import { getDb } from '../../shared/db'
import { updateOrderStatus } from '../orders/orders'
import { C } from '../../shared/theme'

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

const NEXT_ACTION: Record<string, { label: string; status: string }> = {
  pending: { label: 'Start cooking', status: 'preparing' },
  preparing: { label: 'Mark ready', status: 'ready' },
  ready: { label: 'Complete + bill', status: 'completed' },
}

/** Recent 200 live orders with their next action. */
export function OrdersView({ currencySymbol }: { currencySymbol: string }) {
  const [tick, setTick] = React.useState(0)
  const rows = getDb()
    .prepare('SELECT id, order_number, type, status, total FROM orders ORDER BY created_at DESC, id DESC LIMIT 200')
    .all() as Row[]
  const refresh = () => setTick((t) => t + 1)

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
            {NEXT_ACTION[o.status] && (
              <div
                testId={`order-${o.id}-${NEXT_ACTION[o.status].status}`}
                onClick={() => {
                  try {
                    updateOrderStatus(o.id, NEXT_ACTION[o.status].status)
                    refresh()
                  } catch {}
                }}
                style={{
                  paddingHorizontal: 10,
                  paddingTop: 4,
                  paddingBottom: 4,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: C.primary,
                  cursor: 'pointer',
                  hover: { backgroundColor: C.navActive },
                }}
              >
                <text style={{ fontSize: 12.5, color: C.primary }}>{NEXT_ACTION[o.status].label}</text>
              </div>
            )}
            <text style={{ fontSize: 13.5, color: C.text, width: 80, textAlign: 'right' }}>
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
