import { useMemo, useState } from 'react'
import { CalendarRange, Copy, Plus } from 'lucide-react'
import { CalendarLegend, CalendarToolbar, TimetableCalendar } from '@/components/timetable/TimetableCalendar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/field'
import { ErrorState, Skeleton } from '@/components/ui/loading'
import { todayISO, viewRange, type CalendarView } from '@/lib/calendar'
import { useAsync } from '@/lib/useAsync'
import { timetableService } from '@/services/timetableService'
import type { Member, Room, SchoolClass, TimetableSession } from '@/types'
import { CopyDialog } from './CopyDialog'
import { SessionDialog, type SessionTarget } from './SessionDialog'

type Mode = 'class' | 'teacher' | 'all'

/**
 * Dated timetable calendar (spec 5.1, 5.4): day / week / month, class-wise, teacher-wise or the whole institution.
 * Click a session to change, cancel or restore it for that date; click a free period to add one; copy a day or week.
 */
export function DatedCalendarPanel({ org, classes, teachers, rooms }: { org?: string | null; classes: SchoolClass[]; teachers: Member[]; rooms: Room[] }) {
  const [mode, setMode] = useState<Mode>('class')
  const [klassPick, setKlass] = useState(classes[0]?.class_code ?? '')
  const [teacherPick, setTeacher] = useState(teachers[0]?.user_code ?? '')
  // The lists can change underneath (e.g. a class deactivated): fall back to the first one.
  const klass = classes.some((c) => c.class_code === klassPick) ? klassPick : classes[0]?.class_code ?? ''
  const teacher = teachers.some((t) => t.user_code === teacherPick) ? teacherPick : teachers[0]?.user_code ?? ''
  const [view, setView] = useState<CalendarView>(() => (typeof window !== 'undefined' && window.innerWidth < 640 ? 'day' : 'week'))
  const [today] = useState(todayISO)
  const [anchor, setAnchor] = useState(today)
  const [editing, setEditing] = useState<SessionTarget | null>(null)
  const [copying, setCopying] = useState(false)


  const range = viewRange(view, anchor)
  const filter = mode === 'class' ? { class_code: klass } : mode === 'teacher' ? { teacher_code: teacher } : {}
  const ready = mode === 'all' || Object.values(filter)[0]
  const { data, error, loading, retry } = useAsync(
    (signal) => (ready ? timetableService.calendar({ ...range, ...filter }, org, signal) : Promise.resolve(null)),
    [org, mode, klass, teacher, range.start, range.end],
  )
  const columns = useMemo(() => classes.map((c) => ({ code: c.class_code, label: c.class_name })), [classes])
  // Teacher-wise: a period of theirs covered by someone else on a date is shown as "Covered by …"
  const sessions = useMemo(() => (data && mode === 'teacher' ? data.sessions.map((s) => ({ ...s, is_mine: s.teacher_code === teacher })) : data?.sessions ?? []),
    [data, mode, teacher])
  const cls = classes.find((c) => c.class_code === klass)

  function openSession(s: TimetableSession) { setEditing({ session: s, date: s.session_date, period: s.period_number }) }
  function openEmpty(date: string, period: number, classCode?: string) {
    setEditing({ date, period, class_code: classCode ?? (mode === 'class' ? klass : undefined) })
  }

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><CalendarRange className="h-5 w-5 text-brand-600" /> Timetable calendar</CardTitle>
            <CardDescription>Real dates: the weekly pattern plus one-day changes, substitutions, extra sessions, cancellations and holidays.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Show" className="w-44" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <option value="class">Class-wise</option>
              <option value="teacher">Teacher-wise</option>
              <option value="all">Whole institution</option>
            </Select>
            {mode === 'class' && (
              <Select aria-label="Class" className="w-56" value={klass} onChange={(e) => setKlass(e.target.value)}>
                {classes.map((c) => <option key={c.class_code} value={c.class_code}>{c.class_name}</option>)}
              </Select>
            )}
            {mode === 'teacher' && (
              <Select aria-label="Teacher" className="w-56" value={teacher} onChange={(e) => setTeacher(e.target.value)}>
                {teachers.map((t) => <option key={t.user_code} value={t.user_code}>{t.full_name}</option>)}
              </Select>
            )}
            {mode === 'class' && cls && <Badge tone={cls.timetable_status === 'DRAFT' ? 'neutral' : 'ok'}>{cls.timetable_status === 'DRAFT' ? 'Draft' : 'Published'}</Badge>}
          </div>
        </div>
        <CalendarToolbar view={view} anchor={anchor} today={today} onView={setView} onAnchor={setAnchor}>
          <Button size="sm" variant="secondary" onClick={() => setCopying(true)} id="open-copy"><Copy className="h-3.5 w-3.5" /> Copy from date</Button>
          <Button size="sm" onClick={() => setEditing({ date: anchor, period: 1, class_code: mode === 'class' ? klass : undefined })} id="add-session" disabled={!classes.length}>
            <Plus className="h-3.5 w-3.5" /> Add session
          </Button>
        </CalendarToolbar>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <ErrorState message={error} onRetry={retry} /> : loading && !data ? <Skeleton className="h-96" /> : data && (
          <div className={loading ? 'opacity-60 transition-opacity' : undefined} aria-busy={loading}>
            {mode === 'all' && view === 'week' && <p className="mb-2 text-xs text-ink-500">Every class's sessions. Switch to the day view for a class-by-period grid.</p>}
            <TimetableCalendar view={view} anchor={anchor} sessions={sessions} holidays={data.holidays} bell={data.bell_schedule}
              workingDays={data.working_days} today={today} secondary={mode === 'class' ? 'teacher' : mode === 'teacher' ? 'class' : 'both'}
              columns={mode === 'all' && view === 'day' ? columns : undefined}
              onSession={openSession} onEmpty={mode === 'teacher' ? undefined : openEmpty}
              onDay={(d) => { setAnchor(d); setView('day') }} />
            <div className="mt-3"><CalendarLegend /></div>
          </div>
        )}
        {mode === 'class' && cls?.timetable_status === 'DRAFT' && <p className="text-xs text-warn">Draft — this class's timetable (weekly and dated) is hidden from its teachers and students until it is published.</p>}
      </CardContent>

      {editing && (
        <SessionDialog key={`${editing.session?.session_key ?? `${editing.date}-${editing.period}-${editing.class_code ?? ''}`}`}
          target={editing} classes={classes} teachers={teachers} rooms={rooms} bell={data?.bell_schedule ?? null} org={org}
          fixedClass={mode === 'class'} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); retry() }} />
      )}
      {copying && (
        <CopyDialog org={org} classes={classes} teachers={teachers}
          initial={{ date: anchor, class_code: mode === 'class' ? klass : undefined, teacher_code: mode === 'teacher' ? teacher : undefined }}
          onClose={() => setCopying(false)} onDone={retry} />
      )}
    </Card>
  )
}
