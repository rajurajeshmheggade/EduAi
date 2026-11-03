import { MyTimetableView } from '@/components/timetable/MyTimetableView'

/** FR-TE-01: the teacher's dated timetable across all classes, with one-click attendance for today's periods. */
export default function TeacherTimetable() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <header className="animate-fade-up">
        <h1 className="font-display text-3xl font-bold">My <span className="text-gradient">timetable</span></h1>
        <p className="mt-1 text-sm text-ink-300">Your periods across all classes as published by the institution admin, including one-day changes and substitutions.</p>
      </header>
      <MyTimetableView role="teacher" />
    </div>
  )
}
