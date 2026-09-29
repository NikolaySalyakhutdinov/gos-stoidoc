import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  apiFetch,
  clearSession,
  getRefreshToken,
  getToken,
  refreshSession,
  setSession,
} from '../api/client'

const Ctx = createContext(null)
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const handleExpired = () => {
      setUser(null)
      setLoading(false)
    }

    window.addEventListener('auth:expired', handleExpired)

    const token = getToken()
    const refreshToken = getRefreshToken()
    if (!token && !refreshToken) {
      setLoading(false)
      return () => window.removeEventListener('auth:expired', handleExpired)
    }

    apiFetch('/api/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => {
        clearSession()
        setUser(null)
      })
      .finally(() => setLoading(false))

    return () => window.removeEventListener('auth:expired', handleExpired)
  }, [])

  useEffect(() => {
    if (!user || !getRefreshToken()) return undefined

    const timer = window.setInterval(() => {
      refreshSession().catch(() => {
        clearSession()
        setUser(null)
      })
    }, REFRESH_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [user])

  const api = useMemo(
    () => ({
      currentUser: user,
      isAuthenticated: !!user,
      authLoading: loading,

      async signIn(email, password) {
        try {
          const data = await apiFetch('/api/auth/login', { method: 'POST', body: { email, password } })
          setSession(data)
          setUser(data.user)
          return { ok: true }
        } catch (err) {
          return { ok: false, error: err.message }
        }
      },

      async signUp({ name, email, password, role, org }) {
        try {
          const data = await apiFetch('/api/auth/register', { method: 'POST', body: { name, email, password, role, org } })
          setSession(data)
          setUser(data.user)
          return { ok: true }
        } catch (err) {
          return { ok: false, error: err.message }
        }
      },

      signOut() {
        clearSession()
        setUser(null)
      },

      async updateProfile(patch) {
        try {
          const data = await apiFetch('/api/auth/me', { method: 'PATCH', body: patch })
          setUser(data.user)
          return { ok: true }
        } catch (err) {
          return { ok: false, error: err.message }
        }
      },

      async updateNotifPrefs(patch) {
        try {
          const data = await apiFetch('/api/auth/me/notifications', { method: 'PATCH', body: patch })
          setUser(data.user)
          return { ok: true }
        } catch (err) {
          return { ok: false, error: err.message }
        }
      },

      async changePassword(current, next) {
        try {
          await apiFetch('/api/auth/change-password', { method: 'POST', body: { current, next } })
          return { ok: true }
        } catch (err) {
          return { ok: false, error: err.message }
        }
      },

      async requestPasswordReset(email) {
        try {
          await apiFetch('/api/auth/forgot-password', { method: 'POST', body: { email } })
          return { ok: true }
        } catch (err) {
          return { ok: false, error: err.message }
        }
      },
    }),
    [user, loading]
  )

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
