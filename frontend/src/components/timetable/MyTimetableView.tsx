import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarCheck, CalendarClock, CalendarOff, Video } from 'lucide-react'
import { RecentTimetableChanges, UpcomingHolidays } from '@/components/timetable/ChangesAndHolidays'
import { CalendarLegend, CalendarToolbar, TimetableCalendar } from '@/components/timetable/TimetableCalendar'
import { TodayList } from '@/components/timetable/WeeklyGrid'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorState, Skeleton } from '@/components/ui/loading'
import { isoWeekday, todayISO, viewRange, type CalendarView } from '@/lib/calendar'
import { markAttendanceLink } from '@/lib/timetable'
import { useAsync } from '@/lib/useAsync'
import { classroomService } from '@/services/classroomService'
import type { TimetableSession } from '@/types'

/**
 * The dated timetable as a teacher or student sees it (FR-TE-01 / FR-ST-03): today's periods, then a day / week /
 * month calendar of the published timetable with one-day changes, cancellations and holidays applied.
 */
export function MyTimetableView({ role }: { role: 'teacher' | 'student' }) {
  const [today] = useState(todayISO)
  const [view, setView] = useState<CalendarView>(() => (typeof window !== 'undefined' && window.innerWidth < 640 ? 'day' : 'week'))
  const [anchor, setAnchor] = useState(today)
  const range = viewRange(view, anchor)
  const now = useAsync((signal) => classroomService.myTimetable({ start: today, end: today }, signal), [today])
  const cal = useAsync((signal) => classroomService.myTimetable(range, signal), [range.start, range.end])
  const teacher = role === 'teacher'

  if (now.error) return <ErrorState message={now.error} onRetry={now.retry} />
  if (!now.data) return <div className="space-y-4"><Skeleton className="h-40" /><Skeleton className="h-96" /></div>

  const todays = now.data.sessions.filter((s) => s.session_date === today)
  const running = todays.filter((s) => s.status === 'SCHEDULED' && (!teacher || s.is_mine !== false))
  const off = todays.filter((s) => s.status !== 'SCHEDULED' || s.is_mine === false)
  const holidayToday = now.data.range_holidays.find((h) => h.is_full_day)
  const nothingAtAll = now.data.slots.length === 0 && (cal.data?.sessions.length ?? 0) === 0 && todays.length === 0

  return (
    <>
      <RecentTimetableChanges changes={now.data.recent_changes} />
      <UpcomingHolidays holidays={now.data.holidays} />
      {nothingAtAll && !cal.loading ? (
        <Card className="p-10 text-center text-sm text-ink-300">
          <CalendarClock className="mx-auto mb-2 h-8 w-8 text-ink-500" />
          {teacher ? 'No periods assigned to you yet.' : 'Your timetable hasn’t been published yet.'}
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">Today</CardTitle></CardHeader>
            <CardContent>
              {holidayToday && (
                <p className="mb-2 flex items-center gap-2 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad"><CalendarOff className="h-4 w-4" /> {holidayToday.name}</p>
              )}
              <TodayList<TimetableSession> slots={running} today={isoWeekday(today)} secondary={teacher ? 'class' : 'teacher'}
                empty={holidayToday ? 'No classes today.' : 'No classes scheduled today.'}
                action={(s) => (
                  <div className="flex gap-2">
                    {s.is_online && s.online_url && (
                      <a href={s.online_url} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary"><Video className="h-3.5 w-3.5" /> Join online</Button></a>
                    )}
                    {teacher && s.subject_code && (
                      <Link to={markAttendanceLink(s)}><Button size="sm" variant="secondary"><CalendarCheck className="h-3.5 w-3.5" /> Mark attendance</Button></Link>
                    )}
                  </div>
                )} />
              {off.length > 0 && (
                <ul className="mt-2 space-y-1 border-t border-line pt-2 text-xs text-ink-500">
                  {off.map((s) => (
                    <li key={s.session_key}>
                      <span className="line-through">P{s.period_number} {s.subject_name}{teacher ? ` · ${s.class_name}` : ''}</span>{' '}
                      — {s.is_mine === false && s.status === 'SCHEDULED' ? `covered by ${s.teacher_name}` : s.status === 'HOLIDAY' ? `holiday${s.holiday_name ? ` (${s.holiday_name})` : ''}` : `cancelled${s.note ? `: ${s.note}` : ''}`}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="gap-3">
              <CardTitle className="text-base">Calendar</CardTitle>
              <CalendarToolbar view={view} anchor={anchor} today={today} onView={setView} onAnchor={setAnchor} />
            </CardHeader>
            <CardContent>
              {cal.error ? <ErrorState message={cal.error} onRetry={cal.retry} /> : !cal.data ? <Skeleton className="h-96" /> : (
                <div className={cal.loading ? 'opacity-60 transition-opacity' : undefined} aria-busy={cal.loading}>
                  <TimetableCalendar view={view} anchor={anchor} sessions={cal.data.sessions} holidays={cal.data.range_holidays}
                    bell={cal.data.bell_schedule} workingDays={cal.data.working_days} today={today} secondary={teacher ? 'class' : 'teacher'}
                    hideClosedDays onDay={(d) => { setAnchor(d); setView('day') }} />
                  <div className="mt-3"><CalendarLegend /></div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </>
  )
}
