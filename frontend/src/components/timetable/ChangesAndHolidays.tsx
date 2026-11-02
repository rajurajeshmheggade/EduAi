import { CalendarOff, History } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatShort } from '@/lib/calendar'
import { DAY_NAMES } from '@/lib/timetable'
import type { Holiday, TimetableChange } from '@/types'

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

const KIND: Record<TimetableChange['change_kind'], { label: string; tone: 'bad' | 'warn' | 'ok' | 'brand' }> = {
  CANCELLED: { label: 'Period removed', tone: 'bad' },
  UPDATED: { label: 'Period updated', tone: 'warn' },
  ADDED: { label: 'Extra period', tone: 'ok' },
  RESTORED: { label: 'Back to normal', tone: 'brand' },
}

/** #3B: shows recently changed/cancelled periods (with old vs new details, reason, who and when) and #10:
 * upcoming published holidays. Shared by TeacherTimetable and StudentTimetable. A change to one date (dated
 * timetable) names that date; a change to the weekly pattern names the weekday. */
export function RecentTimetableChanges({ changes }: { changes: TimetableChange[] }) {
  if (changes.length === 0) return null
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4 text-brand-600" /> Recent timetable changes</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {changes.map((c) => (
          <div key={c.change_id} className="rounded-xl border border-line p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-fg">{c.new_subject_name ?? c.old_subject_name}</span>
              <Badge tone={KIND[c.change_kind].tone}>{c.session_date && c.change_kind === 'CANCELLED' ? 'Cancelled' : KIND[c.change_kind].label}</Badge>
              <span className="text-xs text-ink-500">{c.session_date ? formatShort(c.session_date) : `${DAY_NAMES[c.day_of_week]}s`} · Period {c.period_number}</span>
            </div>
            <div className="mt-1.5 space-y-0.5 text-xs text-ink-300">
              {c.change_kind === 'UPDATED' || c.change_kind === 'RESTORED' ? (
                <>
                  {c.old_start_time && <div>Previous: {c.old_subject_name && c.old_subject_name !== c.new_subject_name ? `${c.old_subject_name} · ` : ''}{c.old_start_time}–{c.old_end_time}{c.old_teacher_name ? ` · ${c.old_teacher_name}` : ''}</div>}
                  <div>{c.change_kind === 'RESTORED' ? 'Now' : 'Updated'}: {c.new_start_time}–{c.new_end_time}{c.new_teacher_name ? ` · ${c.new_teacher_name}` : ''}</div>
                </>
              ) : c.change_kind === 'ADDED' ? (
                <div>{c.new_start_time}–{c.new_end_time}{c.new_teacher_name ? ` · ${c.new_teacher_name}` : ''}</div>
              ) : (
                <div>Was: {c.old_start_time}–{c.old_end_time}{c.old_teacher_name ? ` · ${c.old_teacher_name}` : ''}</div>
              )}
              {c.reason && <div>Reason: {c.reason}</div>}
              <div className="text-ink-500">Changed by {c.changed_by_name ?? 'the admin'} on {when(c.changed_at)}</div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function UpcomingHolidays({ holidays }: { holidays: Holiday[] }) {
  if (holidays.length === 0) return null
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CalendarOff className="h-4 w-4 text-brand-600" /> Upcoming holidays</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {holidays.map((h) => (
          <div key={h.holiday_id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-3 text-sm">
            <span className="font-medium text-fg">{h.name}</span>
            <Badge tone="neutral">{h.holiday_type === 'PUBLIC' ? 'Public holiday' : 'School holiday'}</Badge>
            {!h.is_full_day && <Badge tone="warn">Partial day</Badge>}
            <span className="text-xs text-ink-500">{h.start_date === h.end_date ? h.start_date : `${h.start_date} – ${h.end_date}`}</span>
            {h.description && <span className="w-full text-xs text-ink-500">{h.description}</span>}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
