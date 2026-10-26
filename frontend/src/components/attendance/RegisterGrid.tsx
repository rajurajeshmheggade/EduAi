import { ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { fmtPct, pctTone } from '@/components/ui/stat'
import { isoMonth, monthLabel, shiftMonth } from '@/services/classroomService'
import { cn } from '@/lib/utils'
import type { AttendanceRegister } from '@/types'
import { STATUS_META } from './status'

export function MonthPicker({ value, onChange, max = isoMonth() }: { value: string; onChange: (m: string) => void; max?: string }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-line bg-ink-900 p-1">
      <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Previous month" onClick={() => onChange(shiftMonth(value, -1))}><ChevronLeft className="h-4 w-4" /></Button>
      <span className="min-w-36 text-center text-sm font-medium text-fg" aria-live="polite">{monthLabel(value)}</span>
      <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Next month" disabled={value >= max} onClick={() => onChange(shiftMonth(value, 1))}><ChevronRight className="h-4 w-4" /></Button>
    </div>
  )
}

/** Monthly attendance register: students × marked days, with totals, % and defaulter flags (FR-T3-02). */
export function RegisterGrid({ reg }: { reg: AttendanceRegister }) {
  if (reg.students.length === 0) return <p className="py-10 text-center text-sm text-ink-300">No students in this class yet.</p>
  const days = reg.marked_days
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge>{reg.sessions_held} period{reg.sessions_held === 1 ? '' : 's'} held</Badge>
        <Badge tone="brand">Class average {fmtPct(reg.class_average)}</Badge>
        {reg.defaulters.length > 0
          ? <Badge tone="bad"><TriangleAlert className="h-3 w-3" /> {reg.defaulters.length} below {reg.threshold}%</Badge>
          : <Badge tone="ok">No one below {reg.threshold}%</Badge>}
      </div>
      {days.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line py-10 text-center text-sm text-ink-300">No attendance marked in {monthLabel(reg.month)}.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full border-collapse text-xs">
            <thead className="bg-ink-800 text-ink-500">
              <tr>
                <th className="sticky left-0 z-10 bg-ink-800 px-3 py-2 text-left font-medium">Student</th>
                {days.map((d) => <th key={d} className="px-1.5 py-2 text-center font-medium tabular-nums" title={d}>{Number(d.slice(8))}</th>)}
                <th className="px-2 py-2 text-center font-medium">P</th><th className="px-2 py-2 text-center font-medium">A</th>
                <th className="px-2 py-2 text-center font-medium">L</th><th className="px-2 py-2 text-center font-medium">LV</th>
                <th className="px-3 py-2 text-right font-medium">%</th>
              </tr>
            </thead>
            <tbody>
              {reg.students.map((s) => (
                <tr key={s.student_user_code} className={cn('border-t border-line', s.is_defaulter && 'bg-bad/5')}>
                  <td className={cn('sticky left-0 z-10 whitespace-nowrap px-3 py-1.5', s.is_defaulter ? 'bg-[color-mix(in_oklab,var(--color-bad)_5%,white)]' : 'bg-ink-900')}>
                    <span className="mr-2 inline-block w-5 text-right tabular-nums text-ink-500">{s.roll_number ?? ''}</span>
                    <span className="font-medium text-fg">{s.full_name}</span>
                  </td>
                  {days.map((d) => (
                    <td key={d} className="px-0.5 py-1 text-center">
                      <div className="flex justify-center gap-0.5">
                        {(s.days[d] ?? []).map((st, i) => (
                          <span key={i} title={`${d}: ${STATUS_META[st].label}`} className={cn('grid h-5 w-5 place-items-center rounded font-semibold', STATUS_META[st].cell)}>{STATUS_META[st].short}</span>
                        ))}
                        {!s.days[d] && <span className="text-ink-500">·</span>}
                      </div>
                    </td>
                  ))}
                  <td className="px-2 text-center tabular-nums text-ok">{s.present}</td>
                  <td className="px-2 text-center tabular-nums text-bad">{s.absent}</td>
                  <td className="px-2 text-center tabular-nums text-warn">{s.late}</td>
                  <td className="px-2 text-center tabular-nums text-brand-600">{s.excused}</td>
                  <td className={cn('px-3 text-right font-semibold tabular-nums', pctTone(s.percentage, reg.threshold))}>{fmtPct(s.percentage)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-ink-500">Percentage = (Present + Late) ÷ (periods − Leave). P Present · A Absent · L Late · LV Leave.</p>
    </div>
  )
}
