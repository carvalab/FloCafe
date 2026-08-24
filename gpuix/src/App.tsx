import React, { useState } from 'react'
import { loadSession, type Session } from './lib/auth'
import { LoginView } from './views/login'
import { C } from './theme'

export function App() {
  const [session, setSession] = useState<Session | null>(loadSession())
  if (!session) return <LoginView onLogin={setSession} />
  return (
    <div
      testId="home-view"
      style={{ width: '100%', height: '100%', backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', display: 'flex' }}
    >
      <text testId="welcome" style={{ fontSize: 18, color: C.text }}>
        {session.store.name} — {session.user.name}
      </text>
    </div>
  )
}
