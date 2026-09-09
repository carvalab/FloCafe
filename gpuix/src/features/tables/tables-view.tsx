import React, { useState } from 'react'
import { cycleStatus, deactivateTable, loadTables, saveTable, type TableRow } from './tables'
import { C } from '../../shared/theme'

const STATUS_COLOR: Record<string, string> = {
  available: '#1A7F37',
  occupied: C.primary,
  reserved: '#B45309',
}

/** Table grid: tap to cycle status, inline add/remove. */
export function TablesView() {
  const [rows, setRows] = useState(() => loadTables())
  const [number, setNumber] = useState('')
  const [capacity, setCapacity] = useState('4')
  const [error, setError] = useState<string | null>(null)
  const refresh = () => setRows(loadTables())

  const add = () => {
    try {
      saveTable(null, number, Number(capacity) || 1)
      setNumber('')
      setError(null)
      refresh()
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <div testId="tables-view" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, padding: 24 }}>
      <text style={{ fontSize: 20, fontWeight: 700, color: C.text, paddingBottom: 12 }}>Tables</text>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center', paddingBottom: 14 }}>
        <input testId="table-number" value={number} placeholder="Number" onChange={(e) => setNumber(e.value ?? '')}
          style={{ height: 32, width: 110, borderRadius: 7, borderWidth: 1, borderColor: C.border, paddingLeft: 9, fontSize: 13, color: C.text }} />
        <input testId="table-capacity" value={capacity} placeholder="Seats" onChange={(e) => setCapacity(e.value ?? '')}
          style={{ height: 32, width: 70, borderRadius: 7, borderWidth: 1, borderColor: C.border, paddingLeft: 9, fontSize: 13, color: C.text }} />
        <div testId="table-add" onClick={add} style={{ ...btn, backgroundColor: C.primary }}>
          <text style={{ fontSize: 13, color: C.onPrimary }}>+ Add table</text>
        </div>
        {error && <text style={{ fontSize: 12, color: C.danger }}>{error}</text>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {rows.map((t) => (
          <TableCard key={t.id} t={t} onTap={() => { cycleStatus(t.id); refresh() }} onDelete={() => { deactivateTable(t.id); refresh() }} />
        ))}
        {rows.length === 0 && <text style={{ fontSize: 13, color: C.muted }}>No tables configured</text>}
      </div>
    </div>
  )
}

function TableCard({ t, onTap, onDelete }: { t: TableRow; onTap: () => void; onDelete: () => void }) {
  return (
    <div testId={`table-${t.number}`} style={{
      width: 120, borderRadius: 10, borderWidth: 2, borderColor: STATUS_COLOR[t.status] ?? C.border,
      backgroundColor: C.card, display: 'flex', flexDirection: 'column', gap: 4, cursor: 'pointer',
    }}>
      <div onClick={onTap} style={{ alignItems: 'center', justifyContent: 'center', display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 14, paddingBottom: 10 }}>
        <text style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{t.number}</text>
        <text style={{ fontSize: 11.5, color: STATUS_COLOR[t.status] ?? C.muted }}>
          {t.status} · {t.capacity}p
        </text>
      </div>
      <text onClick={onDelete} style={{ fontSize: 11, color: C.tertiary, textAlign: 'center', paddingBottom: 6, cursor: 'pointer' }}>remove</text>
    </div>
  )
}

const btn = {
  paddingHorizontal: 10,
  paddingTop: 6,
  paddingBottom: 6,
  borderRadius: 7,
  cursor: 'pointer' as const,
  display: 'flex' as const,
  alignItems: 'center' as const,
}
