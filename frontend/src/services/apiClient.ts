/** Unified Axios client with JWT interceptor + single-flight refresh (replaces sessionStorage.isLogin flags). */
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import type { AuthResponse } from '@/types'

const ACCESS = 'eduai.access'
const REFRESH = 'eduai.refresh'

export const tokenStore = {
  get access() { return localStorage.getItem(ACCESS) },
  get refresh() { return localStorage.getItem(REFRESH) },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS, access)
    localStorage.setItem(REFRESH, refresh)
  },
  clear() {
    localStorage.removeItem(ACCESS)
    localStorage.removeItem(REFRESH)
  },
}

export const api = axios.create({ baseURL: '/' })

api.interceptors.request.use((cfg) => {
  const t = tokenStore.access
  if (t) cfg.headers.set('Authorization', `Bearer ${t}`)
  return cfg
})

let refreshing: Promise<string | null> | null = null

async function refreshAccess(): Promise<string | null> {
  const rt = tokenStore.refresh
  if (!rt) return null
  try {
    const { data } = await axios.post<AuthResponse>('/api/v1/auth/refresh', { refresh_token: rt })
    tokenStore.set(data.access_token, data.refresh_token)
    return data.access_token
  } catch {
    tokenStore.clear()
    return null
  }
}

api.interceptors.response.use(
  (r) => r,
  async (err: AxiosError) => {
    const cfg = err.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined
    const isAuthCall = cfg?.url?.includes('/auth/')
    if (err.response?.status === 401 && cfg && !cfg._retry && !isAuthCall) {
      cfg._retry = true
      refreshing ??= refreshAccess().finally(() => { refreshing = null })
      const token = await refreshing
      if (token) {
        cfg.headers.set('Authorization', `Bearer ${token}`)
        return api(cfg)
      }
      window.dispatchEvent(new Event('eduai:logout'))
    }
    return Promise.reject(err)
  },
)

export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(e)) {
    const d = e.response?.data as { detail?: unknown } | undefined
    if (typeof d?.detail === 'string') return d.detail
    if (Array.isArray(d?.detail)) return d.detail.map((x: { msg?: string }) => x.msg).filter(Boolean).join('; ')
    return e.message
  }
  return e instanceof Error ? e.message : fallback
}
