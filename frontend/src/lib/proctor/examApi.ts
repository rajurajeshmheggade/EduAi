import axios from 'axios'
import type { FlagCode } from './rules'

/**
 * The exam view's HTTP client. It sends ONLY the exam token, device id and page id — never the teacher's JWT (the
 * shared `api` client is not used anywhere on the exam route). The token lives in sessionStorage of the exam tab.
 */
const BASE = '/ICMELive/api/v1/admission/session'
const K = { token: 'eduai.exam.token', device: 'eduai.exam.device', session: 'eduai.exam.session', seq: 'eduai.exam.seq' }

const rand = (n: number) => {
  const a = new Uint8Array(n)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}

export const newDeviceId = () => `dev-${rand(16)}`
/** One id per page load: the server lets one page at a time drive the session. */
export const PAGE_ID = `page-${rand(12)}`

export const examStore = {
  save(sessionId: string, token: string, device: string) {
    sessionStorage.setItem(K.session, sessionId)
    sessionStorage.setItem(K.token, token)
    sessionStorage.setItem(K.device, device)
  },
  get(): { sessionId: string; token: string; device: string } | null {
    const sessionId = sessionStorage.getItem(K.session)
    const token = sessionStorage.getItem(K.token)
    const device = sessionStorage.getItem(K.device)
    return sessionId && token && device ? { sessionId, token, device } : null
  },
  clear() { Object.values(K).forEach((k) => sessionStorage.removeItem(k)) },
  /** Monotonic event sequence per session, kept across reloads (the server is idempotent by seq). */
  nextSeq(): number {
    const n = Number(sessionStorage.getItem(K.seq) ?? '0') + 1
    sessionStorage.setItem(K.seq, String(n))
    return n
  },
}

export const examApi = axios.create({ baseURL: '/' })
examApi.interceptors.request.use((cfg) => {
  const s = examStore.get()
  if (s) {
    cfg.headers.set('X-Exam-Token', s.token)
    cfg.headers.set('X-Device-Id', s.device)
  }
  cfg.headers.set('X-Page-Id', PAGE_ID)
  cfg.headers.delete('Authorization')
  return cfg
})

export type ExamStatus = 'LAUNCHED' | 'CONFIRMED' | 'CHECKED' | 'IN_PROGRESS' | 'SUBMITTED' | 'ENDED' | 'LOCKED'
export interface StatusInfo {
  status: ExamStatus
  submit_reason: 'MANUAL' | 'TIME_UP' | 'AUTO_VIOLATION' | 'ENDED_BY_TEACHER' | null
  warnings_count: number
  max_warnings: number
  deadline_at: string | null
  server_time: string
  ended: boolean
  locked: boolean
  /** 'applicant' when the test was started from the standalone admission application. */
  origin?: 'teacher' | 'applicant'
}
export interface FlagRule { enabled: boolean; label: string; severity: 'Info' | 'Low' | 'Med' | 'High' | 'Crit'; warn: 'always' | 'third' | 'never'; pause: boolean; evidence: 'webcam' | 'screen' | 'webcam_first' | null; duration_ms: number }
export interface ClientRules {
  preset: string
  max_warnings: number
  calibration_seconds: number
  require_camera: boolean
  require_screen_share: boolean
  face_fps: number
  object_fps: number
  face_match_interval_s: number
  face_match_threshold: number
  voice_db: number
  presence_snapshot_s: number
  flags: Record<string, FlagRule>
}
export interface ExamQuestion {
  question_id: string
  number: number
  section: string
  qtype: 'MCQ' | 'MULTI' | 'NUMERICAL' | 'SHORT' | 'DESCRIPTIVE' | 'SJT' | 'REFLECTIVE' | 'IDEAS'
  prompt: string
  options: { id: number; text: string }[]
  marks: number | null
}
export type ExamAnswer = { option?: number; options?: number[]; value?: string; text?: string }
export interface ConsentNotice { version: string; captured: string[]; not_captured: string[]; who_sees: string; retention: string; deletion: string; alternative: string }
export interface ExamView extends StatusInfo {
  session_id: string
  candidate: { full_name: string; first_name: string }
  test: { title: string; grade_applying: string; instructions: string | null; duration_minutes: number; extra_time_minutes: number
    sections: { key: string; title: string; kind: string; count: number }[] }
  rules: ClientRules
  consent_notice: ConsentNotice
  steps: { confirmed: boolean; consent: boolean; system_check: boolean; id_photo: boolean; started: boolean }
  started_at: string | null
  questions?: ExamQuestion[]
  answers?: Record<string, ExamAnswer | null>
}
export interface SystemCheck {
  secure_context: boolean
  screens_extended: boolean | null
  camera: boolean
  camera_label: string | null
  virtual_camera_suspected: boolean
  microphone: boolean
  face_ok: boolean
  screen_surface: string | null
  fullscreen: boolean
  network_ms: number | null
  models_ready: boolean
  browser: string | null
  screen: string | null
}
export interface WireEvent { seq: number; code: FlagCode; client_ts: string; duration_ms: number; confidence?: number; details?: Record<string, unknown> }
export interface Heartbeat { fullscreen: boolean; visible: boolean; faces: number | null; camera_live: boolean; screen_live: boolean; mic_live: boolean; online: boolean; answered: number; fps: number | null }

const d = <T>(p: Promise<{ data: T }>) => p.then((r) => r.data)

export const exam = {
  view: () => d(examApi.get<ExamView>(BASE)),
  claim: () => d(examApi.post<StatusInfo>(`${BASE}/claim`, { page_id: PAGE_ID })),
  /** Sent while the page unloads (keepalive) so a reload can claim the session again at once. */
  release() {
    const s = examStore.get()
    if (!s) return
    void fetch(`${BASE}/release`, { method: 'POST', keepalive: true, body: JSON.stringify({ page_id: PAGE_ID }),
      headers: { 'Content-Type': 'application/json', 'X-Exam-Token': s.token, 'X-Device-Id': s.device, 'X-Page-Id': PAGE_ID } }).catch(() => {})
  },
  confirm: (dob: string) => d(examApi.post<ExamView>(`${BASE}/confirm`, { dob })),
  consent: (version: string) => d(examApi.post<ExamView>(`${BASE}/consent`, { accepted: true, notice_version: version })),
  systemCheck: (c: SystemCheck) => d(examApi.post<ExamView>(`${BASE}/system-check`, c)),
  idPhoto: (photo: Blob) => {
    const fd = new FormData()
    fd.append('file', photo, 'id-photo.jpg')
    return d(examApi.post<ExamView>(`${BASE}/id-photo`, fd))
  },
  start: () => d(examApi.post<ExamView>(`${BASE}/start`)),
  answer: (questionId: string, answer: ExamAnswer | null, timeSpentMs: number) =>
    d(examApi.put<{ saved_at: string }>(`${BASE}/answers/${questionId}`, { answer, time_spent_ms: Math.max(0, Math.round(timeSpentMs)) })),
  events: (events: WireEvent[]) => d(examApi.post<StatusInfo & { accepted: number[] }>(`${BASE}/events`, { events })),
  heartbeat: (h: Heartbeat) => d(examApi.post<StatusInfo & { server_flags: { code: FlagCode; label: string; calibration: boolean }[] }>(`${BASE}/heartbeat`, h)),
  evidence: (blob: Blob, kind: 'webcam' | 'screen' | 'presence', seq?: number) => {
    const fd = new FormData()
    fd.append('file', blob, `${kind}.jpg`)
    fd.append('kind', kind)
    if (seq !== undefined) fd.append('seq', String(seq))
    return d(examApi.post<{ stored: boolean }>(`${BASE}/evidence`, fd))
  },
  submit: () => d(examApi.post<StatusInfo>(`${BASE}/submit`)),
  supervisorEnd: (email: string, password: string) => d(examApi.post<StatusInfo>(`${BASE}/supervisor-end`, { email, password })),
  status: () => d(examApi.get<StatusInfo>(`${BASE}/status`)),
  ping: () => d(examApi.get<{ server_time: string }>(`${BASE}/ping`)),
}
