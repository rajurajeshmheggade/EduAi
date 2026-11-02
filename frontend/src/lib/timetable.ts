import { minutes } from '@/lib/calendar'
import type { BellItem } from '@/types'

export const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
/** Fallback attendance periods when the institution's bell schedule hasn't loaded (see periodOptions). */
export const PERIODS = Array.from({ length: 8 }, (_, i) => `Period-${i + 1}`)

/** The built-in bell (45-min periods from 09:00, 15-min break after period 3) — the server's default too. */
export function defaultPeriodTimes(n: number): { start: string; end: string } {
  const start = 9 * 60 + (n - 1) * 45 + (n > 3 ? 15 : 0)
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  return { start: fmt(start), end: fmt(start + 45) }
}

/** Deep link that opens the attendance page pre-selected for a timetable period (and its date, for dated sessions). */
export const markAttendanceLink = (s: { class_code: string; subject_code: string | null; period_number: number; session_date?: string }) =>
  `/teacher/attendance?class=${encodeURIComponent(s.class_code)}&subject=${encodeURIComponent(s.subject_code ?? '')}&period=${s.period_number}` +
  (s.session_date ? `&date=${s.session_date}` : '')

/**
 * Attendance period choices for a date: the bell's periods for that weekday (with times), plus any other period a
 * session of the day uses. `scheduled` marks the periods the teacher actually has for the chosen class and subject.
 */
export function periodOptions(bellItems: BellItem[], sessions: { period_number: number; start_time: string; end_time: string }[], scheduled: Set<number>) {
  const byNum = new Map<number, { value: string; period: number; label: string; scheduled: boolean }>()
  for (const i of bellItems) {
    if (i.item_kind !== 'PERIOD' || !i.period_number) continue
    byNum.set(i.period_number, { value: `Period-${i.period_number}`, period: i.period_number, label: `Period ${i.period_number} · ${i.start_time}–${i.end_time}`, scheduled: scheduled.has(i.period_number) })
  }
  for (const s of sessions) {
    if (!byNum.has(s.period_number)) byNum.set(s.period_number, { value: `Period-${s.period_number}`, period: s.period_number, label: `Period ${s.period_number} · ${s.start_time}–${s.end_time}`, scheduled: scheduled.has(s.period_number) })
  }
  return [...byNum.values()].sort((a, b) => a.period - b.period)
}

/** Bell schedule problems the server would reject (shown before saving). */
export function bellProblems(items: BellItem[]): string[] {
  const out: string[] = []
  const nums = items.filter((i) => i.item_kind === 'PERIOD').map((i) => i.period_number)
  if (nums.some((n) => !n || n < 1 || n > 12)) out.push('Period numbers run from 1 to 12.')
  if (new Set(nums).size !== nums.length) out.push('Each period number may appear only once.')
  if (items.some((i) => !i.start_time || !i.end_time || minutes(i.end_time) <= minutes(i.start_time))) out.push('Every row needs an end time after its start time.')
  const name = (i: BellItem) => (i.item_kind === 'BREAK' ? i.label || 'Break' : `Period ${i.period_number}`)
  const sorted = items.filter((i) => i.start_time && i.end_time).sort((a, b) => minutes(a.start_time) - minutes(b.start_time))
  for (let k = 1; k < sorted.length; k++) {
    if (minutes(sorted[k].start_time) < minutes(sorted[k - 1].end_time)) out.push(`${name(sorted[k - 1])} and ${name(sorted[k])} overlap.`)
  }
  return out
}
