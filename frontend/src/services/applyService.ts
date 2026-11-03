/**
 * HTTP client of the standalone admission application (/apply/:slug). It is a separate axios instance with its own
 * token storage (sessionStorage of this tab, `eduai.apply.*`): the LMS client, its JWTs and its refresh logic are never
 * used here, and applicant tokens never reach LMS endpoints (the server refuses them anyway — separate audience).
 */
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import type { Answers, ApplicationStatus, FormDefinition } from '@/lib/admissionForm'
import { AXIOS_BASE } from '@/lib/apiBase'

const BASE = '/ICMELive/api/v1/apply'
const K = { access: 'eduai.apply.access', refresh: 'eduai.apply.refresh', slug: 'eduai.apply.slug', done: 'eduai.apply.done' }
export const APPLY_LOGOUT_EVENT = 'eduai-apply:logout'

const ss = {
  get: (k: string) => { try { return sessionStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { sessionStorage.setItem(k, v) } catch { /* storage unavailable */ } },
  del: (k: string) => { try { sessionStorage.removeItem(k) } catch { /* storage unavailable */ } },
}

export const applyStore = {
  /** Tokens are bound to one application form: a different slug in the URL means "not signed in". */
  access(slug: string) { return ss.get(K.slug) === slug ? ss.get(K.access) : null },
  refresh(slug: string) { return ss.get(K.slug) === slug ? ss.get(K.refresh) : null },
  set(slug: string, access: string, refresh: string) { ss.set(K.slug, slug); ss.set(K.access, access); ss.set(K.refresh, refresh) },
  clear() { ss.del(K.access); ss.del(K.refresh); ss.del(K.slug) },
  /** The confirmation survives the end of the session (the credential is removed on submission). */
  saveDone(d: DoneInfo) { ss.set(K.done, JSON.stringify(d)) },
  done(slug: string): DoneInfo | null {
    try { const d = JSON.parse(ss.get(K.done) ?? 'null') as DoneInfo | null; return d && d.slug === slug ? d : null } catch { return null }
  },
}
export interface DoneInfo { slug: string; reference_no: string; status: ApplicationStatus; at: string; test?: boolean }

export const applyApi = axios.create({ baseURL: AXIOS_BASE })
const slugOf = (url?: string) => /\/apply\/([a-z0-9-]+)/.exec(url ?? '')?.[1] ?? ''

applyApi.interceptors.request.use((cfg) => {
  cfg.headers.delete('Authorization')
  const t = applyStore.access(slugOf(cfg.url))
  if (t) cfg.headers.set('Authorization', `Bearer ${t}`)
  return cfg
})

let refreshing: Promise<string | null> | null = null
async function refreshAccess(slug: string): Promise<string | null> {
  const rt = applyStore.refresh(slug)
  if (!rt) return null
  try {
    const { data } = await axios.post<Tokens>(`${BASE}/${slug}/refresh`, { refresh_token: rt })
    applyStore.set(slug, data.access_token, data.refresh_token)
    return data.access_token
  } catch {
    applyStore.clear()
    return null
  }
}

applyApi.interceptors.response.use((r) => r, async (err: AxiosError) => {
  const cfg = err.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined
  const slug = slugOf(cfg?.url)
  const publicCall = /\/(login|refresh|recovery|track)$/.test(cfg?.url ?? '')
  if (err.response?.status === 401 && cfg && !cfg._retry && !publicCall && slug) {
    cfg._retry = true
    refreshing ??= refreshAccess(slug).finally(() => { refreshing = null })
    if (await refreshing) return applyApi(cfg)
    window.dispatchEvent(new Event(APPLY_LOGOUT_EVENT))
  }
  return Promise.reject(err)
})

export interface Tokens { access_token: string; refresh_token: string; expires_in: number; session_expires_at: string }
export interface PublicInfo {
  school: { name: string; accent: string | null; logo_url: string | null }
  form: { title: string; description: string | null; academic_year: string | null; grades: { value: number; label: string }[]; instructions: string
    opens_at: string | null; closes_at: string | null; state: 'open' | 'closed' | 'not_open'; has_test: boolean
    documents: { label: string; required: boolean }[] }
}
export interface ApplyDocument { document_id: string; requirement_key: string; filename: string; mime: string; size_bytes: number; uploaded_at: string }
export interface Me {
  application: { status: ApplicationStatus; status_label: string; reference_no: string | null; answers: Answers; last_saved_at: string | null
    submitted_at: string | null; editable: boolean; submission_count: number }
  form: { title: string; version: number | null; definition: FormDefinition; grades: { value: number; label: string }[]; closes_at: string | null; has_test: boolean }
  documents: ApplyDocument[]
  corrections: { to_status: string; note: string | null; created_at: string }[]
  credential: { username: string; expires_at: string } | null
  consent: { version_id: string; version: number; language: string; title: string; body: string } | null
  test: { title: string; duration_minutes: number; instructions: string | null; available: boolean; session_status: string | null; locked: boolean } | null
}
export interface SubmitResult { status: ApplicationStatus; status_label: string; reference_no: string; credential_removed: boolean; test_required: boolean }
export interface TrackResult { reference_no: string; status: ApplicationStatus; status_label: string; submitted_at: string | null; updated_at: string }

const u = (slug: string, p = '') => `${BASE}/${slug}${p}`

export const applyService = {
  info: async (slug: string, signal?: AbortSignal) => (await axios.get<PublicInfo>(u(slug), { signal })).data,
  login: async (slug: string, username: string, password: string) => {
    const { data } = await axios.post<Tokens>(u(slug, '/login'), { username, password })
    applyStore.set(slug, data.access_token, data.refresh_token)
    return data
  },
  logout: async (slug: string) => {
    try { await applyApi.post(u(slug, '/logout')) } finally { applyStore.clear() }
  },
  recovery: async (slug: string, body: { username: string; contact: string; message?: string; website?: string }) =>
    (await axios.post<{ message: string }>(u(slug, '/recovery'), body)).data,
  track: async (slug: string, reference_no: string, date_of_birth: string) =>
    (await axios.post<TrackResult>(u(slug, '/track'), { reference_no, date_of_birth })).data,
  me: async (slug: string, signal?: AbortSignal) => (await applyApi.get<Me>(u(slug, '/me'), { signal })).data,
  saveAnswers: async (slug: string, answers: Answers) =>
    (await applyApi.put<{ saved_at: string; answers: Answers }>(u(slug, '/me/answers'), { answers })).data,
  upload: async (slug: string, requirementKey: string, file: File, onProgress?: (pct: number) => void) => {
    const fd = new FormData()
    fd.append('requirement_key', requirementKey)
    fd.append('file', file)
    return (await applyApi.post<ApplyDocument>(u(slug, '/me/documents'), fd, {
      onUploadProgress: (e) => onProgress?.(e.total ? Math.round((e.loaded / e.total) * 100) : 0),
    })).data
  },
  deleteDocument: async (slug: string, id: string) => (await applyApi.delete(u(slug, `/me/documents/${id}`))).data,
  documentBlob: async (slug: string, id: string) => (await applyApi.get<Blob>(u(slug, `/me/documents/${id}`), { responseType: 'blob' })).data,
  submit: async (slug: string, body: { declaration: boolean; consent_version_id: string | null; consent_confirm: boolean }) =>
    (await applyApi.post<SubmitResult>(u(slug, '/me/submit'), body)).data,
  launchTest: async (slug: string, body: { device_id: string; guardian_consent: { guardian_name: string; relationship: string; confirm: boolean } | null }) =>
    (await applyApi.post<{ session_id: string; exam_token: string; expires_at: string; status: string }>(u(slug, '/me/test/launch'), body)).data,
}

/** Field-level errors from a 422 submission response, if any. */
export function submitErrors(e: unknown): Record<string, string> | null {
  if (!axios.isAxiosError(e)) return null
  const d = (e.response?.data as { detail?: { errors?: { field: string; message: string }[] } } | undefined)?.detail
  if (!d || typeof d !== 'object' || !Array.isArray(d.errors)) return null
  return Object.fromEntries(d.errors.map((x) => [x.field, x.message]))
}
