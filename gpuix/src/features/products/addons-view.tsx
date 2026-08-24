import React from 'react'
import { getDb } from '../../shared/db'
import { C } from '../../shared/theme'

interface Group {
  id: string
  name: string
  is_required: number
}

interface Row {
  id: string
  addon_group_id: string
  name: string
  price: number
}

/** Read-only view of configured modifier groups + their addons. */
export function AddonsView() {
  const groups = getDb()
    .prepare('SELECT id, name, is_required FROM addon_groups WHERE is_active = 1 ORDER BY sort_order')
    .all() as Group[]
  const rows = getDb()
    .prepare('SELECT id, addon_group_id, name, price FROM addons WHERE is_active = 1 ORDER BY sort_order')
    .all() as Row[]

  return (
    <div testId="addons-view" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, padding: 24 }}>
      <text style={{ fontSize: 20, fontWeight: 700, color: C.text, paddingBottom: 12 }}>Addon groups</text>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'scroll' }}>
        {groups.map((g) => (
          <div key={g.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <text style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
              {g.name}{g.is_required ? ' *' : ''}
            </text>
            {rows
              .filter((a) => a.addon_group_id === g.id)
              .map((a) => (
                <text key={a.id} style={{ fontSize: 13, color: C.muted, paddingLeft: 12 }}>
                  • {a.name} (+{a.price})
                </text>
              ))}
          </div>
        ))}
        {groups.length === 0 && <text style={{ fontSize: 13, color: C.muted }}>No addon groups configured</text>}
      </div>
    </div>
  )
}
