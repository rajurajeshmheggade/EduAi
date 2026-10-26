import { useEffect, useState } from 'react'
import {
  BarChart3, CalendarCheck, CalendarClock, CheckCircle2, ClipboardCheck, GraduationCap, PencilRuler, ScanText, School,
  Settings2, TriangleAlert, UserPlus, Users,
} from 'lucide-react'
import { Columns, Empty, Kpi, Panel, Ring } from '@/components/dashboard/Widgets'
import { BarList } from '@/components/evaluation/BarList'
import { Badge } from '@/components/ui/badge'
import { fmtPct } from '@/components/ui/stat'
import { adminService } from '@/services/adminService'
import { errorMessage } from '@/services/apiClient'
import { dashboardService, type AdminDash } from '@/services/dashboardService'
import { shortDate } from '@/lib/datetime'
import { num, type AdminOverview } from '@/types'

type Go = 'teachers' | 'classes' | 'timetable' | 'students' | 'attendance' | 'evaluation' | 'settings'

export function OverviewPanel({ org, onGo }: { org?: string | null; onGo: (tab: Go) => void }) {
  const [data, setData] = useState<AdminOverview | null>(null)
  const [dash, setDash] = useState<AdminDash | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    adminService.overview(org).then(setData).catch((e) => setError(errorMessage(e)))
    dashboardService.admin(org).then(setDash).catch((e) => setError(errorMessage(e)))
  }, [org])

  if (error) return <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>
  if (!data) return <div className="grid gap-4 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-32" />)}</div>
  const th = Number(data.organization.attendance_threshold ?? 75)
  const today = data.attendance_today.percentage
  const todo = [
    data.counts.teachers === 0 && { t: 'Add your teachers', go: 'teachers' as const },
    data.counts.classes === 0 && { t: 'Create classes and assign a class teacher', go: 'classes' as const },
    data.counts.classes_without_teacher > 0 && { t: `${data.counts.classes_without_teacher} class(es) without a class teacher`, go: 'classes' as const },
    data.counts.subjects_without_teacher > 0 && { t: `${data.counts.subjects_without_teacher} class subject(s) without a teacher`, go: 'classes' as const },
  ].filter(Boolean) as { t: string; go: Go }[]
  const a = dash?.assessments
  const quick: { go: Go; label: string; icon: typeof Users }[] = [
    { go: 'teachers', label: 'Add teacher', icon: UserPlus },
    { go: 'classes', label: 'Create class', icon: School },
    { go: 'timetable', label: 'Build timetable', icon: CalendarClock },
    { go: 'attendance', label: 'Attendance report', icon: CalendarCheck },
    { go: 'evaluation', label: 'Score register', icon: ScanText },
    { go: 'settings', label: 'Settings', icon: Settings2 },
  ]

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Institution totals">
        <button onClick={() => onGo('teachers')} className="cursor-pointer text-left"><Kpi icon={Users} label="Teachers" value={data.counts.teachers} tone="brand" /></button>
        <button onClick={() => onGo('students')} className="cursor-pointer text-left"><Kpi icon={GraduationCap} label="Students" value={data.counts.students} tone="aqua" /></button>
        <button onClick={() => onGo('classes')} className="cursor-pointer text-left"><Kpi icon={School} label="Classes" value={data.counts.classes} tone="neutral" hint={data.counts.classes_without_teacher ? `${data.counts.classes_without_teacher} without class teacher` : 'All have a class teacher'} /></button>
        <button onClick={() => onGo('attendance')} className="cursor-pointer text-left"><Kpi icon={CalendarCheck} label="Attendance today" value={fmtPct(today)} tone={today == null ? 'neutral' : today < th ? 'bad' : 'ok'} hint={`${data.attendance_today.total} marks recorded`} /></button>
      </section>

      <nav aria-label="Quick actions" className="flex flex-wrap gap-2">
        {quick.map(({ go, label, icon: Icon }) => (
          <button key={go} onClick={() => onGo(go)} className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-ink-900 px-3.5 py-2 text-sm font-medium text-ink-100 transition-all hover:-translate-y-px hover:border-brand-400 hover:text-brand-600">
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </nav>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Panel icon={BarChart3} title="Attendance trend · last 14 school days">
          {!dash ? <div className="skeleton h-44" /> : dash.attendance_trend.length === 0 ? <Empty icon={CalendarCheck}>No attendance has been marked yet.</Empty> : (
            <Columns caption="Institution attendance % per day (present + late)"
              data={dash.attendance_trend.map((t) => ({ key: t.date, label: shortDate(t.date), value: t.percentage, tooltip: `${t.marks} marks` }))} />
          )}
        </Panel>
        <Panel icon={CalendarCheck} title="This month">
          <div className="flex flex-wrap items-center gap-5">
            <Ring value={data.attendance_month.percentage} threshold={th} label="Attendance" />
            <div className="grid flex-1 grid-cols-2 gap-2 text-center text-xs">
              {(['present', 'absent', 'late', 'excused'] as const).map((k) => (
                <div key={k} className="rounded-lg bg-ink-800 py-2"><div className="font-semibold tabular-nums text-fg">{data.attendance_month[k]}</div><div className="capitalize text-ink-500">{k === 'excused' ? 'leave' : k}</div></div>
              ))}
            </div>
          </div>
          <p className="mt-3 text-xs text-ink-500">Defaulter threshold: {th}% (change in Settings).</p>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel icon={School} title="Class attendance this month">
          {!dash ? <div className="skeleton h-40" /> : dash.class_attendance.length === 0 ? <Empty icon={School}>No classes yet.</Empty> : (
            <BarList caption="Attendance % by class (present + late)" valueHeader="Attendance"
              data={dash.class_attendance.map((c) => ({
                key: c.class_code, label: c.class_name, value: c.percentage, display: fmtPct(c.percentage),
                flag: c.percentage != null && c.percentage < th ? `Below ${th}%` : undefined,
                tooltip: [`${c.total} marks`, `${c.absent} absent · ${c.late} late`],
              }))} />
          )}
        </Panel>

        <Panel icon={PencilRuler} title="Assessments">
          {!a ? <div className="skeleton h-40" /> : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                {[{ l: 'Online tests', v: a.online_tests, i: PencilRuler }, { l: 'Assignments', v: a.assignments, i: ClipboardCheck }, { l: 'AI-evaluated exams', v: a.offline_exams, i: ScanText }].map(({ l, v, i: Icon }) => (
                  <div key={l} className="rounded-xl border border-line p-3"><Icon className="mx-auto h-5 w-5 text-brand-600" /><div className="mt-1 font-display text-xl font-bold tabular-nums text-fg">{v}</div><div className="text-xs text-ink-500">{l}</div></div>
                ))}
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <dt className="text-ink-300">Open right now</dt><dd className="text-right font-medium tabular-nums text-fg">{a.open_now}</dd>
                <dt className="text-ink-300">Scripts evaluated</dt><dd className="text-right font-medium tabular-nums text-fg">{a.evaluated}</dd>
                <dt className="text-ink-300">Teacher-reviewed</dt><dd className="text-right font-medium tabular-nums text-fg">{a.teacher_reviewed}</dd>
                <dt className="text-ink-300">Average score</dt><dd className="text-right font-medium tabular-nums text-fg">{a.average_percentage == null ? '—' : `${num(a.average_percentage)}%`}</dd>
              </dl>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel icon={TriangleAlert} title="Setup checklist">
          {todo.length === 0 ? <Empty icon={CheckCircle2}>All set — every class has a class teacher and every subject a teacher.</Empty> : (
            <ul className="space-y-2">
              {todo.map((x) => (
                <li key={x.t}><button onClick={() => onGo(x.go)} className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-left text-sm text-warn hover:bg-warn/15"><TriangleAlert className="h-4 w-4 shrink-0" /> {x.t}</button></li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel icon={UserPlus} title="Recently added">
          {!dash ? <div className="skeleton h-32" /> : dash.recent_members.length === 0 ? <Empty icon={Users}>No teachers or students yet.</Empty> : (
            <ul className="divide-y divide-line">
              {dash.recent_members.map((m, i) => (
                <li key={`${m.full_name}-${i}`} className="flex items-center gap-3 py-2">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-500/10 text-xs font-semibold text-brand-600">{m.full_name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-fg">{m.full_name}</div><div className="text-xs text-ink-500">{shortDate(m.created_at)}</div></div>
                  <Badge tone={m.user_role === 'teacher' ? 'brand' : 'neutral'}>{m.user_role === 'teacher' ? 'Teacher' : `Student${m.class_code ? ` · ${m.class_code}` : ''}`}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}
