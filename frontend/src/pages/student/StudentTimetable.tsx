import { MyTimetableView } from '@/components/timetable/MyTimetableView'

/** FR-ST-03: the student's daily, weekly and monthly class timetable with timings, rooms, teachers and changes. */
export default function StudentTimetable() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <header className="animate-fade-up">
        <h1 className="font-display text-3xl font-bold">Class <span className="text-gradient">timetable</span></h1>
        <p className="mt-1 text-sm text-ink-300">Your periods by day, week or month, with timings, rooms, teachers and any changes for a date.</p>
      </header>
      <MyTimetableView role="student" />
    </div>
  )
}
