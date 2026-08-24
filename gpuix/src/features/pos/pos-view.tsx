import React, { useMemo, useState } from 'react'
import { createOrder, lineUnitPrice, type CartAddon, type CartItem } from '../orders/orders'
import { loadAddonGroups, loadCategories, loadProducts, type AddonGroup, type Product } from '../products/products'
import { holdCart, listHeld, resumeHeld, type HeldCart } from './held'
import { C } from '../../shared/theme'

const lineKey = (p: Product, addons: CartAddon[]) =>
  p.id + '+' + addons.map((a) => a.id).sort().join(',')

function AddonPanel({
  product,
  onConfirm,
  onCancel,
}: {
  product: Product
  onConfirm: (addons: CartAddon[]) => void
  onCancel: () => void
}) {
  const [groups] = useState<AddonGroup[]>(() => loadAddonGroups(product.id))
  const [picked, setPicked] = useState<Map<string, CartAddon>>(new Map())
  const [error, setError] = useState<string | null>(null)

  const toggle = (group: AddonGroup, addon: CartAddon) => {
    setPicked((prev) => {
      const next = new Map(prev)
      if (next.has(addon.id)) return next.delete(addon.id), next
      // single-choice groups replace the previous pick
      if (group.maxSelection <= 1) for (const a of group.addons) next.delete(a.id)
      next.set(addon.id, addon)
      return next
    })
  }

  const confirm = () => {
    for (const g of groups) {
      const n = g.addons.filter((a) => picked.has(a.id)).length
      if (g.isRequired && n < Math.max(1, g.minSelection)) {
        return setError(`${g.name} is required`)
      }
    }
    onConfirm([...picked.values()])
  }

  return (
    <div testId="addon-panel" style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 10 }}>
      {groups.map((g) => (
        <div key={g.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <text style={{ fontSize: 12.5, color: C.muted }}>
            {g.name}
            {g.isRequired ? ' *' : ''}
          </text>
          <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {g.addons.map((a) => (
              <div
                key={a.id}
                testId={`addon-${a.id}`}
                onClick={() => toggle(g, a)}
                style={{
                  paddingHorizontal: 9,
                  paddingTop: 5,
                  paddingBottom: 5,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: picked.has(a.id) ? C.primary : C.border,
                  backgroundColor: picked.has(a.id) ? C.navActive : C.card,
                  cursor: 'pointer',
                }}
              >
                <text style={{ fontSize: 12.5, color: picked.has(a.id) ? C.primary : C.text }}>
                  {a.name} +{a.price}
                </text>
              </div>
            ))}
          </div>
        </div>
      ))}
      {error && <text style={{ fontSize: 12, color: C.danger }}>{error}</text>}
      <div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
        <div testId="addon-confirm" onClick={confirm} style={{ ...btnStyle, backgroundColor: C.primary }}>
          <text style={{ fontSize: 13, fontWeight: 600, color: C.onPrimary }}>Add</text>
        </div>
        <div testId="addon-cancel" onClick={onCancel} style={{ ...btnStyle, borderWidth: 1, borderColor: C.border, backgroundColor: C.card }}>
          <text style={{ fontSize: 13, color: C.muted }}>Cancel</text>
        </div>
      </div>
    </div>
  )
}

/** New order workspace: category tabs, product grid, cart with hold/resume. */
export function PosView({ currencySymbol }: { currencySymbol: string }) {
  const products = useMemo(() => loadProducts(), [])
  const categories = useMemo(() => loadCategories(), [])
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [cart, setCart] = useState<Record<string, CartItem>>({})
  const [pending, setPending] = useState<Product | null>(null)
  const [held, setHeld] = useState<HeldCart[]>(() => listHeld())
  const [holdLabel, setHoldLabel] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const visible = activeCategory ? products.filter((p) => p.categoryId === activeCategory) : products
  const lines = Object.values(cart)
  const total = lines.reduce((sum, i) => sum + lineUnitPrice(i) * i.quantity * (1 + i.taxRate / 100), 0)
  const refreshHeld = () => setHeld(listHeld())

  const add = (p: Product, addons: CartAddon[] = []) => {
    const key = lineKey(p, addons)
    setCart((c) => ({
      ...c,
      [key]: { ...p, quantity: (c[key]?.quantity ?? 0) + 1, addons: addons.length ? addons : undefined },
    }))
    setPending(null)
  }

  const clickProduct = (p: Product) => {
    setMessage(null)
    if (loadAddonGroups(p.id).length > 0) setPending(p)
    else add(p)
  }

  const change = (key: string, delta: number) =>
    setCart((c) => {
      const next = (c[key]?.quantity ?? 0) + delta
      if (next <= 0) return Object.fromEntries(Object.entries(c).filter(([k]) => k !== key))
      return { ...c, [key]: { ...c[key], quantity: next } }
    })

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
      {/* products */}
      <div style={{ flexGrow: 1, minWidth: 0, padding: 24, display: 'flex', flexDirection: 'column' }}>
        <text style={{ fontSize: 20, fontWeight: 700, color: C.text }}>New order</text>
        <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 10, paddingBottom: 12 }}>
          {[{ id: null as string | null, name: 'All' }, ...categories].map((cat) => (
            <div
              key={cat.id ?? 'all'}
              testId={`category-${cat.id ?? 'all'}`}
              onClick={() => setActiveCategory(cat.id)}
              style={{
                paddingHorizontal: 11,
                paddingTop: 5,
                paddingBottom: 5,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: activeCategory === cat.id ? C.primary : C.border,
                backgroundColor: activeCategory === cat.id ? C.navActive : C.card,
                cursor: 'pointer',
              }}
            >
              <text style={{ fontSize: 12.5, color: activeCategory === cat.id ? C.primary : C.muted }}>{cat.name}</text>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 10, overflowY: 'scroll' }}>
          {visible.map((p) => (
            <div
              key={p.id}
              testId={`product-${p.id}`}
              onClick={() => clickProduct(p)}
              style={{
                width: 150,
                padding: 12,
                borderRadius: 10,
                backgroundColor: C.card,
                borderWidth: 1,
                borderColor: C.border,
                cursor: 'pointer',
                hover: { borderColor: C.primary },
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <text style={{ fontSize: 13.5, color: C.text }}>{p.name}</text>
              <text style={{ fontSize: 13, color: C.muted }}>
                {currencySymbol}
                {p.price.toFixed(2)}
                {p.categoryName ? ` · ${p.categoryName}` : ''}
              </text>
            </div>
          ))}
        </div>
        {pending && (
          <>
            <text style={{ fontSize: 15, fontWeight: 600, color: C.text, paddingTop: 10 }}>{pending.name} options:</text>
            <AddonPanel product={pending} onConfirm={(addons) => add(pending, addons)} onCancel={() => setPending(null)} />
          </>
        )}
      </div>

      {/* cart */}
      <div
        style={{
          width: 280,
          flexShrink: 0,
          height: '100%',
          backgroundColor: C.sidebar,
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
            <div key={lineKey(i, i.addons ?? [])} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <text style={{ fontSize: 13, color: C.text, flexGrow: 1, minWidth: 0 }}>
                {i.name}
                {i.addons?.length ? ` +${i.addons.length}` : ''} ×{i.quantity}
              </text>
              <div testId={`dec-${i.productId}`} onClick={() => change(lineKey(i, i.addons ?? []), -1)} style={stepStyle}>
                <text style={{ fontSize: 14, color: C.muted }}>−</text>
              </div>
              <div testId={`inc-${i.productId}`} onClick={() => change(lineKey(i, i.addons ?? []), 1)} style={stepStyle}>
                <text style={{ fontSize: 14, color: C.muted }}>+</text>
              </div>
            </div>
          ))}
          {lines.length === 0 && <text style={{ fontSize: 13, color: C.tertiary }}>Tap products to add</text>}
        </div>

        {/* hold / resume */}
        <div style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <input
            testId="hold-label"
            value={holdLabel}
            placeholder="Table / label"
            onChange={(e) => setHoldLabel(e.value ?? '')}
            style={{ height: 30, flexGrow: 1, borderRadius: 7, borderWidth: 1, borderColor: C.border, paddingLeft: 8, fontSize: 12.5, color: C.text }}
          />
          <div
            testId="hold"
            onClick={() => {
              if (!lines.length) return
              holdCart(lines, holdLabel || 'pos')
              setCart({})
              refreshHeld()
            }}
            style={{ ...btnStyle, borderWidth: 1, borderColor: C.border, backgroundColor: C.card }}
          >
            <text style={{ fontSize: 12.5, color: C.text }}>Hold</text>
          </div>
        </div>
        {held.map((h) => (
          <div key={h.id} testId={`held-${h.label}`} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <text style={{ fontSize: 12, color: C.muted, flexGrow: 1, minWidth: 0 }}>
              {h.label} ({h.items.reduce((s, i) => s + i.quantity, 0)})
            </text>
            <div
              testId={`resume-${h.label}`}
              onClick={() => {
                setCart(Object.fromEntries(resumeHeld(h.id).map((i) => [lineKey(i, i.addons ?? []), i])))
                refreshHeld()
              }}
              style={{ ...btnStyle, backgroundColor: C.primary }}
            >
              <text style={{ fontSize: 12, color: C.onPrimary }}>Resume</text>
            </div>
          </div>
        ))}

        {message && <text testId="pos-message" style={{ fontSize: 12, color: C.primary }}>{message}</text>}
        <div
          testId="checkout"
          onClick={lines.length ? checkout : undefined}
          style={{
            height: 42,
            borderRadius: 8,
            backgroundColor: lines.length ? C.primary : C.border,
            alignItems: 'center',
            justifyContent: 'center',
            display: 'flex',
            cursor: lines.length ? 'pointer' : 'default',
          }}
        >
          <text style={{ fontSize: 14, fontWeight: 600, color: lines.length ? C.onPrimary : C.muted }}>
            Charge {currencySymbol}
            {total.toFixed(2)}
          </text>
        </div>
      </div>
    </div>
  )
}

const btnStyle = {
  paddingHorizontal: 10,
  paddingTop: 6,
  paddingBottom: 6,
  borderRadius: 7,
  cursor: 'pointer' as const,
  display: 'flex' as const,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
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
