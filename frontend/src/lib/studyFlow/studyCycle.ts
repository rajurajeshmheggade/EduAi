/**
 * The 25 / 5 study cycle (pure: the caller passes the clock and decides what "active study" is).
 *
 *   studying ──25 min of active study──▶ due ──OK──▶ break ──5 min──▶ breakOver ──continue──▶ studying (next cycle)
 *
 * `due` and `breakOver` only change the state; whether their notices may show right now (not during an exam, not
 * while a manual focus session runs) is decided by the UI. Progress is kept per user per day.
 */
import { todayISO } from '@/lib/calendar'
import { BREAK_MS, MINUTE_MS, STALE_BREAK_MINUTES, STUDY_BLOCK_MS } from './config'

export type CyclePhase = 'studying' | 'due' | 'break' | 'breakOver'

export interface CycleState {
  /** Local date (YYYY-MM-DD) the progress belongs to. */
  day: string
  phase: CyclePhase
  /** Active study time counted in this cycle. */
  activeMs: number
  /** End of the current break (epoch ms). */
  breakEndsAt: number | null
  /** Study blocks completed today (breaks taken). */
  cycles: number
}

export const newCycle = (day: string): CycleState => ({ day, phase: 'studying', activeMs: 0, breakEndsAt: null, cycles: 0 })

/** Count active study time; reaching the block length makes the break due. Unchanged (same object) outside studying. */
export function addStudyTime(s: CycleState, ms: number, blockMs: number = STUDY_BLOCK_MS): CycleState {
  if (s.phase !== 'studying' || ms <= 0) return s
  const activeMs = Math.min(blockMs, s.activeMs + ms)
  return { ...s, activeMs, phase: activeMs >= blockMs ? 'due' : 'studying' }
}

/** The student pressed OK on the break reminder. */
export function startBreak(s: CycleState, now: number, breakMs: number = BREAK_MS): CycleState {
  if (s.phase !== 'due') return s
  return { ...s, phase: 'break', breakEndsAt: now + breakMs }
}

/** The break's time is up. */
export function checkBreak(s: CycleState, now: number): CycleState {
  if (s.phase !== 'break' || s.breakEndsAt === null || now < s.breakEndsAt) return s
  return { ...s, phase: 'breakOver' }
}

/** Back to studying: a new block starts. */
export function finishBreak(s: CycleState): CycleState {
  if (s.phase !== 'break' && s.phase !== 'breakOver') return s
  return { ...s, phase: 'studying', activeMs: 0, breakEndsAt: null, cycles: s.cycles + 1 }
}

/** A new day starts a fresh cycle. */
export function rollDay(s: CycleState, today: string): CycleState {
  return s.day === today ? s : newCycle(today)
}

/** The stored state for today, checked; a break that ended long ago (app closed meanwhile) is simply over. */
export function restoreCycle(raw: unknown, now: number, today: string = todayISO(new Date(now))): CycleState {
  const r = (raw ?? {}) as Partial<CycleState>
  if (r.day !== today) return newCycle(today)
  const phases: CyclePhase[] = ['studying', 'due', 'break', 'breakOver']
  const phase = phases.includes(r.phase as CyclePhase) ? (r.phase as CyclePhase) : 'studying'
  const s: CycleState = {
    day: today, phase,
    activeMs: typeof r.activeMs === 'number' && r.activeMs > 0 ? Math.min(r.activeMs, STUDY_BLOCK_MS) : 0,
    breakEndsAt: typeof r.breakEndsAt === 'number' && Number.isFinite(r.breakEndsAt) ? r.breakEndsAt : null,
    cycles: typeof r.cycles === 'number' && r.cycles >= 0 ? Math.floor(r.cycles) : 0,
  }
  if ((s.phase === 'break' || s.phase === 'breakOver') && (s.breakEndsAt === null || now - s.breakEndsAt > STALE_BREAK_MINUTES * MINUTE_MS)) {
    return { ...s, phase: 'studying', activeMs: 0, breakEndsAt: null, cycles: s.cycles + (s.breakEndsAt === null ? 0 : 1) }
  }
  return checkBreak(s, now)
}
