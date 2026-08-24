import React, { useMemo, useState } from 'react'
import { createOrder, loadProducts, type CartItem } from '../lib/orders'
import { C } from '../theme'

/** Product grid + cart. Checkout writes through lib/orders.createOrder. */
export function PosView({ currencySymbol }: { currencySymbol: string }) {
  const products = useMemo(() => loadProducts(), [])
  const [cart, setCart] = useState<Record<string, CartItem>>({})
  const [message, setMessage] = useState<string | null>(null)

  const add = (p: CartItem) =>
    setCart((c) => ({ ...c, [p.productId]: { ...p, quantity: (c[p.productId]?.quantity ?? 0) + 1 } }))
  const change = (id: string, delta: number) =>
    setCart((c) => {
      const next = (c[id]?.quantity ?? 0) + delta
      if (next <= 0) return Object.fromEntries(Object.entries(c).filter(([k]) => k !== id))
      return { ...c, [id]: { ...c[id], quantity: next } }
    })

  const lines = Object.values(cart)
  const total = lines.reduce((sum, i) => sum + i.price * i.quantity * (1 + i.taxRate / 100), 0)

  const checkout = () => {
    try {
      createOrder(lines)
      setCart({})
      setMessage('Order created')
    } catch (e: any) {
      setMessage(e.message)
    }
  }

  return (
    <div testId="pos-view" style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, width: '100%' }}>
      {/* product grid */}
      <div style={{ flexGrow: 1, minWidth: 0, padding: 24, overflowY: 'scroll' }}>
        <text style={{ fontSize: 20, fontWeight: 700, color: C.text }}>New order</text>
        <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingTop: 14 }}>
          {products.map((p) => (
            <div
              key={p.productId}
              testId={`product-${p.productId}`}
              onClick={() => add(p)}
              style={{
                width: 150,
                padding: 12,
                borderRadius: 10,
                backgroundColor: C.card,
                borderWidth: 1,
                borderColor: C.border,
                cursor: 'pointer',
                hover: { borderColor: C.accent },
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <text style={{ fontSize: 13.5, color: C.text }}>{p.name}</text>
              <text style={{ fontSize: 13, color: C.muted }}>
                {currencySymbol}
                {p.price.toFixed(2)}
              </text>
            </div>
          ))}
        </div>
      </div>

      {/* cart */}
      <div
        style={{
          width: 280,
          flexShrink: 0,
          height: '100%',
          backgroundColor: '#1D1E22',
          borderLeftWidth: 1,
          borderLeftColor: C.border,
          display: 'flex',
          flexDirection: 'column',
          padding: 16,
          gap: 8,
        }}
      >
        <text style={{ fontSize: 15, fontWeight: 600, color: C.text }}>Cart</text>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexGrow: 1, overflowY: 'scroll' }}>
          {lines.map((i) => (
            <div key={i.productId} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <text style={{ fontSize: 13, color: C.text, flexGrow: 1, minWidth: 0 }}>
                {i.name} ×{i.quantity}
              </text>
              <div testId={`dec-${i.productId}`} onClick={() => change(i.productId, -1)} style={stepStyle}>
                <text style={{ fontSize: 14, color: C.muted }}>−</text>
              </div>
              <div testId={`inc-${i.productId}`} onClick={() => change(i.productId, 1)} style={stepStyle}>
                <text style={{ fontSize: 14, color: C.muted }}>+</text>
              </div>
            </div>
          ))}
          {lines.length === 0 && <text style={{ fontSize: 13, color: C.tertiary }}>Tap products to add</text>}
        </div>
        {message && <text style={{ fontSize: 12, color: C.accent }}>{message}</text>}
        <div
          testId="checkout"
          onClick={lines.length ? checkout : undefined}
          style={{
            height: 42,
            borderRadius: 8,
            backgroundColor: lines.length ? C.accent : C.border,
            alignItems: 'center',
            justifyContent: 'center',
            display: 'flex',
            cursor: lines.length ? 'pointer' : 'default',
          }}
        >
          <text style={{ fontSize: 14, fontWeight: 600, color: lines.length ? C.onAccent : C.muted }}>
            Charge {currencySymbol}
            {total.toFixed(2)}
          </text>
        </div>
      </div>
    </div>
  )
}

const stepStyle = {
  width: 24,
  height: 24,
  borderRadius: 6,
  borderWidth: 1,
  borderColor: C.border,
  alignItems: 'center',
  justifyContent: 'center',
  display: 'flex',
  cursor: 'pointer',
}
