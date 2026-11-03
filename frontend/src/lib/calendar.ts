/**
 * Calendar date helpers for the dated timetable. Dates are ISO `YYYY-MM-DD` strings throughout (what the API sends
 * and expects); arithmetic is done in UTC so daylight-saving changes never shift a day. Weeks run Monday–Sunday
 * (ISO weekday 1 = Monday … 7 = Sunday), matching the backend.
 */
import type { BellItem, BellSchedule, TimetableSession } from '@/types'

export type CalendarView = 'day' | 'week' | 'month'

const pad = (n: number) => String(n).padStart(2, '0')

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function toISODate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** Today in the viewer's own timezone. */
export function todayISO(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function addDays(iso: string, n: number): string {
  const d = parseISODate(iso)
  d.setUTCDate(d.getUTCDate() + n)
  return toISODate(d)
}

export function addMonths(iso: string, n: number): string {
  const d = parseISODate(iso)
  const day = d.getUTCDate()
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, last))  // 31 Jan + 1 month = 28/29 Feb, not 3 Mar
  return toISODate(target)
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(iso: string): number {
  return parseISODate(iso).getUTCDay() || 7
}

export const startOfWeek = (iso: string) => addDays(iso, 1 - isoWeekday(iso))
export const endOfWeek = (iso: string) => addDays(startOfWeek(iso), 6)
export const startOfMonth = (iso: string) => `${iso.slice(0, 7)}-01`
export function endOfMonth(iso: string): string {
  const d = parseISODate(startOfMonth(iso))
  return toISODate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)))
}

/** Every date from `start` to `end` inclusive (empty when end < start). */
export function eachDate(start: string, end: string): string[] {
  const out: string[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d)
  return out
}

export const weekDates = (iso: string) => eachDate(startOfWeek(iso), endOfWeek(iso))

/** Month grid as whole Monday–Sunday weeks: from the Monday on/before the 1st to the Sunday on/after the last day. */
export function monthGrid(iso: string): string[][] {
  const days = eachDate(startOfWeek(startOfMonth(iso)), endOfWeek(endOfMonth(iso)))
  return Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7))
}

export const sameMonth = (a: string, b: string) => a.slice(0, 7) === b.slice(0, 7)

/** The date range a view shows around `anchor` (a month view fetches its whole grid). */
export function viewRange(view: CalendarView, anchor: string): { start: string; end: string } {
  if (view === 'day') return { start: anchor, end: anchor }
  if (view === 'week') return { start: startOfWeek(anchor), end: endOfWeek(anchor) }
  const grid = monthGrid(anchor)
  return { start: grid[0][0], end: grid[grid.length - 1][6] }
}

/** Previous / next day, week or month. */
export function shiftAnchor(view: CalendarView, anchor: string, delta: number): string {
  if (view === 'day') return addDays(anchor, delta)
  if (view === 'week') return addDays(anchor, 7 * delta)
  return addMonths(anchor, delta)
}

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  parseISODate(iso).toLocaleDateString(undefined, { timeZone: 'UTC', ...opts })

export const formatDay = (iso: string) => fmt(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
export const formatShort = (iso: string) => fmt(iso, { weekday: 'short', day: 'numeric', month: 'short' })
export const formatDayNum = (iso: string) => fmt(iso, { day: 'numeric' })

/** Heading for the toolbar: "Monday, 2 November 2026", "2 – 8 Nov 2026" or "November 2026". */
export function rangeLabel(view: CalendarView, anchor: string): string {
  if (view === 'day') return formatDay(anchor)
  if (view === 'month') return fmt(anchor, { month: 'long', year: 'numeric' })
  const s = startOfWeek(anchor), e = endOfWeek(anchor)
  const sameM = sameMonth(s, e), sameY = s.slice(0, 4) === e.slice(0, 4)
  const left = fmt(s, sameM ? { day: 'numeric' } : sameY ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
  return `${left} – ${fmt(e, { day: 'numeric', month: 'short', year: 'numeric' })}`
}

/** "HH:MM" -> minutes since midnight. */
export function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}

/** Half-open time ranges [start, end) overlap. */
export const overlaps = (a: { start_time: string; end_time: string }, b: { start_time: string; end_time: string }) =>
  minutes(a.start_time) < minutes(b.end_time) && minutes(b.start_time) < minutes(a.end_time)

/** The bell that applies on an ISO weekday: its own schedule if it has one, else the default. */
export function bellForDay(bell: BellSchedule | null | undefined, weekday: number): BellItem[] {
  if (!bell) return []
  return bell.by_day[String(weekday)] ?? bell.default
}

/** Sessions grouped by date, each list ordered by start time then period. */
export function sessionsByDate(sessions: TimetableSession[]): Map<string, TimetableSession[]> {
  const out = new Map<string, TimetableSession[]>()
  for (const s of sessions) {
    const list = out.get(s.session_date) ?? []
    list.push(s)
    out.set(s.session_date, list)
  }
  for (const list of out.values()) list.sort((a, b) => a.start_time.localeCompare(b.start_time) || a.period_number - b.period_number)
  return out
}

/**
 * Rows for a periods × days grid: every period number of the bell on the shown weekdays plus any period a session
 * uses, with named breaks placed between the periods they fall between (taken from the default bell).
 */
export type GridRow = { kind: 'period'; period: number; item?: BellItem } | { kind: 'break'; item: BellItem }

export function gridRows(bell: BellSchedule | null | undefined, weekdays: number[], sessions: TimetableSession[]): GridRow[] {
  const byPeriod = new Map<number, BellItem>()
  for (const d of weekdays) for (const i of bellForDay(bell, d)) if (i.item_kind === 'PERIOD' && i.period_number && !byPeriod.has(i.period_number)) byPeriod.set(i.period_number, i)
  for (const i of bell?.default ?? []) if (i.item_kind === 'PERIOD' && i.period_number) byPeriod.set(i.period_number, i)
  const periods = [...new Set([...byPeriod.keys(), ...sessions.map((s) => s.period_number)])].sort((a, b) => a - b)
  const breaks = (bell?.default ?? []).filter((i) => i.item_kind === 'BREAK')
  const rows: GridRow[] = []
  const placed = new Set<BellItem>()
  for (const p of periods) {
    const item = byPeriod.get(p)
    if (item) {
      for (const b of breaks) if (!placed.has(b) && minutes(b.end_time) <= minutes(item.start_time)) { rows.push({ kind: 'break', item: b }); placed.add(b) }
    }
    rows.push({ kind: 'period', period: p, item })
  }
  for (const b of breaks) if (!placed.has(b) && periods.length) rows.push({ kind: 'break', item: b })
  return rows
}

export const isWorkingDay = (workingDays: number[] | null | undefined, iso: string) =>
  !workingDays || workingDays.includes(isoWeekday(iso))
