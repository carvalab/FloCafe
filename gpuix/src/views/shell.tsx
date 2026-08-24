import React from 'react'
import type { Session } from '../lib/auth'
import { C } from '../theme'

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'pos', label: 'New order' },
  { id: 'products', label: 'Products' },
  { id: 'orders', label: 'Orders' },
  { id: 'customers', label: 'Customers' },
  { id: 'staff', label: 'Staff' },
] as const

export type ViewId = (typeof NAV_ITEMS)[number]['id']

const WIDTH = 220

/** Sidebar + content layout. One scroll container lives in each view, never here. */
export function Shell({
  session,
  active,
  onNavigate,
  children,
}: {
  session: Session
  active: ViewId
  onNavigate: (id: ViewId) => void
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', width: '100%', height: '100%' }}>
      <div
        style={{
          width: WIDTH,
          flexShrink: 0,
          height: '100%',
          backgroundColor: '#181818',
          borderRightWidth: 1,
          borderRightColor: C.border,
          display: 'flex',
          flexDirection: 'column',
          paddingTop: 16,
          paddingBottom: 12,
          paddingLeft: 10,
          paddingRight: 10,
        }}
      >
        <text style={{ fontSize: 17, fontWeight: 700, color: C.text, paddingLeft: 8 }}>
          {session.store.name}
        </text>
        <text style={{ fontSize: 12, color: C.tertiary ?? C.muted, paddingLeft: 8, paddingBottom: 14 }}>
          {session.user.name} · {session.user.role}
        </text>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1 }}>
          {NAV_ITEMS.map((item) => {
            const selected = item.id === active
            return (
              <div
                key={item.id}
                testId={`nav-${item.id}`}
                onClick={() => onNavigate(item.id)}
                style={{
                  height: 34,
                  borderRadius: 7,
                  display: 'flex',
                  alignItems: 'center',
                  paddingLeft: 10,
                  cursor: 'pointer',
                  backgroundColor: selected ? C.item : 'transparent',
                  hover: { backgroundColor: C.item },
                }}
              >
                <text style={{ fontSize: 13.5, fontWeight: selected ? 600 : 400, color: selected ? C.text : C.muted }}>
                  {item.label}
                </text>
              </div>
            )
          })}
        </div>
      </div>
      <div style={{ flexGrow: 1, minWidth: 0, height: '100%' }}>{children}</div>
    </div>
  )
}
