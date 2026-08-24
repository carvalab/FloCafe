import React from 'react'
import { loadProducts } from './products'
import { C } from '../../shared/theme'

const ROW = 44

/** Active products, virtualized — the table can hold thousands of rows. */
export function ProductsView({ currencySymbol }: { currencySymbol: string }) {
  const rows = loadProducts()

  return (
    <div testId="products-view" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, padding: 24 }}>
      <text style={{ fontSize: 20, fontWeight: 700, color: C.text, paddingBottom: 12 }}>
        Products ({rows.length})
      </text>
      <virtual-list estimatedItemHeight={ROW} style={{ flexGrow: 1 }}>
        {rows.map((p) => (
          <div key={p.id} style={{ height: ROW, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <text style={{ fontSize: 14, color: C.text, flexGrow: 1, minWidth: 0 }}>{p.name}</text>
            <text style={{ fontSize: 13, color: C.tertiary, width: 120 }}>{p.categoryName ?? ''}</text>
            <text style={{ fontSize: 13, color: C.muted, width: 90, textAlign: 'right' }}>
              {currencySymbol}
              {p.price.toFixed(2)}
            </text>
            <text style={{ fontSize: 13, color: p.track_inventory && p.stock_quantity <= 0 ? C.danger : C.tertiary, width: 70, textAlign: 'right' }}>
              {p.track_inventory ? `${p.stock_quantity} left` : '—'}
            </text>
          </div>
        ))}
      </virtual-list>
    </div>
  )
}
