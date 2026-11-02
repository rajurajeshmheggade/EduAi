import { useMemo, useState, type ReactNode } from 'react'
import { CalendarOff, ChevronLeft, ChevronRight, Copy, Plus, Repeat, UserRoundCheck, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import {
  bellForDay, eachDate, formatDayNum, formatShort, gridRows, isoWeekday, minutes, monthGrid, rangeLabel, sameMonth,
  sessionsByDate, shiftAnchor, viewRange, type CalendarView,
} from '@/lib/calendar'
import { DAY_SHORT } from '@/lib/timetable'
import { cn } from '@/lib/utils'
import type { BellSchedule, Holiday, TimetableSession } from '@/types'

const TYPE_TONE: Record<string, string> = {
  THEORY: 'border-brand-400/40 bg-brand-500/8',
  LAB: 'border-aqua-400/40 bg-aqua-500/10',
  COACHING_TEST: 'border-warn/40 bg-warn/10',
}

/** Day / week / month switcher, previous / today / next, and a date picker (date-wise filtering). */
export function CalendarToolbar({ view, anchor, today, onView, onAnchor, views = ['day', 'week', 'month'], children }: {
  view: CalendarView
  anchor: string
  today: string
  onView: (v: CalendarView) => void
  onAnchor: (iso: string) => void
  views?: CalendarView[]
  children?: ReactNode
}) {
  const unit = view === 'day' ? 'day' : view === 'week' ? 'week' : 'month'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Calendar view" className="flex rounded-xl border border-line bg-ink-800 p-1">
        {views.map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => onView(v)}
            className={cn('cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors',
              view === v ? 'bg-ink-900 text-brand-600 shadow-sm ring-1 ring-line' : 'text-ink-300 hover:text-fg')}>
            {v}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <Button size="icon" variant="ghost" aria-label={`Previous ${unit}`} onClick={() => onAnchor(shiftAnchor(view, anchor, -1))}><ChevronLeft className="h-4 w-4" /></Button>
        <Button size="sm" variant="secondary" onClick={() => onAnchor(today)} disabled={viewRange(view, today).start === viewRange(view, anchor).start}>Today</Button>
        <Button size="icon" variant="ghost" aria-label={`Next ${unit}`} onClick={() => onAnchor(shiftAnchor(view, anchor, 1))}><ChevronRight className="h-4 w-4" /></Button>
      </div>
      <Input type="date" aria-label="Go to date" className="h-9 w-40" value={anchor} onChange={(e) => e.target.value && onAnchor(e.target.value)} />
      <h3 className="min-w-0 font-display text-sm font-semibold text-fg sm:text-base" aria-live="polite">{rangeLabel(view, anchor)}</h3>
      {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

export function CalendarLegend() {
  const item = (cls: string, label: string) => <span className="flex items-center gap-1.5"><span className={cn('h-3 w-3 rounded border', cls)} />{label}</span>
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-500">
      {item(TYPE_TONE.THEORY, 'Weekly period')}
      {item('border-amber-400/60 bg-amber-400/10', 'Changed for the date')}
      {item('border-ok/50 bg-ok/10', 'Extra (this date only)')}
      {item('border-dashed border-line bg-ink-800 opacity-70', 'Cancelled / holiday')}
    </div>
  )
}

function holidaysOn(holidays: Holiday[], iso: string) {
  return holidays.filter((h) => h.start_date <= iso && iso <= h.end_date)
}

function SessionCard({ s, secondary, onClick, compact }: {
  s: TimetableSession
  secondary: 'teacher' | 'class' | 'both'
  onClick?: (s: TimetableSession) => void
  compact?: boolean
}) {
  const off = s.status !== 'SCHEDULED'
  const coveredBy = s.is_mine === false
  const tone = off ? 'border-dashed border-line bg-ink-800 opacity-70'
    : s.source === 'OVERRIDE' ? 'border-amber-400/60 bg-amber-400/10'
      : s.source === 'DATED' ? 'border-ok/50 bg-ok/10'
        : TYPE_TONE[s.subject_type ?? 'THEORY'] ?? TYPE_TONE.THEORY
  const second = secondary === 'teacher' ? (s.teacher_name ?? 'No teacher') : secondary === 'class' ? s.class_name : `${s.class_name} · ${s.teacher_name ?? 'No teacher'}`
  const state = s.status === 'CANCELLED' ? 'Cancelled' : s.status === 'HOLIDAY' ? `Holiday${s.holiday_name ? `: ${s.holiday_name}` : ''}`
    : s.source === 'OVERRIDE' ? 'Changed for this date' : s.source === 'DATED' ? 'Extra session' : null
  const label = `${s.subject_name ?? 'Session'}, ${s.class_name}, period ${s.period_number}, ${s.start_time} to ${s.end_time}` +
    `${s.teacher_name ? `, ${s.teacher_name}` : ''}${state ? `, ${state}` : ''}${coveredBy ? `, covered by ${s.teacher_name}` : ''}`
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag {...(onClick ? { type: 'button' as const, onClick: () => onClick(s), 'aria-label': `${label}. Edit` } : { 'aria-label': label })}
      className={cn('block w-full rounded-lg border p-1.5 text-left text-xs transition-colors', tone, onClick && 'cursor-pointer hover:border-brand-400 focus-visible:border-brand-400')}>
      <div className={cn('flex items-center gap-1 font-semibold text-fg', off && 'line-through decoration-ink-500')}>
        <span className="truncate">{s.subject_name ?? 'Session'}</span>
        {s.is_online && <Video className="h-3 w-3 shrink-0 text-brand-500" aria-hidden />}
        {s.source === 'OVERRIDE' && !off && <Repeat className="h-3 w-3 shrink-0 text-amber-400" aria-hidden />}
        {s.copied_from && !off && <Copy className="h-3 w-3 shrink-0 text-ink-500" aria-hidden />}
      </div>
      {!compact && <div className="truncate text-[11px] text-ink-300">{second}</div>}
      <div className="text-[10px] tabular-nums text-ink-500">{s.start_time}–{s.end_time}{s.room_number ? ` · ${s.room_number}` : ''}</div>
      {coveredBy && <div className="flex items-center gap-1 truncate text-[10px] font-medium text-amber-400"><UserRoundCheck className="h-3 w-3" aria-hidden /> Covered by {s.teacher_name}</div>}
      {state && !compact && <div className={cn('truncate text-[10px] font-medium', off ? 'text-bad' : s.source === 'DATED' ? 'text-ok' : 'text-amber-400')}>{state}</div>}
      {s.class_timetable_status === 'DRAFT' && !compact && <div className="text-[10px] text-ink-500">Draft class</div>}
    </Tag>
  )
}

export interface CalendarProps {
  view: CalendarView
  anchor: string
  sessions: TimetableSession[]
  holidays: Holiday[]
  bell: BellSchedule | null
  workingDays: number[]
  today: string
  /** Second line of a session card: the teacher (class view), the class (teacher view) or both (whole institution). */
  secondary: 'teacher' | 'class' | 'both'
  /** Day view across many classes: one column per class instead of a single list. */
  columns?: { code: string; label: string }[]
  onSession?: (s: TimetableSession) => void
  /** Click on a free period (editable calendars). The day view across classes also passes the class. */
  onEmpty?: (date: string, period: number, classCode?: string) => void
  onDay?: (date: string) => void
  /** Hide closed weekdays in the week view (they are shown dimmed by default). */
  hideClosedDays?: boolean
  /** Day view (single list): extra controls under a session card, e.g. "Join online" or "Mark attendance". */
  sessionAction?: (s: TimetableSession) => ReactNode
}

/** Dated timetable calendar: day, week and month views over resolved sessions (weekly pattern + dated changes). */
export function TimetableCalendar(props: CalendarProps) {
  const byDate = useMemo(() => sessionsByDate(props.sessions), [props.sessions])
  if (props.view === 'month') return <MonthView {...props} byDate={byDate} />
  if (props.view === 'day') return props.columns ? <DayMatrix {...props} byDate={byDate} columns={props.columns} /> : <DayList {...props} byDate={byDate} />
  return <WeekView {...props} byDate={byDate} />
}

type Inner = CalendarProps & { byDate: Map<string, TimetableSession[]> }

function WeekView({ anchor, byDate, holidays, bell, workingDays, today, secondary, onSession, onEmpty, hideClosedDays, sessions, onDay }: Inner) {
  const { start, end } = viewRange('week', anchor)
  const dates = eachDate(start, end).filter((d) => !hideClosedDays || workingDays.includes(isoWeekday(d)) || byDate.has(d))
  const rows = gridRows(bell, dates.map(isoWeekday), sessions)
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[46rem] border-collapse text-xs">
        <caption className="sr-only">Timetable for the week of {formatShort(start)}</caption>
        <thead className="bg-ink-800 text-ink-500">
          <tr>
            <th scope="col" className="w-20 px-2 py-2 text-left font-medium">Period</th>
            {dates.map((d) => {
              const closed = !workingDays.includes(isoWeekday(d))
              const hol = holidaysOn(holidays, d)
              return (
                <th key={d} scope="col" aria-current={d === today ? 'date' : undefined}
                  className={cn('px-2 py-2 text-center font-medium', d === today && 'text-brand-600', closed && 'opacity-60')}>
                  {onDay ? <button type="button" onClick={() => onDay(d)} className="cursor-pointer hover:underline">{DAY_SHORT[isoWeekday(d)]} {formatDayNum(d)}</button>
                    : <>{DAY_SHORT[isoWeekday(d)]} {formatDayNum(d)}</>}
                  {d === today && <span className="ml-1 rounded bg-brand-500 px-1 text-[10px] text-white">Today</span>}
                  {closed && <div className="text-[10px] font-normal">Closed</div>}
                  {hol.map((h) => <div key={h.holiday_id} className="mt-0.5 truncate text-[10px] font-normal text-bad" title={h.name}>{h.name}{h.status === 'DRAFT' ? ' (draft)' : ''}</div>)}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => r.kind === 'break' ? (
            <tr key={`b-${r.item.start_time}`} className="border-t border-line bg-ink-800/60">
              <th scope="row" className="px-2 py-1 text-left text-[10px] font-medium text-ink-500">{r.item.label ?? 'Break'}</th>
              <td colSpan={dates.length} className="px-2 py-1 text-center text-[10px] text-ink-500">{r.item.label ?? 'Break'} · {r.item.start_time}–{r.item.end_time}</td>
            </tr>
          ) : (
            <tr key={r.period} className="border-t border-line">
              <th scope="row" className="px-2 py-1.5 text-left align-top font-normal">
                <div className="font-semibold text-fg">P{r.period}</div>
                {r.item && <div className="text-[10px] tabular-nums text-ink-500">{r.item.start_time}</div>}
              </th>
              {dates.map((d) => {
                const closed = !workingDays.includes(isoWeekday(d))
                const here = (byDate.get(d) ?? []).filter((s) => s.period_number === r.period)
                return (
                  <td key={d} className={cn('p-1 align-top', d === today && 'bg-brand-500/4', closed && 'bg-ink-800/50')}>
                    <div className="space-y-1">
                      {here.map((s) => <SessionCard key={s.session_key} s={s} secondary={secondary} onClick={onSession} />)}
                      {onEmpty && !closed && !here.some((s) => s.status === 'SCHEDULED') && (
                        <button type="button" onClick={() => onEmpty(d, r.period)} aria-label={`Add a session on ${formatShort(d)}, period ${r.period}`}
                          className="grid min-h-10 w-full cursor-pointer place-items-center rounded-lg border border-dashed border-line text-ink-500 hover:border-brand-400 hover:text-brand-600">
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function dayItems(bell: BellSchedule | null, iso: string, list: TimetableSession[]) {
  const items = bellForDay(bell, isoWeekday(iso))
  const periods = new Set(items.filter((i) => i.item_kind === 'PERIOD').map((i) => i.period_number))
  const extra = [...new Set(list.map((s) => s.period_number).filter((p) => !periods.has(p)))]
    .map((p) => {
      const first = list.find((s) => s.period_number === p)!
      return { item_kind: 'PERIOD' as const, period_number: p, label: null, start_time: first.start_time, end_time: first.end_time }
    })
  return [...items, ...extra].sort((a, b) => minutes(a.start_time) - minutes(b.start_time) || (a.period_number ?? 0) - (b.period_number ?? 0))
}

function DayHeader({ iso, holidays, workingDays }: { iso: string; holidays: Holiday[]; workingDays: number[] }) {
  const closed = !workingDays.includes(isoWeekday(iso))
  const hol = holidaysOn(holidays, iso)
  if (!closed && !hol.length) return null
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {closed && <span className="flex items-center gap-1.5 rounded-lg border border-line bg-ink-800 px-2.5 py-1 text-xs text-ink-300"><CalendarOff className="h-3.5 w-3.5" /> Not a working day</span>}
      {hol.map((h) => (
        <span key={h.holiday_id} className="flex items-center gap-1.5 rounded-lg border border-bad/30 bg-bad/10 px-2.5 py-1 text-xs text-bad">
          <CalendarOff className="h-3.5 w-3.5" /> {h.name}{h.is_full_day ? '' : ' (part day)'}{h.status === 'DRAFT' ? ' — draft' : ''}
        </span>
      ))}
    </div>
  )
}

const clockHHMM = () => {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function DayList({ anchor, byDate, holidays, bell, workingDays, secondary, onSession, onEmpty, today, sessionAction }: Inner) {
  const list = byDate.get(anchor) ?? []
  const items = dayItems(bell, anchor, list)
  const closed = !workingDays.includes(isoWeekday(anchor))
  const [hhmm] = useState(clockHHMM)
  // On today's page the period running now is marked (as on the dashboards).
  const isNow = (start: string, end: string) => anchor === today && start <= hhmm && hhmm < end
  return (
    <div>
      <DayHeader iso={anchor} holidays={holidays} workingDays={workingDays} />
      {items.length === 0 && list.length === 0 ? <p className="py-8 text-center text-sm text-ink-300">Nothing scheduled.</p> : (
        <ol className="divide-y divide-line rounded-xl border border-line">
          {items.map((i) => {
            if (i.item_kind === 'BREAK') {
              return <li key={`b-${i.start_time}`} className="flex items-center gap-3 bg-ink-800/60 px-3 py-1.5 text-xs text-ink-500"><span className="w-28 tabular-nums">{i.start_time}–{i.end_time}</span>{i.label ?? 'Break'}</li>
            }
            const here = list.filter((s) => s.period_number === i.period_number)
            const live = isNow(i.start_time, i.end_time)
            return (
              <li key={`p-${i.period_number}`} aria-current={live ? 'time' : undefined} className={cn('flex gap-3 px-3 py-2', live && 'bg-brand-500/6')}>
                <div className="w-28 shrink-0 pt-1 text-xs tabular-nums text-ink-500">
                  <span className="font-semibold text-fg">P{i.period_number}</span> · {i.start_time}–{i.end_time}
                  {live && <span className="ml-1 rounded-full bg-ok px-1.5 text-[10px] font-semibold text-white">NOW</span>}
                </div>
                <div className="grid min-w-0 flex-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {here.map((s) => {
                    const action = sessionAction?.(s)
                    return action
                      ? <div key={s.session_key} className="space-y-1.5"><SessionCard s={s} secondary={secondary} onClick={onSession} />{action}</div>
                      : <SessionCard key={s.session_key} s={s} secondary={secondary} onClick={onSession} />
                  })}
                  {!here.length && !onEmpty && <span className="pt-1 text-xs text-ink-500">Free</span>}
                  {onEmpty && !closed && !here.some((s) => s.status === 'SCHEDULED') && (
                    <button type="button" onClick={() => onEmpty(anchor, i.period_number!)} aria-label={`Add a session in period ${i.period_number}`}
                      className="flex min-h-10 cursor-pointer items-center justify-center gap-1 rounded-lg border border-dashed border-line text-xs text-ink-500 hover:border-brand-400 hover:text-brand-600">
                      <Plus className="h-3.5 w-3.5" /> Add
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

function DayMatrix({ anchor, byDate, holidays, bell, workingDays, onSession, onEmpty, columns }: Inner & { columns: { code: string; label: string }[] }) {
  const list = byDate.get(anchor) ?? []
  const rows = gridRows({ configured: true, default: bellForDay(bell, isoWeekday(anchor)), by_day: {} }, [isoWeekday(anchor)], list)
  const closed = !workingDays.includes(isoWeekday(anchor))
  return (
    <div>
      <DayHeader iso={anchor} holidays={holidays} workingDays={workingDays} />
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-xs" style={{ minWidth: `${6 + columns.length * 9}rem` }}>
          <caption className="sr-only">All classes on {formatShort(anchor)}</caption>
          <thead className="bg-ink-800 text-ink-500">
            <tr>
              <th scope="col" className="sticky left-0 z-10 w-20 bg-ink-800 px-2 py-2 text-left font-medium">Period</th>
              {columns.map((c) => <th key={c.code} scope="col" className="px-2 py-2 text-center font-medium">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => r.kind === 'break' ? (
              <tr key={`b-${r.item.start_time}`} className="border-t border-line bg-ink-800/60">
                <th scope="row" className="sticky left-0 bg-ink-800 px-2 py-1 text-left text-[10px] font-medium text-ink-500">{r.item.label ?? 'Break'}</th>
                <td colSpan={columns.length} className="px-2 py-1 text-center text-[10px] text-ink-500">{r.item.start_time}–{r.item.end_time}</td>
              </tr>
            ) : (
              <tr key={r.period} className="border-t border-line">
                <th scope="row" className="sticky left-0 bg-ink-900 px-2 py-1.5 text-left align-top font-normal">
                  <div className="font-semibold text-fg">P{r.period}</div>
                  {r.item && <div className="text-[10px] tabular-nums text-ink-500">{r.item.start_time}</div>}
                </th>
                {columns.map((c) => {
                  const here = list.filter((s) => s.class_code === c.code && s.period_number === r.period)
                  return (
                    <td key={c.code} className="p-1 align-top">
                      <div className="space-y-1">
                        {here.map((s) => <SessionCard key={s.session_key} s={s} secondary="teacher" onClick={onSession} />)}
                        {onEmpty && !closed && !here.some((s) => s.status === 'SCHEDULED') && (
                          <button type="button" onClick={() => onEmpty(anchor, r.period, c.code)} aria-label={`Add a session for ${c.label}, period ${r.period}`}
                            className="grid min-h-10 w-full cursor-pointer place-items-center rounded-lg border border-dashed border-line text-ink-500 hover:border-brand-400 hover:text-brand-600">
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MonthView({ anchor, byDate, holidays, workingDays, today, onDay, secondary }: Inner) {
  const grid = monthGrid(anchor)
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] table-fixed border-collapse text-xs">
        <caption className="sr-only">Month calendar</caption>
        <thead>
          <tr>{[1, 2, 3, 4, 5, 6, 7].map((d) => <th key={d} scope="col" className={cn('pb-1.5 text-center font-medium text-ink-500', !workingDays.includes(d) && 'opacity-60')}>{DAY_SHORT[d]}</th>)}</tr>
        </thead>
        <tbody>
          {grid.map((week) => (
            <tr key={week[0]}>
              {week.map((d) => {
                const list = byDate.get(d) ?? []
                const live = list.filter((s) => s.status === 'SCHEDULED')
                const off = list.length - live.length
                const changed = live.filter((s) => s.source !== 'TEMPLATE').length
                const hol = holidaysOn(holidays, d)
                const closed = !workingDays.includes(isoWeekday(d))
                const label = `${formatShort(d)}: ${live.length} session${live.length === 1 ? '' : 's'}${changed ? `, ${changed} changed or extra` : ''}${off ? `, ${off} cancelled` : ''}${hol.length ? `, holiday ${hol.map((h) => h.name).join(', ')}` : ''}${closed ? ', not a working day' : ''}`
                return (
                  <td key={d} className="h-24 border border-line p-0 align-top">
                    <button type="button" onClick={() => onDay?.(d)} aria-label={label} aria-current={d === today ? 'date' : undefined}
                      className={cn('flex h-full w-full cursor-pointer flex-col gap-0.5 p-1.5 text-left transition-colors hover:bg-brand-500/5',
                        !sameMonth(d, anchor) && 'opacity-45', closed && 'bg-ink-800/60')}>
                      <span className={cn('grid h-6 w-6 place-items-center rounded-full text-xs font-semibold', d === today ? 'bg-brand-500 text-white' : 'text-fg')}>{formatDayNum(d)}</span>
                      {hol.map((h) => <span key={h.holiday_id} className="truncate rounded bg-bad/10 px-1 text-[10px] text-bad">{h.name}</span>)}
                      {live.slice(0, 2).map((s) => (
                        <span key={s.session_key} className={cn('hidden truncate rounded px-1 text-[10px] sm:block', s.source === 'TEMPLATE' ? 'bg-brand-500/8 text-ink-300' : s.source === 'OVERRIDE' ? 'bg-amber-400/15 text-ink-300' : 'bg-ok/10 text-ink-300')}>
                          P{s.period_number} {s.subject_name}{secondary === 'class' ? ` · ${s.class_code}` : ''}
                        </span>
                      ))}
                      {live.length > 2 && <span className="hidden text-[10px] text-ink-500 sm:block">+{live.length - 2} more</span>}
                      {live.length > 0 && <span className="text-[10px] text-ink-500 sm:hidden">{live.length}</span>}
                      {(changed > 0 || off > 0) && (
                        <span className="mt-auto flex flex-wrap gap-1 text-[10px]">
                          {changed > 0 && <span className="text-amber-400">{changed} changed</span>}
                          {off > 0 && <span className="text-bad">{off} off</span>}
                        </span>
                      )}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
