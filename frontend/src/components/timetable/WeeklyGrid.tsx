import { useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { DAY_NAMES, DAY_SHORT, defaultPeriodTimes } from '@/lib/timetable'
import { cn } from '@/lib/utils'
import type { TimetableSlot } from '@/types'

const TYPE_TONE: Record<string, string> = {
  THEORY: 'border-brand-400/40 bg-brand-500/8',
  LAB: 'border-aqua-400/40 bg-aqua-500/10',
  COACHING_TEST: 'border-warn/40 bg-warn/10',
}

/**
 * Days × periods grid. `secondary` picks what the second line shows: the teacher (class view) or the class
 * (teacher view). Pass `onCell` to make cells editable.
 */
export function WeeklyGrid({ slots, secondary, today, onCell, minPeriods = 8 }: {
  slots: TimetableSlot[]
  secondary: 'teacher' | 'class'
  today?: number
  onCell?: (day: number, period: number, slot?: TimetableSlot) => void
  minPeriods?: number
}) {
  const days = slots.some((s) => s.day_of_week === 7) ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5, 6]
  const periods = Math.max(minPeriods, ...slots.map((s) => s.period_number))
  const at = new Map(slots.map((s) => [`${s.day_of_week}-${s.period_number}`, s]))

  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[46rem] border-collapse text-xs">
        <thead className="bg-ink-800 text-ink-500">
          <tr>
            <th className="w-20 px-2 py-2 text-left font-medium">Period</th>
            {days.map((d) => (
              <th key={d} className={cn('px-2 py-2 text-center font-medium', d === today && 'text-brand-600')}>
                {DAY_SHORT[d]}{d === today && <span className="ml-1 rounded bg-brand-500 px-1 text-[10px] text-white">Today</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: periods }, (_, i) => i + 1).map((p) => (
            <tr key={p} className="border-t border-line">
              <td className="px-2 py-1.5 align-top">
                <div className="font-semibold text-fg">P{p}</div>
                <div className="text-[10px] text-ink-500">{defaultPeriodTimes(p).start}</div>
              </td>
              {days.map((d) => {
                const s = at.get(`${d}-${p}`)
                const Cell = onCell ? 'button' : 'div'
                return (
                  <td key={d} className={cn('p-1 align-top', d === today && 'bg-brand-500/4')}>
                    <Cell
                      {...(onCell ? { type: 'button' as const, onClick: () => onCell(d, p, s), 'aria-label': `${DAY_NAMES[d]} period ${p}${s ? `: ${s.subject_name}` : ' (empty)'}` } : {})}
                      className={cn('block min-h-14 w-full rounded-lg border p-1.5 text-left transition-colors',
                        s ? TYPE_TONE[s.subject_type] ?? TYPE_TONE.THEORY : 'border-dashed border-line',
                        onCell && 'cursor-pointer hover:border-brand-400',
                        onCell && !s && 'grid place-items-center text-ink-500')}
                    >
                      {s ? (
                        <>
                          <div className="truncate font-semibold text-fg">{s.subject_name}</div>
                          <div className="truncate text-[11px] text-ink-300">{secondary === 'teacher' ? (s.teacher_name ?? 'No teacher') : s.class_name}</div>
                          <div className="text-[10px] tabular-nums text-ink-500">{s.start_time}–{s.end_time}{s.room_number ? ` · ${s.room_number}` : ''}</div>
                        </>
                      ) : onCell ? <Plus className="h-3.5 w-3.5" /> : null}
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

/** Today's periods as a list (dashboards). */
export function TodayList({ slots, today, secondary, action }: {
  slots: TimetableSlot[]
  today: number
  secondary: 'teacher' | 'class'
  action?: (s: TimetableSlot) => ReactNode
}) {
  const [hhmm] = useState(() => {
    const now = new Date()
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  })
  const list = slots.filter((s) => s.day_of_week === today).sort((a, b) => a.start_time.localeCompare(b.start_time))
  if (!list.length) return <p className="py-4 text-sm text-ink-300">No classes scheduled today.</p>
  return (
    <ol className="divide-y divide-line">
      {list.map((s) => {
        const live = s.start_time <= hhmm && hhmm < s.end_time
        return (
          <li key={s.slot_id} className="flex flex-wrap items-center gap-3 py-2.5">
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
