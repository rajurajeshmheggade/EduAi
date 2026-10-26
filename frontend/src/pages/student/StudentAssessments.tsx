import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlarmClock, ArrowLeft, CheckCircle2, ClipboardList, Download, FileText, Hourglass, Loader2, Lock, MonitorCheck, Play, Upload } from 'lucide-react'
import { ReportSkeleton, ReportView } from '@/components/evaluation/ReportView'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Tabs } from '@/components/ui/tabs'
import { errorMessage } from '@/services/apiClient'
import { assessmentService, fmtDateTime, relTime } from '@/services/assessmentService'
import { cn } from '@/lib/utils'
import { num, type EvalReport, type MyAssessmentStatus, type StudentAssessment } from '@/types'

type Kind = 'ONLINE_TEST' | 'ASSIGNMENT'
const BASE: Record<Kind, string> = { ONLINE_TEST: '/student/tests', ASSIGNMENT: '/student/assignments' }
const STATUS: Record<MyAssessmentStatus, { label: string; tone: 'neutral' | 'warn' | 'ok' | 'bad' | 'brand' }> = {
  NOT_STARTED: { label: 'To do', tone: 'warn' }, IN_PROGRESS: { label: 'In progress', tone: 'brand' },
  EVALUATING: { label: 'AI evaluating…', tone: 'neutral' }, EVALUATED: { label: 'Evaluated', tone: 'ok' }, FAILED: { label: 'Needs teacher', tone: 'bad' },
}

/** FR-TST-03 / FR-ASG-02 / FR-DSP-01: the student's assigned online tests or assignments. */
export default function StudentAssessments({ kind }: { kind: Kind }) {
  const { id } = useParams()
  return id ? <AssessmentDetail key={id} id={id} kind={kind} /> : <AssessmentList kind={kind} />
}

function AssessmentList({ kind }: { kind: Kind }) {
  const [items, setItems] = useState<StudentAssessment[] | null>(null)
  const [tab, setTab] = useState<'todo' | 'done'>('todo')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { assessmentService.list(kind).then((r) => setItems(r.assessments)).catch((e) => setError(errorMessage(e))) }, [kind])

  const isDone = (a: StudentAssessment) => ['EVALUATING', 'EVALUATED', 'FAILED'].includes(a.my.status) || (!a.window.open && a.my.status === 'NOT_STARTED' && !a.window.opens_at)
  const shown = items?.filter((a) => (tab === 'done' ? isDone(a) : !isDone(a)))
  const Icon = kind === 'ONLINE_TEST' ? MonitorCheck : ClipboardList

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <header className="animate-fade-up">
        <h1 className="font-display text-3xl font-bold">My <span className="text-gradient">{kind === 'ONLINE_TEST' ? 'tests' : 'assignments'}</span></h1>
        <p className="mt-1 text-sm text-ink-300">{kind === 'ONLINE_TEST' ? 'Timed online tests from your teachers — answered here, marked by AI with feedback for every question.' : 'Write your answers on paper, upload one PDF, and get AI marks with feedback for every question.'}</p>
      </header>
      <Tabs items={[{ id: 'todo', label: 'To do', count: items?.filter((a) => !isDone(a)).length }, { id: 'done', label: 'Submitted & closed', count: items?.filter(isDone).length }]} value={tab} onChange={setTab} />
      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      {!shown ? !error && <div className="skeleton h-48" /> : shown.length === 0 ? (
        <Card className="p-10 text-center text-sm text-ink-300"><Icon className="mx-auto mb-2 h-8 w-8 text-ink-500" />{tab === 'todo' ? 'Nothing to do right now.' : 'Nothing here yet.'}</Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {shown.map((a) => {
            const st = STATUS[a.my.status]
            return (
              <Link key={a.eval_test_id} to={`${BASE[kind]}/${a.eval_test_id}`} id={`assessment-${a.eval_test_id}`}>
                <Card className="h-full p-5 transition-all hover:-translate-y-0.5 hover:shadow-glow">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs font-medium uppercase tracking-wide text-brand-600">{a.subject_name}</div>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                  <div className="mt-0.5 font-display text-lg font-semibold text-fg">{a.test_title}</div>
                  <div className="text-xs text-ink-500">{a.evaluation_scope === 'CHAPTER_LEVEL' ? a.chapter_title : 'Whole subject'} · {a.total_questions} questions · {num(a.total_max_marks)} marks{a.duration_minutes ? ` · ${a.duration_minutes} min` : ''}</div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    {a.window.opens_at ? <Badge><Lock className="h-3 w-3" /> Opens {fmtDateTime(a.window.opens_at)}</Badge>
                      : a.due_at && <Badge tone={a.my.status === 'NOT_STARTED' && a.window.late ? 'bad' : 'neutral'}><AlarmClock className="h-3 w-3" /> Due {fmtDateTime(a.due_at)} ({relTime(a.due_at)})</Badge>}
                    {a.my.is_late && <Badge tone="warn">Late</Badge>}
                  </div>
                  {a.score && (
                    <div className="mt-3">
                      <div className="flex items-end justify-between"><span className="font-display text-2xl font-bold tabular-nums text-fg">{num(a.score.obtained)}<span className="text-sm text-ink-500">/{num(a.score.max)}</span></span>
                        <Badge tone="ok">{num(a.score.percentage)}% · {a.score.grade}</Badge></div>
                      <Progress value={num(a.score.percentage)} tone="ok" className="mt-2" />
                    </div>
                  )}
                  {a.result_pending_publish && <p className="mt-3 text-xs text-ink-500">Evaluated — your teacher will release the results.</p>}
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

function AssessmentDetail({ id, kind }: { id: string; kind: Kind }) {
  const nav = useNavigate()
  const [a, setA] = useState<StudentAssessment | null>(null)
  const [report, setReport] = useState<EvalReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pct, setPct] = useState<number | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const load = useCallback(async () => {
    try {
      const d = await assessmentService.get(id)
      setA(d)
      if (d.result_available) setReport(await assessmentService.report(id))
      return d
    } catch (e) { setError(errorMessage(e)); return null }
  }, [id])

  useEffect(() => {
    void load()
    return () => window.clearInterval(timer.current)
  }, [load])
  // Poll while the AI is evaluating.
  useEffect(() => {
    window.clearInterval(timer.current)
    if (a?.my.status === 'EVALUATING') timer.current = window.setInterval(() => { void load() }, 2500)
    return () => window.clearInterval(timer.current)
  }, [a?.my.status, load])

  async function start() {
    if (!a) return
    if (a.my.status === 'NOT_STARTED' && !confirm(`Start "${a.test_title}" now? The ${a.duration_minutes}-minute timer starts immediately and you get one attempt.`)) return
    setBusy(true); setError(null)
    try { await assessmentService.start(id); nav(`${BASE.ONLINE_TEST}/${id}/take`) } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  async function upload(file: File | undefined) {
    if (!file) return
    setError(null); setPct(0)
    try { setA(await assessmentService.upload(id, file, setPct)) } catch (e) { setError(errorMessage(e)) } finally { setPct(null) }
  }

  if (!a) return <div className="mx-auto max-w-4xl p-4 md:p-8">{error ? <p className="text-sm text-bad">{error}</p> : <ReportSkeleton />}</div>
  const st = STATUS[a.my.status]
  const canUpload = kind === 'ASSIGNMENT' && a.window.open && a.my.status !== 'EVALUATING'

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-8">
      <Link to={BASE[kind]} className="inline-flex items-center gap-1 text-sm text-ink-300 hover:text-fg"><ArrowLeft className="h-4 w-4" /> All {kind === 'ONLINE_TEST' ? 'tests' : 'assignments'}</Link>
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-brand-600">{a.subject_name} · {a.evaluation_scope === 'CHAPTER_LEVEL' ? a.chapter_title : 'Whole subject'}</div>
            <h1 className="mt-0.5 font-display text-2xl font-bold">{a.test_title}</h1>
            <div className="mt-1 text-sm text-ink-300">{a.total_questions} questions · {num(a.total_max_marks)} marks{a.duration_minutes ? ` · ${a.duration_minutes} minutes` : ''}</div>
          </div>
          <Badge tone={st.tone}>{st.label}</Badge>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-300">
          {a.available_from && <span>Opens <b className="text-ink-100">{fmtDateTime(a.available_from)}</b></span>}
          <span>Due <b className="text-ink-100">{fmtDateTime(a.due_at)}</b> ({relTime(a.due_at)}){a.allow_late ? ' · late work accepted' : ''}</span>
          {a.my.submitted_at && <span>Submitted <b className="text-ink-100">{fmtDateTime(a.my.submitted_at)}</b>{a.my.is_late && <span className="ml-1 font-semibold text-warn">LATE</span>}</span>}
        </div>
        {a.instructions && <p className="mt-3 whitespace-pre-line rounded-lg bg-ink-800 p-3 text-sm text-ink-100">{a.instructions}</p>}

        {error && <p role="alert" className="mt-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

        {kind === 'ONLINE_TEST' && (a.my.status === 'NOT_STARTED' || a.my.status === 'IN_PROGRESS') && (
          <div className="mt-4">
            {a.window.open || a.my.status === 'IN_PROGRESS' ? (
              <Button size="lg" onClick={start} disabled={busy} id="start-test">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{a.my.status === 'IN_PROGRESS' ? `Resume test (${Math.ceil((a.my.seconds_left ?? 0) / 60)} min left)` : 'Start test'}
              </Button>
            ) : <p className="flex items-center gap-2 text-sm text-ink-300"><Lock className="h-4 w-4" /> {a.window.reason}{a.window.opens_at ? ` — opens ${fmtDateTime(a.window.opens_at)}` : ''}</p>}
          </div>
        )}
        {a.my.status === 'EVALUATING' && <p className="mt-4 flex items-center gap-2 text-sm text-brand-600"><Loader2 className="h-4 w-4 animate-spin" /> Submitted — the AI is marking your answers. This page updates automatically.</p>}
        {a.my.status === 'FAILED' && <p className="mt-4 text-sm text-bad">We couldn’t evaluate this automatically ({a.my.error}). Your teacher will review it.{kind === 'ASSIGNMENT' && a.window.open ? ' You can also upload a clearer PDF below.' : ''}</p>}
        {a.result_pending_publish && <p className="mt-4 flex items-center gap-2 text-sm text-ink-300"><Hourglass className="h-4 w-4" /> Evaluated. Your teacher will release the results soon.</p>}
      </Card>

      {kind === 'ASSIGNMENT' && (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Questions</CardTitle>
            {a.question_paper_url && <a href={a.question_paper_url} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary"><Download className="h-3.5 w-3.5" /> Question paper</Button></a>}
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="space-y-2 text-sm">{a.questions?.map((q) => (
              <li key={q.sl_no} className="flex gap-3"><span className="font-semibold text-fg">{q.sl_no}.</span><span className="flex-1 text-ink-100">{q.question_text}
                {q.mcq_options.length > 0 && <span className="mt-1 block text-xs text-ink-300">{q.mcq_options.join('   ')}</span>}</span>
                <span className="text-xs text-ink-500">[{num(q.max_marks)}]</span></li>
            ))}</ol>
            {a.my.file_url && (
              <p className="flex flex-wrap items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-ok" /> Your submission:
                <a href={a.my.file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline"><FileText className="h-3.5 w-3.5" />{a.my.file_name}</a>
                {a.my.submitted_by_teacher && <span className="text-xs text-ink-500">(uploaded by your teacher)</span>}</p>
            )}
            {canUpload && !a.result_available && (
              <label className={cn('flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-brand-400/50 bg-brand-500/5 p-4 hover:bg-brand-500/10', pct !== null && 'pointer-events-none opacity-60')}>
                <Upload className="h-7 w-7 text-brand-600" />
                <div><div className="text-sm font-medium text-fg">{a.my.file_url ? 'Replace your answer PDF' : 'Upload your answer PDF'}</div>
                  <div className="text-xs text-ink-500">Number every answer with its SL.No (e.g. “1.”, “Q2”). One PDF, all pages.{a.window.late ? ' The due date has passed — this will be marked late.' : ''}</div></div>
                <input id="assignment-file" type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = '' }} />
              </label>
            )}
            {pct !== null && <div><div className="mb-1 text-xs text-ink-500">Uploading… {pct}%</div><Progress value={pct} /></div>}
            {!a.window.open && a.my.status === 'NOT_STARTED' && <p className="text-sm text-bad">{a.window.reason}</p>}
          </CardContent>
        </Card>
      )}

      {report && <ReportView report={report} />}
    </div>
  )
}
