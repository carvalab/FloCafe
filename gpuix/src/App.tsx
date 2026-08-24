import React, { useState } from 'react'
import { loadSession, type Session } from './lib/auth'
import { LoginView } from './views/login'
import { Shell, type ViewId } from './views/shell'
import { DashboardView } from './views/dashboard'
import { ProductsView } from './views/products'
import { OrdersView } from './views/orders'
import { PosView } from './views/pos'
import { CustomersView } from './views/customers'
import { StaffView } from './views/staff'
import { C } from './theme'

function Home({ session }: { session: Session }) {
  const [view, setView] = useState<ViewId>('dashboard')
  const content =
    view === 'pos' ? (
      <PosView currencySymbol={session.store.currencySymbol} />
    ) : view === 'products' ? (
      <ProductsView currencySymbol={session.store.currencySymbol} />
    ) : view === 'orders' ? (
      <OrdersView currencySymbol={session.store.currencySymbol} />
    ) : view === 'customers' ? (
      <CustomersView />
    ) : view === 'staff' ? (
      <StaffView />
    ) : (
      <DashboardView currencySymbol={session.store.currencySymbol} />
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
