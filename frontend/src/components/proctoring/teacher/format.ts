import type { ProctorModule, Severity, StudentState } from '@/services/proctoringService'

export type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'bad' | 'aqua'

export const STATE_META: Record<StudentState, { label: string; tone: Tone }> = {
  NOT_STARTED: { label: 'Yet to start', tone: 'neutral' },
  PRECHECK: { label: 'In pre-check', tone: 'aqua' },
  ACTIVE: { label: 'Writing', tone: 'brand' },
  INTERRUPTED: { label: 'Interrupted', tone: 'warn' },
  SUBMITTED: { label: 'Submitted', tone: 'ok' },
  ENDED_BY_TEACHER: { label: 'Ended by teacher', tone: 'bad' },
  CLOSED: { label: 'Finished', tone: 'ok' },
}

export const SEVERITY_TONE: Record<Severity, Tone> = { Info: 'neutral', Low: 'neutral', Medium: 'warn', High: 'bad', Critical: 'bad' }


export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—'
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${Math.floor(s)} s ago`
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}

export const clockTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'

export const dateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

export function duration(ms: number): string {
  if (!ms) return ''
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60 ? `${s % 60} s` : ''}`.trim()
}

export const classLabel = (className: string | null | undefined, section: string | null | undefined) =>
  `${className ?? '—'}${section && !(className ?? '').toLowerCase().includes('section') ? ` · Section ${section}` : ''}`

export const examLink = (module: ProctorModule, refId: string, sessionId?: string) =>
  `/teacher/proctoring/exam?${new URLSearchParams({ module, ref: refId, ...(sessionId ? { session: sessionId } : {}) })}`

/** Shown wherever indicators appear: they are signals for a teacher to review, not findings. */
export const SIGNALS_NOT_PROOF = 'Indicators are automated, on-device signals for you to review — not proof of misconduct. Check the timeline and talk to the student before drawing conclusions.'
