import React, { useState } from 'react'
import { loadSession, type Session } from './features/auth/auth'
import { LoginView } from './features/auth/login-view'
import { Shell, allowedViews, type ViewId } from './shell'
import { DashboardView } from './features/dashboard/dashboard-view'
import { PosView } from './features/pos/pos-view'
import { ProductsView } from './features/products/products-list-view'
import { AddonsView } from './features/products/addons-view'
import { OrdersView } from './features/orders/orders-list-view'
import { KdsView } from './features/kds/kds-view'
import { TablesView } from './features/tables/tables-view'
import { CustomersView } from './features/customers/customers-view'
import { StaffView } from './features/staff/staff-view'
import { SettingsView } from './features/settings/settings-view'

function Home({ session }: { session: Session }) {
  const [view, setView] = useState<ViewId>(() => allowedViews(session.user.role)[0] ?? 'dashboard')
  const currency = session.store.currencySymbol
  const content =
    view === 'pos' ? (
      <PosView currencySymbol={currency} />
    ) : view === 'products' ? (
      <ProductsView currencySymbol={currency} />
    ) : view === 'addons' ? (
      <AddonsView />
    ) : view === 'orders' ? (
      <OrdersView currencySymbol={currency} />
    ) : view === 'kds' ? (
      <KdsView />
    ) : view === 'tables' ? (
      <TablesView />
    ) : view === 'customers' ? (
      <CustomersView />
    ) : view === 'staff' ? (
      <StaffView />
    ) : view === 'settings' ? (
      <SettingsView />
    ) : (
      <DashboardView currencySymbol={currency} />
    )
  return (
    <Shell session={session} active={view} onNavigate={setView}>
      {content}
    </Shell>
  )
}

export function App() {
  const [session, setSession] = useState<Session | null>(loadSession())
  if (!session) return <LoginView onLogin={setSession} />
  return <Home session={session} />
}
