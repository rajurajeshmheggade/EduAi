import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import axios from 'axios'
import { api, tokenStore } from '@/services/apiClient'
import type { AuthResponse, UserProfile } from '@/types'

interface AuthState {
  user: UserProfile | null
  loading: boolean
  login: (email: string, password: string) => Promise<UserProfile>
  logout: () => void
  /** Re-read the profile from the server (e.g. after changing the password). */
  refreshUser: () => Promise<void>
  /** Currently selected subject workspace (teachers/students pick from allowed_subjects). */
  subject: string | null
  setSubject: (s: string) => void
}

const Ctx = createContext<AuthState | null>(null)
const SUBJECT_KEY = 'eduai.subject'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState<boolean>(() => !!tokenStore.access)
  const [subject, setSubjectState] = useState<string | null>(() => localStorage.getItem(SUBJECT_KEY))

  const logout = useCallback(() => {
    tokenStore.clear()
    setUser(null)
  }, [])

  // Rehydrate from a stored JWT — the server is the source of truth (no sessionStorage.isLogin flag).
  useEffect(() => {
    if (!tokenStore.access) return
    let alive = true
    api.get<UserProfile>('/api/v1/auth/me')
      .then((r) => alive && setUser(r.data))
      .catch(() => alive && tokenStore.clear())
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [])

  useEffect(() => {
    window.addEventListener('eduai:logout', logout)
    return () => window.removeEventListener('eduai:logout', logout)
  }, [logout])

  // Keep the selected subject valid for the signed-in user.
  useEffect(() => {
    if (!user) return
    const allowed = user.allowed_subjects
    if (allowed.length && (!subject || !allowed.includes(subject))) {
      setSubjectState(allowed[0])
      localStorage.setItem(SUBJECT_KEY, allowed[0])
    }
  }, [user, subject])

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await axios.post<AuthResponse>('/api/v1/auth/login', { email, password })
    tokenStore.set(data.access_token, data.refresh_token)
    setUser(data.user)
    return data.user
  }, [])

  const refreshUser = useCallback(async () => {
    const { data } = await api.get<UserProfile>('/api/v1/auth/me')
    setUser(data)
  }, [])

  const setSubject = useCallback((s: string) => {
    setSubjectState(s)
    localStorage.setItem(SUBJECT_KEY, s)
  }, [])

  const value = useMemo(() => ({ user, loading, login, logout, refreshUser, subject, setSubject }),
    [user, loading, login, logout, refreshUser, subject, setSubject])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>')
  return v
}
