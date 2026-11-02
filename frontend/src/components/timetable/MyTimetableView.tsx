import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarCheck, CalendarClock, Video } from 'lucide-react'
import { RecentTimetableChanges, UpcomingHolidays } from '@/components/timetable/ChangesAndHolidays'
import { CalendarLegend, CalendarToolbar, TimetableCalendar } from '@/components/timetable/TimetableCalendar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorState, Skeleton } from '@/components/ui/loading'
import { todayISO, viewRange, type CalendarView } from '@/lib/calendar'
import { markAttendanceLink } from '@/lib/timetable'
import { useAsync } from '@/lib/useAsync'
import { classroomService } from '@/services/classroomService'
import type { MyTimetable, TimetableSession } from '@/types'

/** The view the timetable opens on: today's periods (day view of today) for students and teachers alike. */
export const DEFAULT_TIMETABLE_VIEW: CalendarView = 'day'

/**
 * The dated timetable as a teacher or student sees it (FR-TE-01 / FR-ST-03). It opens on TODAY's timetable (the day
 * view of today, with the period running now marked and "Join online" / "Mark attendance" on today's periods); the
 * week and month views of the published timetable, with one-day changes, cancellations and holidays applied, are one
 * click away.
 */
export function MyTimetableView({ role }: { role: 'teacher' | 'student' }) {
  const [today] = useState(todayISO)
  const [view, setView] = useState<CalendarView>(DEFAULT_TIMETABLE_VIEW)
  const [anchor, setAnchor] = useState(today)
  const range = viewRange(view, anchor)
  const showingToday = range.start === today && range.end === today
  const now = useAsync((signal) => classroomService.myTimetable({ start: today, end: today }, signal), [today])
  // Today's day view reuses the request above rather than asking for the same date twice.
  const cal = useAsync<MyTimetable | null>((signal) => (showingToday ? Promise.resolve(null) : classroomService.myTimetable(range, signal)),
    [range.start, range.end, showingToday])
  const teacher = role === 'teacher'

  if (now.error) return <ErrorState message={now.error} onRetry={now.retry} />
  if (!now.data) return <div className="space-y-4"><Skeleton className="h-16" /><Skeleton className="h-96" /></div>

  const calData = showingToday ? now.data : cal.data
  const calError = showingToday ? undefined : cal.error
  const calLoading = !showingToday && cal.loading
  const todays = now.data.sessions.filter((s) => s.session_date === today)
  const nothingAtAll = now.data.slots.length === 0 && (calData?.sessions.length ?? 0) === 0 && todays.length === 0

  // Today's live periods get their shortcuts right on the card.
  const action = (s: TimetableSession) => {
    if (s.session_date !== today || s.status !== 'SCHEDULED' || (teacher && s.is_mine === false)) return null
    const online = s.is_online && s.online_url
    const attendance = teacher && s.subject_code
    if (!online && !attendance) return null
    return (
      <div className="flex flex-wrap gap-1.5">
        {online && (
          <a href={s.online_url!} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary"><Video className="h-3.5 w-3.5" /> Join online</Button></a>
        )}
        {attendance && (
          <Link to={markAttendanceLink(s)}><Button size="sm" variant="secondary"><CalendarCheck className="h-3.5 w-3.5" /> Mark attendance</Button></Link>
        )}
      </div>
    )
  }

  return (
    <>
      <RecentTimetableChanges changes={now.data.recent_changes} />
      <UpcomingHolidays holidays={now.data.holidays} />
      {nothingAtAll && !calLoading ? (
        <Card className="p-10 text-center text-sm text-ink-300">
          <CalendarClock className="mx-auto mb-2 h-8 w-8 text-ink-500" />
          {teacher ? 'No periods assigned to you yet.' : 'Your timetable hasn’t been published yet.'}
        </Card>
      ) : (
        <Card>
          <CardHeader className="gap-3">
            <CardTitle className="text-base">{showingToday && view === 'day' ? 'Today’s timetable' : 'Timetable'}</CardTitle>
            <CalendarToolbar view={view} anchor={anchor} today={today} onView={setView} onAnchor={setAnchor} />
          </CardHeader>
          <CardContent>
            {calError ? <ErrorState message={calError} onRetry={cal.retry} /> : !calData ? <Skeleton className="h-96" /> : (
              <div className={calLoading ? 'opacity-60 transition-opacity' : undefined} aria-busy={calLoading}>
                <TimetableCalendar view={view} anchor={anchor} sessions={calData.sessions} holidays={calData.range_holidays}
                  bell={calData.bell_schedule} workingDays={calData.working_days} today={today} secondary={teacher ? 'class' : 'teacher'}
                  hideClosedDays sessionAction={action} onDay={(d) => { setAnchor(d); setView('day') }} />
                <div className="mt-3"><CalendarLegend /></div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  )
}
