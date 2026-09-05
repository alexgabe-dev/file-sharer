'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { authLogin, authLogout, authSession } from '@/lib/api/client'

type AuthStatus = 'loading' | 'unauthenticated' | 'authenticated'

type AuthState = {
  status: AuthStatus
  login: (password: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')

  const refresh = useCallback(async () => {
    try {
      const session = await authSession()
      setStatus(session.authenticated ? 'authenticated' : 'unauthenticated')
    } catch {
      setStatus('unauthenticated')
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const login = useCallback(async (password: string) => {
    await authLogin(password)
    await refresh()
  }, [refresh])

  const logout = useCallback(async () => {
    try { await authLogout() } catch { /* ignore */ }
    setStatus('unauthenticated')
  }, [])

  return <AuthContext.Provider value={{ status, login, logout, refresh }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
