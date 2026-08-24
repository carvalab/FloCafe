import React, { useState } from 'react'
import { deactivateCustomer, loadCustomers, saveCustomer } from './customers'
import { C } from '../../shared/theme'

interface EditState {
  id: string | null
  name: string
  phone: string
  email: string
}

/** Customers list with inline add/edit and soft delete. */
export function CustomersView() {
  const [rows, setRows] = useState(() => loadCustomers())
  const [edit, setEdit] = useState<EditState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = () => setRows(loadCustomers())

  const save = () => {
    if (!edit) return
    try {
      saveCustomer({ id: edit.id ?? undefined, name: edit.name, phone: edit.phone, email: edit.email })
      setEdit(null)
      setError(null)
      refresh()
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <div testId="customers-view" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, padding: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', paddingBottom: 12 }}>
        <text style={{ fontSize: 20, fontWeight: 700, color: C.text, flexGrow: 1 }}>Customers ({rows.length})</text>
        <div testId="customer-add" onClick={() => { setEdit({ id: null, name: '', phone: '', email: '' }); setError(null) }} style={btn}>
          <text style={{ fontSize: 13, color: C.primary }}>+ Add</text>
        </div>
      </div>

      {edit && (
        <div testId="customer-editor" style={{ ...card, marginBottom: 12 }}>
          <Field label="Name" value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} />
          <Field label="Phone" value={edit.phone} onChange={(v) => setEdit({ ...edit, phone: v })} />
          <Field label="Email" value={edit.email} onChange={(v) => setEdit({ ...edit, email: v })} />
          {error && <text style={{ fontSize: 12, color: C.danger }}>{error}</text>}
          <div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
            <div testId="customer-save" onClick={save} style={{ ...btn, backgroundColor: C.primary }}>
              <text style={{ fontSize: 13, color: C.onPrimary }}>Save</text>
            </div>
            <div onClick={() => setEdit(null)} style={{ ...btn, borderWidth: 1, borderColor: C.border }}>
              <text style={{ fontSize: 13, color: C.muted }}>Cancel</text>
            </div>
          </div>
        </div>
      )}

      <virtual-list estimatedItemHeight={40} style={{ flexGrow: 1 }}>
        {rows.map((c) => (
          <div key={c.id} style={{ height: 40, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <text style={{ fontSize: 14, color: C.text, flexGrow: 1, minWidth: 0 }}>{c.name}</text>
            <text style={{ fontSize: 13, color: C.muted, width: 160 }}>{c.phone ?? ''}</text>
            <text style={{ fontSize: 13, color: C.tertiary, width: 220 }}>{c.email ?? ''}</text>
            <text onClick={() => { setEdit({ id: c.id, name: c.name, phone: c.phone ?? '', email: c.email ?? '' }); setError(null) }} style={{ fontSize: 12.5, color: C.primary, cursor: 'pointer' }}>Edit</text>
            <text onClick={() => { deactivateCustomer(c.id); refresh() }} style={{ fontSize: 12.5, color: C.danger, cursor: 'pointer' }}>Delete</text>
          </div>
        ))}
        {rows.length === 0 && <text style={{ fontSize: 13, color: C.muted }}>No customers yet</text>}
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
