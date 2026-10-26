import { useEffect, useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { TodayList, WeeklyGrid } from '@/components/timetable/WeeklyGrid'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { errorMessage } from '@/services/apiClient'
import { classroomService } from '@/services/classroomService'
import type { TimetableSlot } from '@/types'

/** FR-ST-03: the student's daily and weekly class timetable with period timings and teachers. */
export default function StudentTimetable() {
  const [data, setData] = useState<{ today: number; slots: TimetableSlot[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { classroomService.myTimetable().then(setData).catch((e) => setError(errorMessage(e))) }, [])

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <header className="animate-fade-up">
        <h1 className="font-display text-3xl font-bold">Class <span className="text-gradient">timetable</span></h1>
        <p className="mt-1 text-sm text-ink-300">Your periods for the week, with timings, rooms and teachers.</p>
      </header>
      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      {!data ? !error && <div className="skeleton h-96" /> : data.slots.length === 0 ? (
        <Card className="p-10 text-center text-sm text-ink-300"><CalendarClock className="mx-auto mb-2 h-8 w-8 text-ink-500" />Your timetable hasn’t been published yet.</Card>
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">Today</CardTitle></CardHeader>
            <CardContent><TodayList slots={data.slots} today={data.today} secondary="teacher" /></CardContent>
          </Card>
          <WeeklyGrid slots={data.slots} secondary="teacher" today={data.today} />
        </>
      )}
    </div>
  )
}
