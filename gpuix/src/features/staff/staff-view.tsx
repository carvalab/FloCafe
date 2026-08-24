import React, { useState } from 'react'
import { createStaff, loadStaff, setStaffActive } from './staff'
import { C } from '../../shared/theme'

const ROLES = ['cashier', 'server', 'chef', 'manager', 'owner']

interface Draft {
  name: string
  email: string
  password: string
  role: string
}

/** Staff logins: create with bcrypt (legacy-app compatible), toggle active. */
export function StaffView() {
  const [rows, setRows] = useState(() => loadStaff())
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = () => setRows(loadStaff())

  const save = async () => {
    if (!draft) return
    try {
      await createStaff(draft.name, draft.email, draft.password, draft.role)
      setDraft(null)
      setError(null)
      refresh()
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <div testId="staff-view" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, padding: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', paddingBottom: 12 }}>
        <text style={{ fontSize: 20, fontWeight: 700, color: C.text, flexGrow: 1 }}>Staff ({rows.length})</text>
        <div testId="staff-add" onClick={() => { setDraft({ name: '', email: '', password: '', role: 'cashier' }); setError(null) }} style={btn}>
          <text style={{ fontSize: 13, color: C.primary }}>+ Add</text>
        </div>
      </div>

      {draft && (
        <div testId="staff-editor" style={{ ...card, marginBottom: 12 }}>
          <Field label="Name" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
          <Field label="Email" value={draft.email} onChange={(v) => setDraft({ ...draft, email: v })} />
          <Field label="Password" value={draft.password} onChange={(v) => setDraft({ ...draft, password: v })} />
          <div style={{ display: 'flex', flexDirection: 'row', gap: 6, paddingBottom: 8, flexWrap: 'wrap' }}>
            {ROLES.map((r) => (
              <div key={r} onClick={() => setDraft({ ...draft, role: r })} style={{
                paddingHorizontal: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 14,
                borderWidth: 1, borderColor: draft.role === r ? C.primary : C.border,
                backgroundColor: draft.role === r ? C.navActive : C.card, cursor: 'pointer',
              }}>
                <text style={{ fontSize: 12.5, color: draft.role === r ? C.primary : C.muted }}>{r}</text>
              </div>
            ))}
          </div>
          {error && <text style={{ fontSize: 12, color: C.danger }}>{error}</text>}
          <div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
            <div testId="staff-save" onClick={save} style={{ ...btn, backgroundColor: C.primary }}>
              <text style={{ fontSize: 13, color: C.onPrimary }}>Save</text>
            </div>
            <div onClick={() => setDraft(null)} style={{ ...btn, borderWidth: 1, borderColor: C.border }}>
              <text style={{ fontSize: 13, color: C.muted }}>Cancel</text>
            </div>
          </div>
        </div>
      )}

      <virtual-list estimatedItemHeight={40} style={{ flexGrow: 1 }}>
        {rows.map((u) => (
          <div key={u.id} style={{ height: 40, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <text style={{ fontSize: 14, color: C.text, flexGrow: 1, minWidth: 0 }}>{u.name}</text>
            <text style={{ fontSize: 13, color: C.tertiary, width: 200 }}>{u.email}</text>
            <text style={{ fontSize: 13, color: C.muted, width: 90 }}>{u.role}</text>
            <text
              testId={`staff-toggle-${u.id}`}
              onClick={() => { setStaffActive(u.id, !u.is_active); refresh() }}
              style={{ fontSize: 12, color: u.is_active ? '#1A7F37' : C.danger, cursor: 'pointer' }}
            >
              {u.is_active ? 'active' : 'inactive'}
            </text>
          </div>
        ))}
      </virtual-list>
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 8 }}>
      <text style={{ fontSize: 12, color: C.muted }}>{label}</text>
      <input value={value} placeholder={label} onChange={(e) => onChange(e.value ?? '')} style={inputStyle} />
    </div>
  )
}
const card = {
  padding: 14,
  borderRadius: 10,
  backgroundColor: C.card,
  borderWidth: 1,
  borderColor: C.border,
  display: 'flex',
  flexDirection: 'column',
}
const inputStyle = {
  height: 34,
  borderRadius: 7,
  borderWidth: 1,
  borderColor: C.border,
  paddingLeft: 9,
  paddingRight: 9,
  fontSize: 13.5,
  color: C.text,
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
