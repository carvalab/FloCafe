import React, { useState } from 'react'
import { getDb, settings as loadSettings } from '../../shared/db'
import { C } from '../../shared/theme'

// The keys the native app reads/writes today. Everything else in settings
// stays untouched — data safety first.
const EDITABLE = [
  { key: 'business_name', label: 'Business name' },
  { key: 'currency_symbol', label: 'Currency symbol' },
  { key: 'timezone', label: 'Timezone (IANA)' },
  { key: 'order_number_prefix', label: 'Order number prefix' },
] as const

function saveSetting(key: string, value: string) {
  getDb()
    .prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    )
    .run(key, value)
}

/** ponytail: free-text settings form; validation arrives with real parity needs. */
export function SettingsView() {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const s = loadSettings()
    return Object.fromEntries(EDITABLE.map(({ key }) => [key, s[key] ?? '']))
  })
  const [saved, setSaved] = useState(false)

  const save = () => {
    for (const { key } of EDITABLE) saveSetting(key, values[key] ?? '')
    setSaved(true)
  }

  return (
    <div testId="settings-view" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, padding: 24, maxWidth: 480, gap: 14 }}>
      <text style={{ fontSize: 20, fontWeight: 700, color: C.text }}>Settings</text>
      {EDITABLE.map(({ key, label }) => (
        <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <text style={{ fontSize: 13, color: C.muted }}>{label}</text>
          <input
            testId={`setting-${key}`}
            value={values[key]}
            onChange={(e) => {
              setValues((v) => ({ ...v, [key]: e.value ?? '' }))
              setSaved(false)
            }}
            style={{
              height: 36,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: C.border,
              paddingLeft: 10,
              paddingRight: 10,
              fontSize: 14,
              color: C.text,
            }}
          />
        </div>
      ))}
      <div
        testId="settings-save"
        onClick={save}
        style={{
          height: 38,
          borderRadius: 8,
          backgroundColor: C.primary,
          alignItems: 'center',
          justifyContent: 'center',
          display: 'flex',
          cursor: 'pointer',
        }}
      >
        <text style={{ fontSize: 14, fontWeight: 600, color: C.onPrimary }}>{saved ? 'Saved' : 'Save'}</text>
      </div>
    </div>
  )
}
