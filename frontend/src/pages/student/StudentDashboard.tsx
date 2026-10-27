import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight, Award, BarChart3, CalendarCheck, CalendarClock, CheckCircle2, ClipboardCheck, ClipboardList, Hourglass,
  Library, MessageSquareText, PencilRuler, Sparkles, Trophy,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { BarList } from '@/components/evaluation/BarList'
import { Empty, HeroBanner, Kpi, Panel, Ring } from '@/components/dashboard/Widgets'
import { TodayList } from '@/components/timetable/WeeklyGrid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { errorMessage } from '@/services/apiClient'
import { dashboardService, type StudentDash } from '@/services/dashboardService'
import { greeting, longDate, shortDate, shortDateTime } from '@/lib/datetime'
import { num } from '@/types'

const TYPE_LABEL = { ONLINE_TEST: 'Online test', ASSIGNMENT: 'Assignment', OFFLINE_EXAM: 'Exam' } as const

/** Student home: attendance gauge, deadlines, today's classes, homework, recent results and subject shortcuts. */
export default function StudentDashboard() {
  const { user, setSubject } = useAuth()
  const nav = useNavigate()
  const [d, setD] = useState<StudentDash | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hello] = useState(() => greeting())

  useEffect(() => { dashboardService.student().then(setD).catch((e) => setError(errorMessage(e))) }, [])
  if (!user) return null
  const first = user.full_name.split(' ')[0]
  const k = d?.kpis
  const low = k?.attendance_month != null && d != null && k.attendance_month < d.threshold

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <HeroBanner
        eyebrow={`${longDate(d?.today)} · ${user.class_code ?? ''}`}
        title={<>{hello}, {first}</>}
        subtitle={k ? <>{k.to_do ? <><b>{k.to_do}</b> test{k.to_do === 1 ? '' : 's'} / assignment{k.to_do === 1 ? '' : 's'} waiting</> : 'No tests waiting'}{k.homework_pending ? <> · <b>{k.homework_pending}</b> homework pending</> : ''}. Keep it up!</> : 'Loading your day…'}
        actions={[
          { to: '/student/tests', label: 'My tests', icon: PencilRuler, primary: true },
          { to: '/student/assignments', label: 'Assignments', icon: ClipboardCheck },
          { to: '/student/homework', label: 'Homework', icon: ClipboardList },
          { to: '/student/library', label: 'My Library', icon: Library },
          { to: '/student/classroom', label: 'Ask the AI tutor', icon: MessageSquareText },
        ]}
        aside={d && (
          <div className="flex items-center gap-4 rounded-2xl bg-white/95 p-4 text-left shadow-lg">
            <Ring value={k?.attendance_month ?? null} threshold={d.threshold} label="This month" size={96} />
            <div className="text-sm">
              <div className="font-semibold text-fg">Attendance</div>
              <div className="text-xs text-ink-500">Minimum {d.threshold}%</div>
              <div className={low ? 'mt-1 text-xs font-medium text-bad' : 'mt-1 text-xs font-medium text-ok'}>{k?.attendance_month == null ? 'No periods yet' : low ? 'Below minimum' : 'On track'}</div>
            </div>
          </div>
        )}
      />

      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      <section aria-label="Overview" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {!k ? Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton h-32" />) : <>
          <Kpi icon={CalendarCheck} label="Overall attendance" value={k.attendance_overall == null ? '—' : `${k.attendance_overall}%`} tone={k.attendance_overall != null && d && k.attendance_overall < d.threshold ? 'bad' : 'ok'} to="/student/attendance" hint={`This month ${k.attendance_month == null ? '—' : `${k.attendance_month}%`}`} />
          <Kpi icon={Hourglass} label="Tests & assignments to do" value={k.to_do} tone={k.to_do ? 'warn' : 'ok'} to="/student/tests" />
          <Kpi icon={ClipboardList} label="Homework pending" value={k.homework_pending} tone={k.homework_pending ? 'warn' : 'ok'} to="/student/homework" />
          <Kpi icon={Trophy} label="Average score" value={k.average_score == null ? '—' : `${k.average_score}%`} tone="brand" to="/student/evaluations" hint={`${k.results} result(s) published`} />
        </>}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <Panel icon={Hourglass} title="Upcoming deadlines" action={{ to: '/student/tests', label: 'All tests' }}>
          {!d ? <div className="skeleton h-40" /> : d.upcoming.length === 0 ? <Empty icon={CheckCircle2}>Nothing due — you’re all caught up.</Empty> : (
            <ul className="space-y-2.5">
              {d.upcoming.map((u) => {
                const test = u.assessment_type === 'ONLINE_TEST'
                const to = test ? `/student/tests/${u.eval_test_id}` : `/student/assignments/${u.eval_test_id}`
                return (
                  <li key={u.eval_test_id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3">
                    <span className={test ? 'grid h-10 w-10 place-items-center rounded-xl bg-brand-500/10 text-brand-600' : 'grid h-10 w-10 place-items-center rounded-xl bg-aqua-500/12 text-aqua-400'}>
                      {test ? <PencilRuler className="h-5 w-5" /> : <ClipboardCheck className="h-5 w-5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 truncate font-medium text-fg">{u.title}{u.in_progress && <Badge tone="brand">In progress</Badge>}</div>
                      <div className="text-xs text-ink-500">{TYPE_LABEL[u.assessment_type]} · {u.subject_name}{u.duration_minutes ? ` · ${u.duration_minutes} min` : ''}</div>
                    </div>
                    <Badge tone="warn">Due {shortDateTime(u.due_at)}</Badge>
                    <Link to={to}><Button size="sm">{test ? (u.in_progress ? 'Resume' : 'Start') : 'Submit'} <ArrowRight className="h-3.5 w-3.5" /></Button></Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>

        <Panel icon={CalendarClock} title="Today’s classes" action={{ to: '/student/timetable', label: 'Full week' }}>
          {!d ? <div className="skeleton h-40" /> : <TodayList slots={d.today_slots} today={d.weekday} secondary="teacher" />}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel icon={Award} title="Recent results" action={{ to: '/student/evaluations', label: 'All results' }}>
          {!d ? <div className="skeleton h-40" /> : d.results.length === 0 ? <Empty icon={Award}>Your marks appear here once your teacher publishes them.</Empty> : (
            <ul className="divide-y divide-line">
              {d.results.map((r) => (
                <li key={r.eval_test_id} className="flex items-center gap-3 py-2.5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink-800 font-display text-sm font-bold text-fg">{r.grade || '—'}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-fg">{r.title}</div>
                    <div className="text-xs text-ink-500">{TYPE_LABEL[r.assessment_type]} · {r.subject_name}{r.date ? ` · ${shortDate(r.date)}` : ''}</div>
                  </div>
                  <div className="hidden w-24 sm:block"><Progress value={r.percentage} tone={r.percentage < 40 ? 'bad' : 'ok'} /></div>
                  <span className="w-20 text-right text-sm tabular-nums text-fg"><b>{num(r.obtained)}</b>/{num(r.max)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel icon={BarChart3} title="Attendance by subject" action={{ to: '/student/attendance', label: 'Details' }}>
          {!d ? <div className="skeleton h-40" /> : d.attendance_by_subject.length === 0 ? <Empty icon={CalendarCheck}>No attendance marked this month yet.</Empty> : (
            <BarList caption={`This month · present + late · minimum ${d.threshold}%`} valueHeader="Attendance"
              data={d.attendance_by_subject.map((s) => ({
                key: s.subject_code, label: s.subject_name, value: s.percentage,
                display: s.percentage == null ? '—' : `${s.percentage}%`,
                flag: s.percentage != null && s.percentage < d.threshold ? `Below ${d.threshold}%` : undefined,
                tooltip: [`${s.present + s.late} of ${s.total - s.excused} periods attended`, `${s.absent} absent · ${s.late} late`],
              }))} />
          )}
        </Panel>
      </div>

      <Panel icon={ClipboardList} title="Homework" action={{ to: '/student/homework', label: 'Open homework' }}>
        {!d ? <div className="skeleton h-24" /> : d.homework.length === 0 ? <Empty icon={CheckCircle2}>No pending homework.</Empty> : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {d.homework.map((h) => {
              const overdue = h.due_date < (d.today ?? '')
              return (
                <li key={h.homework_id}>
                  <Link to="/student/homework" className="flex h-full items-center gap-3 rounded-xl border border-line p-3 transition-colors hover:border-line-strong">
                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-fg">{h.title}</div><div className="text-xs text-ink-500">{h.subject_name}</div></div>
                    <Badge tone={overdue ? 'bad' : 'neutral'}>{overdue ? 'Overdue' : `Due ${shortDate(h.due_date)}`}</Badge>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      <section aria-labelledby="subjects-h" className="space-y-3">
        <h2 id="subjects-h" className="flex items-center gap-2 font-display text-lg font-semibold text-fg"><Sparkles className="h-5 w-5 text-brand-600" /> Learn with AI</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(d?.subjects ?? user.allowed_subjects.map((s) => ({ subject_code: s, subject_name: s }))).map((s) => (
            <button key={s.subject_code} id={`open-${s.subject_code}`} onClick={() => { setSubject(s.subject_code); nav('/student/classroom') }}
              className="group flex cursor-pointer items-center gap-3 rounded-2xl border border-line bg-ink-900 p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-glow">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-aqua-500 font-display text-sm font-bold text-white">{s.subject_name.slice(0, 2).toUpperCase()}</span>
              <div className="min-w-0 flex-1"><div className="truncate font-medium text-fg">{s.subject_name}</div><div className="text-xs text-ink-500">Open AI classroom</div></div>
              <ArrowRight className="h-4 w-4 text-ink-500 transition-transform group-hover:translate-x-1" />
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
