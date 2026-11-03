import { api, tokenStore } from './apiClient'

const B = '/ICMELive/api/v1/proctoring'

export type ProctorModule = 'ONLINE_TEST' | 'VIRTUAL_LAB' | 'AI_CLASSROOM'
export type ProctorStatus = 'PRECHECK' | 'ACTIVE' | 'INTERRUPTED' | 'SUBMITTED' | 'ENDED_BY_TEACHER' | 'CLOSED'
export type StudentState = ProctorStatus | 'NOT_STARTED'
export type Severity = 'Info' | 'Low' | 'Medium' | 'High' | 'Critical'
export type ReviewOutcome = 'DISMISSED' | 'NOTED' | 'CONCERN'

export const MODULE_LABEL: Record<ProctorModule, string> = { ONLINE_TEST: 'Online test', VIRTUAL_LAB: 'Virtual lab', AI_CLASSROOM: 'AI Classroom' }

/** Thresholds the student's device runs its on-device detectors with (the server scores severity itself). */
export interface ClientRules {
  camera_required: boolean
  mic_required: boolean
  fullscreen_required: boolean
  detect_multiple_faces: boolean
  detect_looking_away: boolean
  detect_objects: boolean
  detect_voice: boolean
  durations_ms: Record<'NO_FACE' | 'MULTIPLE_FACES' | 'LOOKING_AWAY' | 'CAMERA_BLOCKED' | 'WINDOW_BLUR' | 'VOICE_DETECTED', number>
  voice_db: number
  object_min_confidence: number
  heartbeat_seconds: number
  face_fps: number
  object_fps: number
  labels: Record<string, string>
}

export interface ProctorNotice { captured: string[]; not_captured: string[]; where: string; who_sees: string; retention: string }
export interface ProctorConfig {
  module: ProctorModule
  enabled: boolean
  rules: string[]
  rules_version: string
  acknowledgement: string
  notice: ProctorNotice
  client_rules: ClientRules
}

export interface StudentSession {
  session_id: string
  module: ProctorModule
  ref_id: string
  title: string
  status: ProctorStatus
  started_at: string | null
  resumed: boolean
  rules_version: string
  client_rules: ClientRules
  last_seq: number
  end_reason: string | null
}

export interface ProctorWarning { action_id: string; message: string; created_at: string }
export interface StudentStatus { status: ProctorStatus; ended: boolean; end_reason: string | null; server_time: string; warnings: ProctorWarning[] }
export interface WireEvent { seq: number; code: string; client_ts: string; duration_ms: number; confidence?: number; details?: Record<string, string | number | boolean | null> }
export interface StartChecks { camera: boolean; face: boolean; microphone: boolean; fullscreen: boolean; lighting?: boolean }
export interface HeartbeatBody {
  camera_live: boolean
  mic_live: boolean | null
  camera_permission: PermissionState | null
  mic_permission: PermissionState | null
  fullscreen: boolean
  visible: boolean
  faces: number | null
  online: boolean
  fps: number | null
}

// ---------------------------------------------------------------- teacher
export interface ExamCounts {
  enrolled: number; writing: number; prechecking: number; yet_to_start: number; interrupted: number; submitted: number
  with_active_alerts: number; camera_issues: number; suspicious: number
}
export interface ExamHeader {
  module: ProctorModule; ref_id: string; title: string; class_code: string | null; class_name: string | null; section: string | null
  subject_code: string | null; subject_name: string | null; due_at: string | null; available_from: string | null; duration_minutes: number | null
  class_codes?: string[]
}
export interface Review { outcome: ReviewOutcome; note: string | null; by: string; at: string }
export interface ProctorEvent {
  event_id: string; seq: number | null; code: string; label: string; severity: Severity; category: 'suspicious' | 'camera' | 'presence' | 'session'
  client_ts: string | null; server_ts: string; duration_ms: number; details: Record<string, unknown> | null; review?: Review | null
  confidence?: number | null; source?: 'client' | 'server'
}
export interface AlertItem extends ProctorEvent { session_id: string; student_code: string; student_name: string | null }
export interface ExamStudent {
  student_code: string; full_name: string; roll_number: string | null; class_code: string; class_name: string; section: string | null
  state: StudentState; session_id: string | null; started_at: string | null; last_heartbeat_at: string | null
  camera: { live: boolean | null; label: string | null }; mic: { live: boolean | null; permission: string | null; label: string | null }
  fullscreen: boolean | null; online: boolean | null; faces: number | null
  alerts: { open: number; total: number; high: number }; suspicious: boolean; camera_issue: boolean; warnings: number
  latest_alert: { code: string; label: string; severity: Severity; at: string } | null
}
export interface ExamView { exam: ExamHeader; counts: ExamCounts; students: ExamStudent[]; alerts: AlertItem[] }
export interface ExamSummary extends ExamHeader { counts: ExamCounts; latest_alert: AlertItem | null }
export interface SessionAction {
  action_id: string; action: 'REMARK' | 'WARNING' | 'END_SESSION' | 'REVIEW'; event_id: string | null; outcome: ReviewOutcome | null
  message: string | null; created_at: string; delivered_at: string | null; acknowledged_at: string | null
  actor_code: string; actor_role: string; actor_name: string | null
}
export interface SessionDetail {
  session: {
    session_id: string; module: ProctorModule; ref_id: string; ref_title: string; status: ProctorStatus; started_at: string | null
    ended_at: string | null; end_reason: string | null; rules_version: string | null; rules_acknowledged_at: string | null
    checks: Partial<StartChecks> | null; camera_label: string | null; mic_label: string | null; resumed_count: number
    last_heartbeat_at: string | null; last_status: Partial<HeartbeatBody> | null; created_at: string
  }
  student: { student_code: string; full_name: string | null; roll_number: string | null; class_code: string | null; class_name: string | null; section: string | null }
  can_end: boolean
  requires: { camera: boolean; microphone: boolean; fullscreen: boolean }
  events: ProctorEvent[]
  actions: SessionAction[]
  views: number
  sessions: { session_id: string; status: ProctorStatus; started_at: string | null; ended_at: string | null; created_at: string }[]
}

/** A message from the live stream. */
export interface LiveMessage {
  type: 'event' | 'session' | 'action' | 'hello' | 'bye'
  module?: ProctorModule; ref_id?: string; session_id?: string; student_code?: string; student_name?: string | null
  status?: ProctorStatus; at?: string; overflow?: boolean
  event?: ProctorEvent
  action?: { action_id: string; action: string; event_id?: string | null; outcome?: string | null }
}

// ---------------------------------------------------------------- settings
export interface ProctorSettings {
  enabled: boolean; camera_required: boolean; mic_required: boolean; fullscreen_required: boolean
  detect_multiple_faces: boolean; detect_looking_away: boolean; detect_objects: boolean; detect_voice: boolean
  no_face_seconds: number; multiple_faces_seconds: number; looking_away_seconds: number; camera_blocked_seconds: number
  window_blur_seconds: number; voice_seconds: number; voice_db: number; object_min_confidence: number
  escalate_after_seconds: number; repeat_escalation_count: number; heartbeat_missing_seconds: number
  notify_on_start: boolean; notify_min_severity: Severity; notify_cooldown_seconds: number; teacher_can_end: boolean; retention_days: number
}
export interface ModuleSettings {
  effective: ProctorSettings; defaults: ProctorSettings; overrides: Partial<ProctorSettings>; updated_by: string | null; updated_at: string | null
  history: { at: string; by: string; changes: Record<string, [unknown, unknown]> }[]
}
export interface SettingsView {
  modules: Record<ProctorModule, ModuleSettings>
  flags: Record<string, { label: string; severity: Severity; category: string }>
  limits: Record<string, [number, number]>
  severities: Severity[]
  editable: boolean
}

const authHeaders = () => ({ Authorization: `Bearer ${tokenStore.access ?? ''}` })

export const proctoringService = {
  // student
  async config(module: ProctorModule): Promise<ProctorConfig> {
    return (await api.get<ProctorConfig>(`${B}/student/config`, { params: { module } })).data
  },
  async prepare(module: ProctorModule, refId: string): Promise<StudentSession> {
    return (await api.post<StudentSession>(`${B}/student/sessions`, { module, ref_id: refId })).data
  },
  async start(sessionId: string, body: { acknowledged: boolean; rules_version: string; checks: StartChecks; camera_label: string | null; mic_label: string | null }) {
    return (await api.post<StudentSession>(`${B}/student/sessions/${sessionId}/start`, body)).data
  },
  async events(sessionId: string, events: WireEvent[]) {
    return (await api.post<StudentStatus & { accepted: number[] }>(`${B}/student/sessions/${sessionId}/events`, { events })).data
  },
  async heartbeat(sessionId: string, body: HeartbeatBody): Promise<StudentStatus> {
    return (await api.post<StudentStatus>(`${B}/student/sessions/${sessionId}/heartbeat`, body)).data
  },
  async ackWarning(sessionId: string, actionId: string) {
    await api.post(`${B}/student/sessions/${sessionId}/warnings/${actionId}/ack`)
  },
  async finish(sessionId: string, reason: 'submitted' | 'left' | 'closed') {
    return (await api.post<StudentSession>(`${B}/student/sessions/${sessionId}/finish`, { reason })).data
  },
  /** Page is closing: fire-and-forget with keepalive (sendBeacon cannot carry the Authorization header). */
  finishOnUnload(sessionId: string, reason: 'left' | 'closed', events: WireEvent[] = []) {
    const headers = { ...authHeaders(), 'Content-Type': 'application/json' }
    if (events.length) void fetch(`${B}/student/sessions/${sessionId}/events`, { method: 'POST', keepalive: true, headers, body: JSON.stringify({ events: events.slice(0, 50) }) }).catch(() => {})
    void fetch(`${B}/student/sessions/${sessionId}/finish`, { method: 'POST', keepalive: true, headers, body: JSON.stringify({ reason }) }).catch(() => {})
  },

  // teacher
  async exams(signal?: AbortSignal): Promise<{ exams: ExamSummary[] }> {
    return (await api.get<{ exams: ExamSummary[] }>(`${B}/teacher/exams`, { signal })).data
  },
  async exam(module: ProctorModule, refId: string, signal?: AbortSignal): Promise<ExamView> {
    return (await api.get<ExamView>(`${B}/teacher/exam`, { params: { module, ref_id: refId }, signal })).data
  },
  async session(sessionId: string, signal?: AbortSignal): Promise<SessionDetail> {
    return (await api.get<SessionDetail>(`${B}/teacher/sessions/${sessionId}`, { signal })).data
  },
  async remark(sessionId: string, message: string) {
    return (await api.post(`${B}/teacher/sessions/${sessionId}/remarks`, { message })).data
  },
  async warn(sessionId: string, message: string) {
    return (await api.post(`${B}/teacher/sessions/${sessionId}/warnings`, { message })).data
  },
  async end(sessionId: string, reason: string): Promise<{ status: ProctorStatus; attempt: string | null }> {
    return (await api.post(`${B}/teacher/sessions/${sessionId}/end`, { reason })).data
  },
  async review(eventId: string, outcome: ReviewOutcome, note?: string) {
    return (await api.post(`${B}/teacher/events/${eventId}/review`, { outcome, note: note || null })).data
  },

  // settings
  async settings(orgCode?: string): Promise<SettingsView> {
    return (await api.get<SettingsView>(`${B}/settings`, { params: orgCode ? { org_code: orgCode } : {} })).data
  },
  async saveSettings(module: ProctorModule, values: Partial<ProctorSettings>, orgCode?: string): Promise<ModuleSettings> {
    return (await api.put<ModuleSettings>(`${B}/settings/${module}`, values, { params: orgCode ? { org_code: orgCode } : {} })).data
  },
}

/** Splits an SSE buffer into complete frames; returns the parsed frames and the unfinished remainder. */
export function parseSse(buffer: string): { frames: { event: string; data: unknown }[]; rest: string } {
  const frames: { event: string; data: unknown }[] = []
  const parts = buffer.replace(/\r\n/g, '\n').split('\n\n')
  const rest = parts.pop() ?? ''
  for (const raw of parts) {
    let event = 'message'
    const data: string[] = []
    for (const line of raw.split('\n')) {
      if (!line || line.startsWith(':')) continue
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
    }
    if (!data.length) continue
    try { frames.push({ event, data: JSON.parse(data.join('\n')) }) } catch { /* ignore a malformed frame */ }
  }
  return { frames, rest }
}

export class StreamError extends Error {
  readonly status: number
  constructor(status: number) { super(`Live updates unavailable (${status})`); this.status = status }
}

/**
 * Live proctoring updates for the signed-in teacher (EventSource cannot send the Authorization header, so this reads
 * the stream with fetch). Resolves when the server closes the stream (it does so before the token expires).
 */
export async function openProctorStream(filter: { module?: ProctorModule; refId?: string }, onMessage: (m: LiveMessage) => void, signal: AbortSignal) {
  const qs = new URLSearchParams()
  if (filter.module) qs.set('module', filter.module)
  if (filter.refId) qs.set('ref_id', filter.refId)
  const res = await fetch(`${B}/teacher/stream?${qs}`, { headers: { ...authHeaders(), Accept: 'text/event-stream' }, signal, cache: 'no-store' })
  if (!res.ok || !res.body) throw new StreamError(res.status)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const parsed = parseSse(buf + dec.decode(value, { stream: true }))
    buf = parsed.rest
    for (const f of parsed.frames) onMessage({ ...(f.data as object), type: f.event } as LiveMessage)
  }
}
