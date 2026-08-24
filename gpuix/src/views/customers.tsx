import React from 'react'
import { getDb } from '../lib/db'
import { C } from '../theme'

interface Row {
  id: string
  name: string
  phone: string | null
  email: string | null
}

export function CustomersView() {
  const rows = getDb()
    .prepare('SELECT id, name, phone, email FROM customers WHERE is_active = 1 ORDER BY name')
    .all() as Row[]

  return (
    <div testId="customers-view" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, padding: 24 }}>
      <text style={{ fontSize: 20, fontWeight: 700, color: C.text, paddingBottom: 12 }}>
        Customers ({rows.length})
      </text>
      <virtual-list estimatedItemHeight={40} style={{ flexGrow: 1 }}>
        {rows.map((c) => (
          <div key={c.id} style={{ height: 40, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <text style={{ fontSize: 14, color: C.text, flexGrow: 1, minWidth: 0 }}>{c.name}</text>
            <text style={{ fontSize: 13, color: C.muted, width: 160 }}>{c.phone ?? ''}</text>
            <text style={{ fontSize: 13, color: C.tertiary, width: 220 }}>{c.email ?? ''}</text>
          </div>
        ))}
        {rows.length === 0 && <text style={{ fontSize: 13, color: C.muted }}>No customers yet</text>}
      </virtual-list>
    </div>
  )
}
