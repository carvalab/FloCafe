import React from 'react'
import { getDb } from '../../shared/db'
import { C } from '../../shared/theme'

function count(sql: string): number {
  return (getDb().prepare(sql).get() as any)?.n ?? 0
}

/** Headline numbers. One query per stat, no caching — sqlite is local. */
export function DashboardView({ currencySymbol }: { currencySymbol: string }) {
  const products = count('SELECT COUNT(*) AS n FROM products WHERE is_active = 1')
  const ordersToday = count(
    "SELECT COUNT(*) AS n FROM orders WHERE date(created_at) = date('now', 'localtime')",
  )
  const revenueToday = (
    (getDb()
      .prepare(
        "SELECT COALESCE(SUM(total), 0) AS n FROM orders WHERE date(created_at) = date('now', 'localtime') AND status != 'cancelled'",
      )
      .get() as any)?.n ?? 0
  ).toFixed(2)

  const stats = [
    { label: 'Active products', value: String(products) },
    { label: 'Orders today', value: String(ordersToday) },
    { label: 'Revenue today', value: `${currencySymbol}${revenueToday}` },
  ]

  return (
    <div testId="dashboard-view" style={{ display: 'flex', flexDirection: 'column', padding: 24, gap: 16, flexGrow: 1 }}>
      <text style={{ fontSize: 20, fontWeight: 700, color: C.text }}>Dashboard</text>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 14 }}>
        {stats.map((s) => (
          <div
            key={s.label}
            style={{
              flexGrow: 1,
              backgroundColor: C.card,
              borderWidth: 1,
              borderColor: C.border,
              borderRadius: 10,
              padding: 16,
              gap: 6,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <text style={{ fontSize: 13, color: C.muted }}>{s.label}</text>
            <text style={{ fontSize: 22, fontWeight: 700, color: C.text }}>{s.value}</text>
          </div>
        ))}
      </div>
    </div>
  )
}
