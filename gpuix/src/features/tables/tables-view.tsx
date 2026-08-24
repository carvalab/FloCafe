import React from 'react'
import { getDb } from '../../shared/db'
import { C } from '../../shared/theme'

interface Table {
  id: string
  number: string
  capacity: number
  status: string
}

const STATUS_COLOR: Record<string, string> = {
  available: C.success,
  occupied: C.primary,
  reserved: '#B45309',
}

export function TablesView() {
  const [tick, setTick] = React.useState(0)
  const rows = getDb()
    .prepare('SELECT id, number, capacity, status FROM tables WHERE is_active = 1 ORDER BY number')
    .all() as Table[]

  const cycle = (t: Table) => {
    const next = t.status === 'available' ? 'occupied' : 'available'
    getDb().prepare('UPDATE tables SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(next, t.id)
    setTick((n) => n + 1)
  }

  return (
    <div testId="tables-view" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, padding: 24 }}>
      <text style={{ fontSize: 20, fontWeight: 700, color: C.text, paddingBottom: 12 }}>Tables</text>
      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {rows.map((t) => (
          <div
            key={t.id}
            testId={`table-${t.number}`}
            onClick={() => cycle(t)}
            style={{
              width: 120,
              height: 84,
              borderRadius: 10,
              borderWidth: 2,
              borderColor: STATUS_COLOR[t.status] ?? C.border,
              backgroundColor: C.card,
              alignItems: 'center',
              justifyContent: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              cursor: 'pointer',
            }}
          >
            <text style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{t.number}</text>
            <text style={{ fontSize: 11.5, color: STATUS_COLOR[t.status] ?? C.muted }}>
              {t.status} · {t.capacity}p
            </text>
          </div>
        ))}
        {rows.length === 0 && <text style={{ fontSize: 13, color: C.muted }}>No tables configured</text>}
      </div>
    </div>
  )
}
