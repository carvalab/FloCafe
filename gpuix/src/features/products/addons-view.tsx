import React, { useState } from 'react'
import { getDb } from '../../shared/db'
import { saveAddon, saveAddonGroup } from './products'
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

/** Manage modifier groups and their addons (add + read; deactivate via DB parity later). */
export function AddonsView() {
  const [groups, setGroups] = useState<Group[]>(() => queryGroups())
  const [rows, setRows] = useState<Row[]>(() => queryRows())
  const [groupName, setGroupName] = useState('')
  const [required, setRequired] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, { name: string; price: string }>>({})
  const [error, setError] = useState<string | null>(null)
  const refresh = () => { setGroups(queryGroups()); setRows(queryRows()) }

  const addGroup = () => {
    try {
      saveAddonGroup(null, groupName, required)
      setGroupName('')
      setRequired(false)
      setError(null)
      refresh()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const addAddon = (groupId: string) => {
    const d = drafts[groupId]
    if (!d) return
    try {
      saveAddon(groupId, null, d.name, Number(d.price) || 0)
      setDrafts((prev) => ({ ...prev, [groupId]: { name: '', price: '' } }))
      setError(null)
      refresh()
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <div testId="addons-view" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, padding: 24 }}>
      <text style={{ fontSize: 20, fontWeight: 700, color: C.text, paddingBottom: 10 }}>Addon groups</text>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center', paddingBottom: 14 }}>
        <input testId="group-name" value={groupName} placeholder="Group name" onChange={(e) => setGroupName(e.value ?? '')}
          style={{ height: 32, width: 160, borderRadius: 7, borderWidth: 1, borderColor: C.border, paddingLeft: 9, fontSize: 13, color: C.text }} />
        <div testId="group-required" onClick={() => setRequired(!required)} style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
          <div style={{ width: 15, height: 15, borderRadius: 4, borderWidth: 1, borderColor: required ? C.primary : C.border, backgroundColor: required ? C.primary : 'transparent' }} />
          <text style={{ fontSize: 12.5, color: C.muted }}>Required</text>
        </div>
        <div testId="group-add" onClick={addGroup} style={{ ...btn, backgroundColor: C.primary }}>
          <text style={{ fontSize: 13, color: C.onPrimary }}>+ Group</text>
        </div>
        {error && <text style={{ fontSize: 12, color: C.danger }}>{error}</text>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'scroll' }}>
        {groups.map((g) => {
          const d = drafts[g.id] ?? { name: '', price: '' }
          return (
            <div key={g.id} testId={`group-${g.name}`} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <text style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
                {g.name}{g.is_required ? ' *' : ''}
              </text>
              {rows.filter((a) => a.addon_group_id === g.id).map((a) => (
                <text key={a.id} style={{ fontSize: 13, color: C.muted, paddingLeft: 12 }}>
                  • {a.name} (+{a.price})
                </text>
              ))}
              <div style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center', paddingLeft: 12 }}>
                <input value={d.name} placeholder="Addon name" onChange={(e) => setDrafts({ ...drafts, [g.id]: { ...d, name: e.value ?? '' } })}
                  style={{ height: 30, width: 150, borderRadius: 7, borderWidth: 1, borderColor: C.border, paddingLeft: 9, fontSize: 12.5, color: C.text }} />
                <input value={d.price} placeholder="Price" onChange={(e) => setDrafts({ ...drafts, [g.id]: { ...d, price: e.value ?? '' } })}
                  style={{ height: 30, width: 80, borderRadius: 7, borderWidth: 1, borderColor: C.border, paddingLeft: 9, fontSize: 12.5, color: C.text }} />
                <div onClick={() => addAddon(g.id)} style={{ ...btn }}>
                  <text style={{ fontSize: 12.5, color: C.primary }}>+ Addon</text>
                </div>
              </div>
            </div>
          )
        })}
        {groups.length === 0 && <text style={{ fontSize: 13, color: C.muted }}>No addon groups configured</text>}
      </div>
    </div>
  )
}

function queryGroups(): Group[] {
  return getDb()
    .prepare('SELECT id, name, is_required FROM addon_groups WHERE is_active = 1 ORDER BY sort_order')
    .all() as Group[]
}
function queryRows(): Row[] {
  return getDb()
    .prepare('SELECT id, addon_group_id, name, price FROM addons WHERE is_active = 1 ORDER BY sort_order')
    .all() as Row[]
}

const btn = {
  paddingHorizontal: 10,
  paddingTop: 5,
  paddingBottom: 5,
  borderRadius: 7,
  cursor: 'pointer' as const,
  display: 'flex' as const,
  alignItems: 'center' as const,
}
