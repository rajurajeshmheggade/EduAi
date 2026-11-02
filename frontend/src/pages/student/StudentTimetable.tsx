import { CalendarClock, Video } from 'lucide-react'
import { RecentTimetableChanges, UpcomingHolidays } from '@/components/timetable/ChangesAndHolidays'
import { TodayList, WeeklyGrid } from '@/components/timetable/WeeklyGrid'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorState, Skeleton } from '@/components/ui/loading'
import { useAsync } from '@/lib/useAsync'
import { classroomService } from '@/services/classroomService'

/** FR-ST-03: the student's daily and weekly class timetable with period timings and teachers. */
export default function StudentTimetable() {
  const { data, error, retry } = useAsync(() => classroomService.myTimetable(), [])

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <header className="animate-fade-up">
        <h1 className="font-display text-3xl font-bold">Class <span className="text-gradient">timetable</span></h1>
        <p className="mt-1 text-sm text-ink-300">Your periods for the week, with timings, rooms and teachers.</p>
      </header>
      {error && <ErrorState title="Couldn’t load your timetable" message={error} onRetry={retry} />}
      {!data ? !error && <div className="space-y-6"><Skeleton className="h-40" /><Skeleton className="h-96" /></div> : (
        <>
          <RecentTimetableChanges changes={data.recent_changes} />
          <UpcomingHolidays holidays={data.holidays} />
          {data.slots.length === 0 ? (
            <Card className="p-10 text-center text-sm text-ink-300"><CalendarClock className="mx-auto mb-2 h-8 w-8 text-ink-500" />Your timetable hasn’t been published yet.</Card>
          ) : (
            <>
              <Card>
                <CardHeader><CardTitle className="text-base">Today</CardTitle></CardHeader>
                <CardContent>
                  <TodayList slots={data.slots} today={data.today} secondary="teacher"
                    action={(s) => s.is_online && s.online_url ? (
                      <a href={s.online_url} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary"><Video className="h-3.5 w-3.5" /> Join online</Button></a>
                    ) : undefined} />
                </CardContent>
              </Card>
              <WeeklyGrid slots={data.slots} secondary="teacher" today={data.today} />
            </>
          )}
        </>
      )}
    </div>
  )
}
