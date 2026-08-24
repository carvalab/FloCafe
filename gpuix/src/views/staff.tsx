import React from 'react'
import { getDb } from '../lib/db'
import { C } from '../theme'

interface Row {
  id: number
  name: string
  role: string
  is_active: number
}

/** Staff = users table. Roles gate nothing yet — UI parity first (ponytail). */
export function StaffView() {
  const rows = getDb().prepare('SELECT id, name, role, is_active FROM users ORDER BY name').all() as Row[]

  return (
    <div testId="staff-view" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, padding: 24 }}>
      <text style={{ fontSize: 20, fontWeight: 700, color: C.text, paddingBottom: 12 }}>Staff ({rows.length})</text>
      <virtual-list estimatedItemHeight={40} style={{ flexGrow: 1 }}>
        {rows.map((u) => (
          <div key={u.id} style={{ height: 40, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <text style={{ fontSize: 14, color: C.text, flexGrow: 1, minWidth: 0 }}>{u.name}</text>
            <text style={{ fontSize: 13, color: C.muted, width: 120 }}>{u.role}</text>
            <text style={{ fontSize: 12, color: u.is_active ? '#46A758' : C.danger }}>
              {u.is_active ? 'active' : 'inactive'}
            </text>
          </div>
        ))}
      </virtual-list>
    </div>
  )
}
