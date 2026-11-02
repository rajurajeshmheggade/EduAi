import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Camera, CameraOff, CheckCircle2, Clock, Maximize, Mic, MicOff, PencilLine, Search, ShieldAlert, TriangleAlert, Users, Wifi, WifiOff,
} from 'lucide-react'
import { LiveBadge } from '@/components/proctoring/teacher/LiveBadge'
import { SessionDrawer } from '@/components/proctoring/teacher/SessionDrawer'
import { ModuleBadge, SeverityBadge, StateBadge } from '@/components/proctoring/teacher/badges'
import { classLabel, clockTime, SIGNALS_NOT_PROOF, timeAgo } from '@/components/proctoring/teacher/format'
import { useProctorLive } from '@/components/proctoring/teacher/useProctorLive'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/field'
import { ErrorState, SkeletonPage } from '@/components/ui/loading'
import { StatCard } from '@/components/ui/stat'
import { Tabs } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toast'
import { useAsync } from '@/lib/useAsync'
import { cn } from '@/lib/utils'
import { type ExamStudent, type LiveMessage, type ProctorModule, proctoringService } from '@/services/proctoringService'

type Filter = 'all' | 'writing' | 'alerts' | 'camera' | 'waiting' | 'done'
const FILTERS: Record<Filter, (s: ExamStudent) => boolean> = {
  all: () => true,
  writing: (s) => s.state === 'ACTIVE' || s.state === 'INTERRUPTED',
  alerts: (s) => s.alerts.open > 0 || s.suspicious,
  camera: (s) => s.camera_issue,
  waiting: (s) => s.state === 'NOT_STARTED' || s.state === 'PRECHECK',
  done: (s) => s.state === 'SUBMITTED' || s.state === 'ENDED_BY_TEACHER' || s.state === 'CLOSED',
}
const MODULES: ProctorModule[] = ['ONLINE_TEST', 'VIRTUAL_LAB', 'AI_CLASSROOM']

/** Teacher monitor for one ongoing exam: live totals, a student-wise grid, the alert feed and each student's record. */
export default function ProctoringExam() {
  const [params, setParams] = useSearchParams()
  const module = (MODULES.includes(params.get('module') as ProctorModule) ? params.get('module') : 'ONLINE_TEST') as ProctorModule
  const refId = params.get('ref') ?? ''
  const openSession = params.get('session')
  const view = useAsync((signal) => proctoringService.exam(module, refId, signal), [module, refId])
  const { retry } = view
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [detailNonce, setDetailNonce] = useState(0)
  const debounce = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(debounce.current), [])

  const onMessage = useCallback((m: LiveMessage) => {
    if (m.type === 'event' && m.event && (m.event.severity === 'High' || m.event.severity === 'Critical')) {
      toast(`${m.event.severity} alert — ${m.student_name ?? m.student_code}: ${m.event.label}`, 'error')
    }
    if (openSession && m.session_id === openSession) setDetailNonce((n) => n + 1)
    window.clearTimeout(debounce.current)
    debounce.current = window.setTimeout(retry, 700)
  }, [retry, openSession])
  const live = useProctorLive({ module, refId }, onMessage, retry)

  const setSession = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('session', id); else next.delete('session')
    setParams(next, { replace: true })
  }

  const data = view.data
  const students = useMemo(() => {
    if (!data) return []
    const term = q.trim().toLowerCase()
    return data.students.filter(FILTERS[filter]).filter((s) => !term || s.full_name.toLowerCase().includes(term) || s.student_code.toLowerCase().includes(term)
      || (s.roll_number ?? '').toLowerCase() === term)
  }, [data, filter, q])

  if (!refId) return <div className="mx-auto max-w-3xl p-4 md:p-8"><ErrorState title="No exam selected" message="Open an exam from the proctoring page." /></div>
  if (view.error && !data) return <div className="mx-auto max-w-3xl p-4 md:p-8"><ErrorState title="Could not open this exam" message={view.error} onRetry={retry} /></div>
  if (!data) return <div className="mx-auto max-w-7xl p-4 md:p-8"><SkeletonPage variant="dashboard" /></div>
  const { exam, counts: c } = data

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-8">
      <header className="flex flex-wrap items-start gap-3">
        <Link to="/teacher/proctoring" className="mt-1 rounded-lg p-1.5 text-ink-300 hover:bg-ink-800 hover:text-fg" aria-label="Back to live proctoring"><ArrowLeft className="h-5 w-5" /></Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><ModuleBadge module={exam.module} />{exam.subject_name && <span className="text-xs text-ink-500">{exam.subject_name}</span>}</div>
          <h1 className="mt-1 truncate font-display text-2xl font-bold text-fg">{exam.title}</h1>
          <p className="text-sm text-ink-500">{classLabel(exam.class_name, exam.section)}{exam.duration_minutes ? ` · ${exam.duration_minutes} min` : ''}</p>
        </div>
        <LiveBadge state={live} />
      </header>

      <section aria-label="Totals" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Enrolled" value={c.enrolled} icon={Users} />
        <StatCard label="Writing now" value={c.writing} icon={PencilLine} tone="text-brand-600" />
        <StatCard label="Yet to start" value={c.yet_to_start} hint={c.prechecking ? `${c.prechecking} in pre-check` : undefined} icon={Clock} />
        <StatCard label="Submitted" value={c.submitted} icon={CheckCircle2} tone="text-ok" />
        <StatCard label="Interrupted" value={c.interrupted} icon={WifiOff} tone={c.interrupted ? 'text-warn' : 'text-fg'} />
        <StatCard label="Active alerts" value={c.with_active_alerts} hint="students" icon={ShieldAlert} tone={c.with_active_alerts ? 'text-bad' : 'text-fg'} />
        <StatCard label="Camera issues" value={c.camera_issues} hint="students" icon={CameraOff} tone={c.camera_issues ? 'text-warn' : 'text-fg'} />
        <StatCard label="Suspicious signals" value={c.suspicious} hint="students" icon={TriangleAlert} tone={c.suspicious ? 'text-warn' : 'text-fg'} />
      </section>
      <p className="rounded-xl border border-line bg-ink-900 px-4 py-3 text-sm text-ink-300">{SIGNALS_NOT_PROOF}</p>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-label="Students" className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={filter} onChange={setFilter} className="max-w-full" items={[
              { id: 'all', label: 'All', count: data.students.length },
              { id: 'writing', label: 'Writing', count: data.students.filter(FILTERS.writing).length },
              { id: 'alerts', label: 'Alerts', count: data.students.filter(FILTERS.alerts).length },
              { id: 'camera', label: 'Camera issues', count: c.camera_issues },
              { id: 'waiting', label: 'Yet to start', count: c.yet_to_start },
              { id: 'done', label: 'Submitted', count: c.submitted },
            ]} />
            <div className="relative ml-auto w-full sm:w-56">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
              <Input aria-label="Find a student" placeholder="Name, ID or roll no." className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          {students.length === 0 ? <Card className="p-8 text-center text-sm text-ink-500">No students match.</Card> : (
            <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {students.map((s) => <StudentCard key={s.student_code} s={s} onOpen={() => s.session_id && setSession(s.session_id)} />)}
            </ul>
          )}
        </section>

        <aside aria-label="Alert feed" className="space-y-2">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-fg"><ShieldAlert className="h-5 w-5 text-bad" /> Alerts</h2>
          {data.alerts.length === 0 ? <Card className="p-6 text-center text-sm text-ink-500">No alerts yet.</Card> : (
            <ol className="max-h-[70vh] space-y-2 overflow-y-auto pr-1" aria-live="polite">
              {data.alerts.map((a) => (
                <li key={a.event_id}>
                  <button onClick={() => setSession(a.session_id)} className={cn('w-full cursor-pointer rounded-xl border bg-ink-900 p-3 text-left transition-colors hover:border-brand-400/50',
                    a.review ? 'border-line opacity-70' : 'border-line')}>
                    <div className="flex items-center gap-2"><SeverityBadge severity={a.severity} /><span className="truncate text-sm font-medium text-fg">{a.student_name ?? a.student_code}</span>
                      <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-ink-500">{clockTime(a.client_ts ?? a.server_ts)}</span></div>
                    <p className="mt-1 text-sm text-ink-300">{a.label}</p>
                    <p className="text-xs text-ink-500">{a.review ? `Reviewed: ${a.review.outcome.toLowerCase()}` : 'Not reviewed'} · {timeAgo(a.server_ts)}</p>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>

      {openSession && <SessionDrawer sessionId={openSession} refresh={detailNonce} onClose={() => setSession(null)} onChanged={retry} />}
    </div>
  )
}

function StudentCard({ s, onOpen }: { s: ExamStudent; onOpen: () => void }) {
  const live = s.state === 'ACTIVE' || s.state === 'INTERRUPTED'
  return (
    <li>
      <button onClick={onOpen} disabled={!s.session_id} aria-label={`${s.full_name}, ${s.state.toLowerCase().replace(/_/g, ' ')}${s.alerts.open ? `, ${s.alerts.open} open alerts` : ''}`}
        className={cn('h-full w-full rounded-2xl border bg-ink-900 p-4 text-left transition-colors', s.session_id ? 'cursor-pointer hover:border-brand-400/50' : 'cursor-default',
          s.alerts.open > 0 ? 'border-bad/30' : s.camera_issue ? 'border-warn/40' : 'border-line')}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-fg">{s.full_name}</div>
            <div className="text-xs text-ink-500">{s.student_code}{s.roll_number ? ` · Roll ${s.roll_number}` : ''}</div>
          </div>
          <StateBadge state={s.state} />
        </div>
        {live && (
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs" aria-hidden>
            <Icon ok={s.camera.live !== false} on={Camera} off={CameraOff} label="Camera" />
            {s.mic.live !== null && <Icon ok={s.mic.live !== false && s.mic.permission !== 'denied'} on={Mic} off={MicOff} label="Mic" />}
            {s.fullscreen !== null && <Icon ok={!!s.fullscreen} on={Maximize} off={Maximize} label="Full screen" />}
            <Icon ok={s.online !== false} on={Wifi} off={WifiOff} label="Online" />
            {s.faces !== null && <span className={cn('rounded-full px-1.5', s.faces === 1 ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn')}>{s.faces} face{s.faces === 1 ? '' : 's'}</span>}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
          {s.started_at && <span>Started {clockTime(s.started_at)}</span>}
          {live && <span>Last report {timeAgo(s.last_heartbeat_at)}</span>}
          {s.alerts.open > 0 && <span className="font-medium text-bad">{s.alerts.open} open alert{s.alerts.open === 1 ? '' : 's'}</span>}
          {s.warnings > 0 && <span>{s.warnings} warning{s.warnings === 1 ? '' : 's'} sent</span>}
        </div>
        {s.latest_alert && (
          <p className="mt-2 flex items-center gap-2 truncate text-xs text-ink-300"><SeverityBadge severity={s.latest_alert.severity} /><span className="truncate">{s.latest_alert.label}</span>
            <span className="ml-auto shrink-0 text-ink-500">{timeAgo(s.latest_alert.at)}</span></p>
        )}
      </button>
    </li>
  )
}

function Icon({ ok, on: On, off: Off, label }: { ok: boolean; on: typeof Camera; off: typeof Camera; label: string }) {
  const I = ok ? On : Off
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5', ok ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad')}><I className="h-3 w-3" />{label}</span>
}
