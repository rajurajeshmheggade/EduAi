/**
 * Focus timer state machine (pure: the caller passes the clock).
 *
 *   idle ──start──▶ running ──pause──▶ paused ──resume──▶ running ──(time up)──▶ done
 *     ▲                │                   │                                      │
 *     └──────reset─────┴───────reset───────┴──────────reset / start again─────────┘
 *
 * A running timer keeps a deadline (`endsAt`), not a tick count, so a throttled background tab, a navigation or a
 * reload still ends on time.
 */
import { FOCUS_DEFAULT_MINUTES, FOCUS_MAX_MINUTES, FOCUS_MIN_MINUTES, MINUTE_MS } from './config'

export type FocusStatus = 'idle' | 'running' | 'paused' | 'done'

export interface FocusTimerState {
  /** Session length in minutes. */
  minutes: number
  status: FocusStatus
  /** Deadline (epoch ms) while running. */
  endsAt: number | null
  /** Time left while idle / paused (0 when done). */
  remainingMs: number
}

export const clampMinutes = (m: number) => Math.min(FOCUS_MAX_MINUTES, Math.max(FOCUS_MIN_MINUTES, Math.round(m)))

export function initialFocus(minutes: number = FOCUS_DEFAULT_MINUTES): FocusTimerState {
  const m = clampMinutes(minutes)
  return { minutes: m, status: 'idle', endsAt: null, remainingMs: m * MINUTE_MS }
}

export function focusRemaining(s: FocusTimerState, now: number): number {
  return s.status === 'running' && s.endsAt !== null ? Math.max(0, s.endsAt - now) : s.remainingMs
}

/** Start a fresh session (from idle or done), or carry on a paused one. */
export function startFocus(s: FocusTimerState, now: number): FocusTimerState {
  if (s.status === 'running') return s
  if (s.status === 'paused') return resumeFocus(s, now)
  const full = s.minutes * MINUTE_MS
  return { ...s, status: 'running', endsAt: now + full, remainingMs: full }
}

export function pauseFocus(s: FocusTimerState, now: number): FocusTimerState {
  if (s.status !== 'running') return s
  return { ...s, status: 'paused', endsAt: null, remainingMs: focusRemaining(s, now) }
}

export function resumeFocus(s: FocusTimerState, now: number): FocusTimerState {
  if (s.status !== 'paused') return s
  return { ...s, status: 'running', endsAt: now + s.remainingMs }
}

export function resetFocus(s: FocusTimerState): FocusTimerState {
  return initialFocus(s.minutes)
}

/** Choose a length (a preset or custom). Only while not running; a paused session starts over at the new length. */
export function setFocusMinutes(s: FocusTimerState, minutes: number): FocusTimerState {
  if (s.status === 'running' || !Number.isFinite(minutes)) return s
  return initialFocus(minutes)
}

/** Advance the clock: a running session whose deadline passed is done (`completed` is true exactly once). */
export function tickFocus(s: FocusTimerState, now: number): { state: FocusTimerState; completed: boolean } {
  if (s.status !== 'running' || s.endsAt === null || now < s.endsAt) return { state: s, completed: false }
  return { state: { ...s, status: 'done', endsAt: null, remainingMs: 0 }, completed: true }
}

/** A stored state, checked (storage is user-editable and may come from an older version). */
export function restoreFocus(raw: unknown): FocusTimerState {
  const r = (raw ?? {}) as Partial<FocusTimerState>
  const minutes = typeof r.minutes === 'number' && Number.isFinite(r.minutes) ? clampMinutes(r.minutes) : FOCUS_DEFAULT_MINUTES
  const full = minutes * MINUTE_MS
  const remaining = typeof r.remainingMs === 'number' && r.remainingMs >= 0 ? Math.min(r.remainingMs, full) : full
  if (r.status === 'running' && typeof r.endsAt === 'number' && Number.isFinite(r.endsAt)) return { minutes, status: 'running', endsAt: r.endsAt, remainingMs: remaining }
  if (r.status === 'paused') return { minutes, status: 'paused', endsAt: null, remainingMs: remaining }
  if (r.status === 'done') return { minutes, status: 'done', endsAt: null, remainingMs: 0 }
  return initialFocus(minutes)
}

/** "mm:ss" (or "h:mm:ss" from an hour up), rounding up so the display reaches 00:00 exactly at the end. */
export function formatClock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** "24 minutes 13 seconds" for screen readers. */
export function spokenClock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000)
  const m = Math.floor(total / 60), sec = total % 60
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`
  return m && sec ? `${part(m, 'minute')} ${part(sec, 'second')}` : m ? part(m, 'minute') : part(sec, 'second')
}
