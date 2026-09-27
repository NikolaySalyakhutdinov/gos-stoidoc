import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { apiFetch, getToken, setToken } from '../api/client'

const Ctx = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) {
      setLoading(false)
      return
    }
    apiFetch('/api/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false))
  }, [])

  const api = useMemo(
    () => ({
      currentUser: user,
      isAuthenticated: !!user,
      authLoading: loading,

      async signIn(email, password) {
        try {
          const data = await apiFetch('/api/auth/login', { method: 'POST', body: { email, password } })
          setToken(data.token)
          setUser(data.user)
          return { ok: true }
        } catch (err) {
          return { ok: false, error: err.message }
        }
      },

      async signUp({ name, email, password, role, org }) {
        try {
          const data = await apiFetch('/api/auth/register', { method: 'POST', body: { name, email, password, role, org } })
          setToken(data.token)
          setUser(data.user)
          return { ok: true }
        } catch (err) {
          return { ok: false, error: err.message }
        }
      },

      signOut() {
        setToken(null)
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
