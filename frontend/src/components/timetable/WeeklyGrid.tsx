import { useState, type ReactNode } from 'react'
import { Plus, Video } from 'lucide-react'
import { DAY_NAMES, DAY_SHORT, defaultPeriodTimes } from '@/lib/timetable'
import { cn } from '@/lib/utils'
import type { BellSchedule, TimetableSlot } from '@/types'

const SCHEDULE_LABEL: Record<string, string> = { MONTHLY: 'Monthly', YEARLY: 'Yearly' }

const TYPE_TONE: Record<string, string> = {
  THEORY: 'border-brand-400/40 bg-brand-500/8',
  LAB: 'border-aqua-400/40 bg-aqua-500/10',
  COACHING_TEST: 'border-warn/40 bg-warn/10',
}

/**
 * Days × periods grid of the weekly pattern. `secondary` picks what the second line shows: the teacher (class view)
 * or the class (teacher view). Pass `onCell` to make cells editable. `bell` labels the rows with the institution's
 * period times; `workingDays` dims closed days (nothing new can be added there).
 */
export function WeeklyGrid({ slots, secondary, today, onCell, minPeriods = 8, bell, workingDays }: {
  slots: TimetableSlot[]
  secondary: 'teacher' | 'class'
  today?: number
  onCell?: (day: number, period: number, slot?: TimetableSlot) => void
  minPeriods?: number
  bell?: BellSchedule | null
  workingDays?: number[]
}) {
  const days = [1, 2, 3, 4, 5, 6, 7]
  const bellPeriods = (bell?.default ?? []).filter((i) => i.item_kind === 'PERIOD')
  const periods = Math.max(bell ? 1 : minPeriods, ...bellPeriods.map((i) => i.period_number ?? 0), ...slots.map((s) => s.period_number))
  const startOf = (p: number) => bellPeriods.find((i) => i.period_number === p)?.start_time ?? (bell ? '' : defaultPeriodTimes(p).start)
  const at = new Map(slots.map((s) => [`${s.day_of_week}-${s.period_number}`, s]))
  const closed = (d: number) => !!workingDays && !workingDays.includes(d)

  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[46rem] border-collapse text-xs">
        <thead className="bg-ink-800 text-ink-500">
          <tr>
            <th className="w-20 px-2 py-2 text-left font-medium">Period</th>
            {days.map((d) => (
              <th key={d} className={cn('px-2 py-2 text-center font-medium', d === today && 'text-brand-600', closed(d) && 'opacity-60')}>
                {DAY_SHORT[d]}{d === today && <span className="ml-1 rounded bg-brand-500 px-1 text-[10px] text-white">Today</span>}
                {closed(d) && <div className="text-[10px] font-normal">Closed</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: periods }, (_, i) => i + 1).map((p) => (
            <tr key={p} className="border-t border-line">
              <td className="px-2 py-1.5 align-top">
                <div className="font-semibold text-fg">P{p}</div>
                <div className="text-[10px] text-ink-500">{startOf(p)}</div>
              </td>
              {days.map((d) => {
                const s = at.get(`${d}-${p}`)
                const editable = onCell && (s || !closed(d))
                const Cell = editable ? 'button' : 'div'
                return (
                  <td key={d} className={cn('p-1 align-top', d === today && 'bg-brand-500/4', closed(d) && 'bg-ink-800/50')}>
                    <Cell
                      {...(editable ? { type: 'button' as const, onClick: () => onCell(d, p, s), 'aria-label': `${DAY_NAMES[d]} period ${p}${s ? `: ${s.subject_name}` : ' (empty)'}` } : {})}
                      className={cn('block min-h-14 w-full rounded-lg border p-1.5 text-left transition-colors',
                        s ? TYPE_TONE[s.subject_type] ?? TYPE_TONE.THEORY : 'border-dashed border-line',
                        editable && 'cursor-pointer hover:border-brand-400',
                        editable && !s && 'grid place-items-center text-ink-500')}
                    >
                      {s ? (
                        <>
                          <div className="flex items-center gap-1 truncate font-semibold text-fg">
                            {s.subject_name}
                            {s.is_online && <Video className="h-3 w-3 shrink-0 text-brand-500" aria-label="Online class" />}
                          </div>
                          <div className="truncate text-[11px] text-ink-300">{secondary === 'teacher' ? (s.teacher_name ?? 'No teacher') : s.class_name}</div>
                          <div className="text-[10px] tabular-nums text-ink-500">{s.start_time}–{s.end_time}{s.room_number ? ` · ${s.room_number}` : ''}</div>
                          {SCHEDULE_LABEL[s.schedule_type] && <div className="truncate text-[10px] text-ink-500">{SCHEDULE_LABEL[s.schedule_type]}</div>}
                        </>
                      ) : editable ? <Plus className="h-3.5 w-3.5" /> : null}
                    </Cell>
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

type TodayItem = Pick<TimetableSlot, 'day_of_week' | 'period_number' | 'start_time' | 'end_time' | 'class_name' | 'teacher_name' | 'room_number'> & {
  slot_id: string | null
  subject_name: string | null
  session_key?: string
}

/** Today's periods as a list (dashboards, my timetable). Accepts weekly slots or resolved dated sessions. */
export function TodayList<T extends TodayItem>({ slots, today, secondary, action, empty = 'No classes scheduled today.' }: {
  slots: T[]
  today: number
  secondary: 'teacher' | 'class'
  action?: (s: T) => ReactNode
  empty?: string
}) {
  const [hhmm] = useState(() => {
    const now = new Date()
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  })
  const list = slots.filter((s) => s.day_of_week === today).sort((a, b) => a.start_time.localeCompare(b.start_time))
  if (!list.length) return <p className="py-4 text-sm text-ink-300">{empty}</p>
  return (
    <ol className="divide-y divide-line">
      {list.map((s) => {
        const live = s.start_time <= hhmm && hhmm < s.end_time
        return (
          <li key={s.session_key ?? s.slot_id ?? `${s.day_of_week}-${s.period_number}`} className="flex flex-wrap items-center gap-3 py-2.5">
            <div className="w-24 text-xs tabular-nums text-ink-500">P{s.period_number} · {s.start_time}</div>
            <div className="min-w-32 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium text-fg">{s.subject_name}{live && <span className="rounded-full bg-ok px-1.5 text-[10px] font-semibold text-white">NOW</span>}</div>
              <div className="text-xs text-ink-500">{secondary === 'teacher' ? (s.teacher_name ?? '') : s.class_name}{s.room_number ? ` · ${s.room_number}` : ''}</div>
            </div>
            {action?.(s)}
          </li>
        )
      })}
    </ol>
  )
}
