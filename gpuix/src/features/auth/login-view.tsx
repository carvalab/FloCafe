import React, { useState } from 'react'
import { login, type Session } from './auth'
import { C } from '../../shared/theme'

export function LoginView({ onLogin }: { onLogin: (session: Session) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!email || !password) return setError('Enter email and password')
    setError(null)
    try {
      const session = await login(email, password)
      if (remember) rememberSession(session)
      onLogin(session)
    } catch (e: any) {
      setError(e.message ?? 'Login failed')
    }
  }

  return (
    <div
      testId="login-screen"
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: C.bg,
        alignItems: 'center',
        justifyContent: 'center',
        display: 'flex',
      }}
    >
      <div
        style={{
          width: 360,
          backgroundColor: C.card,
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: 12,
          paddingTop: 28,
          paddingBottom: 28,
          paddingLeft: 24,
          paddingRight: 24,
          gap: 14,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <text style={{ fontSize: 22, fontWeight: 700, color: C.text }}>Flo</text>
        <text style={{ fontSize: 13, color: C.muted }}>Sign in to your store</text>

        <input
          testId="login-email"
          value={email}
          placeholder="Email"
          onChange={(e) => setEmail(e.value ?? '')}
          onSubmit={submit}
          style={{
            height: 38,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: C.border,
            paddingLeft: 10,
            paddingRight: 10,
            fontSize: 14,
            color: C.text,
          }}
        />
        <input
          testId="login-password"
          value={password}
          placeholder="Password"
          secureTextEntry
          onChange={(e) => setPassword(e.value ?? '')}
          onSubmit={submit}
          style={{
            height: 38,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: C.border,
            paddingLeft: 10,
            paddingRight: 10,
            fontSize: 14,
            color: C.text,
          }}
        />
        <div style={{ flexDirection: 'row', gap: 8, alignItems: 'center', display: 'flex' }}>
          <div
            testId="login-remember"
            onClick={() => setRemember(!remember)}
            style={{
              width: 16,
              height: 16,
              borderRadius: 4,
              borderWidth: 1,
              borderColor: remember ? C.primary : C.border,
              backgroundColor: remember ? C.primary : 'transparent',
            }}
          />
          <text style={{ fontSize: 13, color: C.muted }} onClick={() => setRemember(!remember)}>
            Remember me
          </text>
        </div>

        {error && <text testId="login-error" style={{ fontSize: 13, color: C.danger }}>{error}</text>}

        <div
          testId="login-submit"
          onClick={submit}
          style={{
            height: 40,
            borderRadius: 8,
            backgroundColor: C.primary,
            alignItems: 'center',
            justifyContent: 'center',
            display: 'flex',
            cursor: 'pointer',
            hover: { opacity: 0.9 },
          }}
        >
          <text style={{ fontSize: 14, fontWeight: 600, color: C.onPrimary }}>Sign in</text>
        </div>
      </div>
    </div>
  )
}
