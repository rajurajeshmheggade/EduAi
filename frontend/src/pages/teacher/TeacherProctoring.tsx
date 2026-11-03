import { useCallback, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Camera, ChevronRight, Radio, ShieldAlert, ShieldCheck, TriangleAlert, Users } from 'lucide-react'
import { ProctoringSettingsPanel } from '@/components/admin/ProctoringSettingsPanel'
import { LiveBadge } from '@/components/proctoring/teacher/LiveBadge'
import { ModuleBadge, SeverityBadge } from '@/components/proctoring/teacher/badges'
import { classLabel, examLink, SIGNALS_NOT_PROOF, timeAgo } from '@/components/proctoring/teacher/format'
import { useProctorLive } from '@/components/proctoring/teacher/useProctorLive'
import { Card } from '@/components/ui/card'
import { ErrorState, SkeletonPage } from '@/components/ui/loading'
import { useAsync } from '@/lib/useAsync'
import { cn } from '@/lib/utils'
import { type ExamSummary, proctoringService } from '@/services/proctoringService'

/**
 * Teacher -> Proctoring: every ongoing exam the teacher is assigned to (online tests and virtual labs that are open,
 * AI Classroom sessions their students started), with live totals. Updates arrive over the live stream.
 */
export default function TeacherProctoring() {
  const exams = useAsync((signal) => proctoringService.exams(signal), [])
  const { retry } = exams
  const debounce = useRef<number | undefined>(undefined)
  const refresh = useCallback(() => {
    window.clearTimeout(debounce.current)
    debounce.current = window.setTimeout(retry, 800)
  }, [retry])
  useEffect(() => () => window.clearTimeout(debounce.current), [])
  const live = useProctorLive({}, refresh, retry)

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-8">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm text-ink-300"><ShieldCheck className="h-4 w-4" /> Assessments</p>
          <h1 className="mt-1 font-display text-3xl font-bold text-fg">Live proctoring</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-300">Ongoing online tests, virtual labs and AI Classroom sessions of your classes. Detection runs on each
            student’s device; only flags reach you — no video, photos or audio.</p>
        </div>
        <LiveBadge state={live} />
      </header>
      <p className="rounded-xl border border-line bg-ink-900 px-4 py-3 text-sm text-ink-300">{SIGNALS_NOT_PROOF}</p>

      {exams.error && !exams.data ? <ErrorState title="Could not load your exams" message={exams.error} onRetry={retry} />
        : !exams.data ? <SkeletonPage variant="cards" />
          : exams.data.exams.length === 0 ? (
            <Card className="p-8 text-center">
              <Radio className="mx-auto mb-3 h-8 w-8 text-ink-500" />
              <h2 className="font-display text-lg font-semibold text-fg">No exams running right now</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-ink-300">Your assigned online tests and virtual labs appear here while they are open. AI Classroom sessions appear when a
                student of your class starts one. You are notified when a student starts and for serious alerts.</p>
            </Card>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">{exams.data.exams.map((e) => <ExamCard key={`${e.module}:${e.ref_id}`} e={e} />)}</ul>
          )}

      <details className="group rounded-2xl border border-line bg-ink-900 p-4">
        <summary className="cursor-pointer font-display text-base font-semibold text-fg">Thresholds used for your school</summary>
        <div className="mt-4"><ProctoringSettingsPanel org={null} /></div>
      </details>
    </div>
  )
}

function ExamCard({ e }: { e: ExamSummary }) {
  const c = e.counts
  return (
    <li>
      <Link to={examLink(e.module, e.ref_id)} className="block h-full">
        <Card className="h-full space-y-3 p-5 transition-colors hover:border-brand-400/50">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5"><ModuleBadge module={e.module} />{e.subject_name && <span className="text-xs text-ink-500">{e.subject_name}</span>}</div>
              <h2 className="mt-1 truncate font-display text-lg font-semibold text-fg">{e.title}</h2>
              <p className="text-xs text-ink-500">{classLabel(e.class_name, e.section)}{e.due_at ? ` · due ${new Date(e.due_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</p>
            </div>
            <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-ink-500" />
          </div>
          <dl className="grid grid-cols-4 gap-2 text-center">
            <Mini label="Writing" value={c.writing} tone="text-brand-600" />
            <Mini label="Yet to start" value={c.yet_to_start} />
            <Mini label="Submitted" value={c.submitted} tone="text-ok" />
            <Mini label="Enrolled" value={c.enrolled} />
          </dl>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <Chip on={c.with_active_alerts > 0} icon={ShieldAlert} label={`${c.with_active_alerts} with active alerts`} />
            <Chip on={c.camera_issues > 0} icon={Camera} label={`${c.camera_issues} camera issues`} />
            <Chip on={c.suspicious > 0} icon={TriangleAlert} label={`${c.suspicious} suspicious-activity signals`} />
            {c.interrupted > 0 && <Chip on icon={Users} label={`${c.interrupted} interrupted`} />}
          </div>
          {e.latest_alert && (
            <p className="flex items-center gap-2 truncate text-xs text-ink-300">
              <SeverityBadge severity={e.latest_alert.severity} /><span className="truncate">{e.latest_alert.student_name}: {e.latest_alert.label}</span>
              <span className="ml-auto shrink-0 text-ink-500">{timeAgo(e.latest_alert.server_ts)}</span>
            </p>
          )}
        </Card>
      </Link>
    </li>
  )
}

function Mini({ label, value, tone = 'text-fg' }: { label: string; value: number; tone?: string }) {
  return <div className="rounded-lg bg-ink-800 px-1 py-2"><dd className={cn('font-display text-xl font-bold tabular-nums', tone)}>{value}</dd><dt className="text-[11px] text-ink-500">{label}</dt></div>
}

function Chip({ on, icon: Icon, label }: { on: boolean; icon: typeof Camera; label: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5', on ? 'bg-warn/10 text-warn' : 'bg-ink-800 text-ink-500')}><Icon className="h-3.5 w-3.5" aria-hidden />{label}</span>
}
