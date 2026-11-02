import { Link } from 'react-router-dom'
import { CalendarCheck, CalendarClock, Video } from 'lucide-react'
import { RecentTimetableChanges, UpcomingHolidays } from '@/components/timetable/ChangesAndHolidays'
import { TodayList, WeeklyGrid } from '@/components/timetable/WeeklyGrid'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorState, Skeleton } from '@/components/ui/loading'
import { markAttendanceLink } from '@/lib/timetable'
import { useAsync } from '@/lib/useAsync'
import { classroomService } from '@/services/classroomService'

/** FR-TE-01: the teacher's assigned weekly timetable with one-click attendance for today's periods. */
export default function TeacherTimetable() {
  const { data, error, retry } = useAsync(() => classroomService.myTimetable(), [])

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <header className="animate-fade-up">
        <h1 className="font-display text-3xl font-bold">My <span className="text-gradient">timetable</span></h1>
        <p className="mt-1 text-sm text-ink-300">Your periods across all classes, as published by the institution admin.</p>
      </header>
      {error && <ErrorState title="Couldn’t load your timetable" message={error} onRetry={retry} />}
      {!data ? !error && <div className="space-y-6"><Skeleton className="h-40" /><Skeleton className="h-96" /></div> : (
        <>
          <RecentTimetableChanges changes={data.recent_changes} />
          <UpcomingHolidays holidays={data.holidays} />
          {data.slots.length === 0 ? (
            <Card className="p-10 text-center text-sm text-ink-300"><CalendarClock className="mx-auto mb-2 h-8 w-8 text-ink-500" />No periods assigned to you yet.</Card>
          ) : (
            <>
              <Card>
                <CardHeader><CardTitle className="text-base">Today</CardTitle></CardHeader>
                <CardContent>
                  <TodayList slots={data.slots} today={data.today} secondary="class"
                    action={(s) => (
                      <div className="flex gap-2">
                        {s.is_online && s.online_url && (
                          <a href={s.online_url} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary"><Video className="h-3.5 w-3.5" /> Join online</Button></a>
                        )}
                        <Link to={markAttendanceLink(s)}><Button size="sm" variant="secondary"><CalendarCheck className="h-3.5 w-3.5" /> Mark attendance</Button></Link>
                      </div>
                    )} />
                </CardContent>
              </Card>
              <WeeklyGrid slots={data.slots} secondary="class" today={data.today} />
            </>
          )}
        </>
      )}
    </div>
  )
}
