import React, { useState } from 'react'
import { loadSession, type Session } from './lib/auth'
import { LoginView } from './views/login'
import { Shell, allowedViews, type ViewId } from './views/shell'
import { DashboardView } from './views/dashboard'
import { PosView } from './views/pos'
import { ProductsView } from './views/products'
import { OrdersView } from './views/orders'
import { KdsView } from './views/kds'
import { TablesView } from './views/tables'
import { CustomersView } from './views/customers'
import { StaffView } from './views/staff'
import { SettingsView } from './views/settings'

function Home({ session }: { session: Session }) {
  const [view, setView] = useState<ViewId>(() => allowedViews(session.user.role)[0] ?? 'dashboard')
  const currency = session.store.currencySymbol
  const content =
    view === 'pos' ? (
      <PosView currencySymbol={currency} />
    ) : view === 'products' ? (
      <ProductsView currencySymbol={currency} />
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
