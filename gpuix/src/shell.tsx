import React from 'react'
import type { Session } from './features/auth/auth'
import { C } from './shared/theme'

type Role = string

/** Mirrors shared/role-permissions.ts groups (subset used by these views). */
export const NAV_ITEMS: { id: string; label: string; roles: Role[] }[] = [
  { id: 'dashboard', label: 'Dashboard', roles: ['owner', 'manager'] },
  { id: 'pos', label: 'New order', roles: ['owner', 'manager', 'cashier', 'server'] },
  { id: 'orders', label: 'Orders', roles: ['owner', 'manager', 'cashier', 'server', 'chef'] },
  { id: 'kds', label: 'Kitchen', roles: ['owner', 'manager', 'chef'] },
  { id: 'tables', label: 'Tables', roles: ['owner', 'manager', 'cashier', 'server'] },
  { id: 'products', label: 'Products', roles: ['owner', 'manager'] },
  { id: 'addons', label: 'Addons', roles: ['owner', 'manager'] },
  { id: 'customers', label: 'Customers', roles: ['owner', 'manager', 'cashier', 'server'] },
  { id: 'staff', label: 'Staff', roles: ['owner', 'manager'] },
  { id: 'settings', label: 'Settings', roles: ['owner', 'manager'] },
]

export function allowedViews(role: Role): string[] {
  return NAV_ITEMS.filter((n) => n.roles.includes(role)).map((n) => n.id)
}

export type ViewId = string

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
  const items = NAV_ITEMS.filter((n) => n.roles.includes(session.user.role))
  return (
    <div style={{ display: 'flex', flexDirection: 'row', width: '100%', height: '100%' }}>
      <div
        style={{
          width: WIDTH,
          flexShrink: 0,
          height: '100%',
          backgroundColor: C.sidebar,
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
        <text style={{ fontSize: 12, color: C.tertiary, paddingLeft: 8, paddingBottom: 14 }}>
          {session.user.name} · {session.user.role}
        </text>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1 }}>
          {items.map((item) => {
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
                  backgroundColor: selected ? C.navActive : 'transparent',
                  hover: { backgroundColor: C.item },
                }}
              >
                <text style={{ fontSize: 13.5, fontWeight: selected ? 600 : 400, color: selected ? C.primary : C.muted }}>
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
