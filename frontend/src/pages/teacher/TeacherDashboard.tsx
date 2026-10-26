import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, BarChart3, BookOpenCheck, CalendarCheck, CalendarClock, CheckCircle2, ClipboardCheck, ClipboardList, FileCheck2,
  PencilRuler, ScanText, School, Users,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { BarList } from '@/components/evaluation/BarList'
import { Empty, HeroBanner, Kpi, Panel } from '@/components/dashboard/Widgets'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { errorMessage } from '@/services/apiClient'
import { dashboardService, type TeacherDash } from '@/services/dashboardService'
import { greeting, longDate, shortDateTime } from '@/lib/datetime'
import { markAttendanceLink } from '@/lib/timetable'
import { cn } from '@/lib/utils'
import { num } from '@/types'

const TYPE_LINK = { ONLINE_TEST: '/teacher/tests', ASSIGNMENT: '/teacher/assignments', OFFLINE_EXAM: '/teacher/evaluation' } as const
const TYPE_LABEL = { ONLINE_TEST: 'Online test', ASSIGNMENT: 'Assignment', OFFLINE_EXAM: 'Exam' } as const

/** Teacher home: today's periods with attendance status, work needing attention, open assessments and class signals. */
export default function TeacherDashboard() {
  const { user } = useAuth()
  const [d, setD] = useState<TeacherDash | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hello] = useState(() => greeting())
  const [hhmm] = useState(() => new Date().toTimeString().slice(0, 5))

  useEffect(() => { dashboardService.teacher().then(setD).catch((e) => setError(errorMessage(e))) }, [])
  if (!user) return null
  const first = user.full_name.split(' ')[0]
  const k = d?.kpis

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <HeroBanner
        eyebrow={`${longDate(d?.today)} · ${user.org_name ?? ''}`}
        title={<>{hello}, {first}</>}
        subtitle={k ? <>You have <b>{k.periods_today} period{k.periods_today === 1 ? '' : 's'}</b> today{k.attendance_pending ? <> · <b>{k.attendance_pending}</b> attendance to mark</> : ''}{k.homework_to_review ? <> · <b>{k.homework_to_review}</b> homework to review</> : ''}.</> : 'Loading your day…'}
        actions={[
          { to: '/teacher/attendance', label: 'Mark attendance', icon: CalendarCheck, primary: true },
          { to: '/teacher/tests?new=1', label: 'New test', icon: PencilRuler },
          { to: '/teacher/assignments?new=1', label: 'New assignment', icon: ClipboardCheck },
          { to: '/teacher/homework', label: 'Post homework', icon: ClipboardList },
          { to: '/teacher/evaluation?new=1', label: 'Evaluate exam scripts', icon: ScanText },
        ]}
      />

      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      <section aria-label="Overview" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {!k ? Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-32" />) : <>
          <Kpi icon={School} label="My classes" value={k.classes} tone="brand" to="/teacher/classes" />
          <Kpi icon={Users} label="Students" value={k.students} tone="aqua" to="/teacher/classes" />
          <Kpi icon={CalendarClock} label="Periods today" value={k.periods_today} tone="neutral" to="/teacher/timetable" />
          <Kpi icon={CalendarCheck} label="Attendance to mark" value={k.attendance_pending} tone={k.attendance_pending ? 'warn' : 'ok'} to="/teacher/attendance" hint={k.attendance_pending ? 'for today’s periods' : 'All marked'} />
          <Kpi icon={FileCheck2} label="Homework to review" value={k.homework_to_review} tone={k.homework_to_review ? 'warn' : 'ok'} to="/teacher/homework" />
          <Kpi icon={AlertTriangle} label="Needs attention" value={k.needs_attention} tone={k.needs_attention ? 'bad' : 'ok'} hint={`${k.active_assessments} test(s) / assignment(s) open`} />
        </>}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Panel icon={CalendarClock} title="Today’s schedule" action={{ to: '/teacher/timetable', label: 'Full week' }}>
          {!d ? <div className="skeleton h-40" /> : d.today_slots.length === 0 ? <Empty icon={CalendarClock}>No periods scheduled today.</Empty> : (
            <ol className="relative space-y-3 before:absolute before:bottom-2 before:left-[3.4rem] before:top-2 before:w-px before:bg-line">
              {[...d.today_slots].sort((a, b) => a.start_time.localeCompare(b.start_time)).map((s) => {
                const live = s.start_time <= hhmm && hhmm < s.end_time
                const past = s.end_time <= hhmm
                return (
                  <li key={s.slot_id} className="relative flex items-center gap-4">
                    <span className={cn('w-11 text-right text-xs tabular-nums', live ? 'font-semibold text-brand-600' : 'text-ink-500')}>{s.start_time}</span>
                    <span className={cn('relative z-10 h-3 w-3 shrink-0 rounded-full ring-4 ring-ink-900', live ? 'bg-brand-500' : past ? 'bg-ink-700' : 'bg-aqua-500')} />
                    <div className={cn('flex min-w-0 flex-1 flex-wrap items-center gap-3 rounded-xl border p-3', live ? 'border-brand-400 bg-brand-500/6' : 'border-line')}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 font-medium text-fg">{s.subject_name}{live && <Badge tone="brand">Now</Badge>}</div>
                        <div className="text-xs text-ink-500">P{s.period_number} · {s.class_name}{s.room_number ? ` · ${s.room_number}` : ''} · {s.start_time}–{s.end_time}</div>
                      </div>
                      {s.attendance_marked
                        ? <span className="flex items-center gap-1 text-xs font-medium text-ok"><CheckCircle2 className="h-4 w-4" /> Attendance saved</span>
                        : <Link to={markAttendanceLink(s)}><Button size="sm" variant={live || past ? 'default' : 'secondary'}><CalendarCheck className="h-3.5 w-3.5" /> Mark attendance</Button></Link>}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </Panel>

        <Panel icon={AlertTriangle} title="Needs your attention">
          {!d ? <div className="skeleton h-40" /> : d.attention.length === 0 && d.homework_to_review.length === 0 ? (
            <Empty icon={CheckCircle2}>You’re all caught up.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {d.homework_to_review.map((h) => (
                <li key={h.homework_id} className="flex items-center gap-3 py-2.5">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-warn/12"><ClipboardList className="h-4 w-4 text-warn" /></span>
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-fg">{h.title}</div><div className="text-xs text-ink-500">{h.class_code} · {h.subject_code} · {h.to_review} to review</div></div>
                  <Link to="/teacher/homework" className="text-xs font-medium text-brand-600 hover:underline">Review</Link>
                </li>
              ))}
              {d.attention.map((a) => (
                <li key={a.eval_test_id} className="flex items-center gap-3 py-2.5">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-bad/10"><AlertTriangle className="h-4 w-4 text-bad" /></span>
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-fg">{a.test_title}</div><div className="text-xs text-ink-500">{TYPE_LABEL[a.assessment_type]} · {a.reasons?.join(' · ')}</div></div>
                  <Link to={TYPE_LINK[a.assessment_type]} className="text-xs font-medium text-brand-600 hover:underline">Open</Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel icon={PencilRuler} title="Open tests & assignments" action={{ to: '/teacher/tests', label: 'All tests' }}>
          {!d ? <div className="skeleton h-40" /> : d.active_assessments.length === 0 ? <Empty icon={PencilRuler}>Nothing open right now. <Link to="/teacher/tests?new=1" className="text-brand-600 hover:underline">Create a test</Link></Empty> : (
            <ul className="space-y-3">
              {d.active_assessments.map((a) => {
                const pct = a.class_students ? Math.round((100 * a.submitted) / a.class_students) : 0
                return (
                  <li key={a.eval_test_id}>
                    <Link to={TYPE_LINK[a.assessment_type]} className="block rounded-xl border border-line p-3 transition-colors hover:border-line-strong">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0"><div className="truncate font-medium text-fg">{a.test_title}</div><div className="text-xs text-ink-500">{TYPE_LABEL[a.assessment_type]} · {a.class_name} · {a.subject_name}</div></div>
                        <Badge tone="warn">Due {shortDateTime(a.due_at)}</Badge>
                      </div>
                      <div className="mt-2 flex items-center gap-3"><Progress value={pct} tone="ok" className="flex-1" /><span className="text-xs tabular-nums text-ink-300">{a.submitted}/{a.class_students} submitted</span></div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>

        <Panel icon={BarChart3} title="Attendance this month" action={{ to: '/teacher/attendance', label: 'Registers' }}>
          {!d ? <div className="skeleton h-40" /> : d.attendance_month.length === 0 ? <Empty icon={CalendarCheck}>No attendance marked this month yet.</Empty> : (
            <BarList caption="Attendance % by class and subject (present + late)" valueHeader="Attendance"
              data={d.attendance_month.map((m) => ({
                key: `${m.class_code}-${m.subject_code}`, label: m.class_code, value: m.percentage,
                display: m.percentage == null ? '—' : `${m.percentage}%`, flag: m.percentage != null && m.percentage < 75 ? 'Below 75%' : undefined,
                tooltip: [m.subject_code, `${m.sessions} period(s) held`, `${m.absent} absences · ${m.late} late`],
              }))} />
          )}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Panel icon={School} title="My classes" action={{ to: '/teacher/classes', label: 'Manage' }}>
          {!d ? <div className="skeleton h-32" /> : d.classes.length === 0 ? <Empty icon={School}>No classes assigned yet.</Empty> : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {d.classes.map((c) => (
                <li key={c.class_code} className="rounded-xl border border-line p-3">
                  <div className="flex items-center justify-between gap-2"><span className="font-medium text-fg">{c.class_name}</span>{c.is_class_teacher && <Badge tone="brand">Class teacher</Badge>}</div>
                  <div className="mt-1 text-xs text-ink-500">{c.student_count} students · {c.subjects.map((s) => s.subject_name).join(', ')}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel icon={FileCheck2} title="Recent results">
          {!d ? <div className="skeleton h-32" /> : d.recent_results.length === 0 ? <Empty icon={ScanText}>Results appear here once scripts are evaluated.</Empty> : (
            <ul className="divide-y divide-line">
              {d.recent_results.map((a) => (
                <li key={a.eval_test_id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-fg">{a.test_title}</div><div className="text-xs text-ink-500">{TYPE_LABEL[a.assessment_type]} · {a.class_name} · {a.evaluated} evaluated</div></div>
                  <div className="w-28"><Progress value={num(a.average_percentage)} tone={num(a.average_percentage) < 40 ? 'bad' : 'ok'} /></div>
                  <span className="w-14 text-right text-sm font-semibold tabular-nums text-fg">{a.average_percentage != null ? `${num(a.average_percentage)}%` : '—'}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Link to="/teacher/textbooks" className="flex items-center gap-4 rounded-2xl border border-line bg-ink-900 p-4 transition-all hover:shadow-glow">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-500/10"><BookOpenCheck className="h-5 w-5 text-brand-600" /></span>
        <div className="flex-1"><div className="font-medium text-fg">Plan your next lesson with AI</div><div className="text-sm text-ink-300">Upload a textbook and get a chapter-wise “how to teach” guide in a minute.</div></div>
        <span className="hidden text-sm font-medium text-brand-600 sm:block">Open planner →</span>
      </Link>
    </div>
  )
}
