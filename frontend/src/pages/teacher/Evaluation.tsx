import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BarChart3, CalendarClock, ClipboardList, FileStack, FolderUp, ListChecks, Loader2, MonitorCheck, Plus, ScanText, Send, Trash2, Undo2 } from 'lucide-react'
import { NewTestDialog } from '@/components/evaluation/NewTestDialog'
import { QuestionsStep } from '@/components/evaluation/QuestionsStep'
import { ResultsStep } from '@/components/evaluation/ResultsStep'
import { ScriptsStep } from '@/components/evaluation/ScriptsStep'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label, Select, Textarea } from '@/components/ui/field'
import { Tabs } from '@/components/ui/tabs'
import { errorMessage } from '@/services/apiClient'
import { fmtDateTime } from '@/services/assessmentService'
import { classroomService } from '@/services/classroomService'
import { evaluationService } from '@/services/evaluationService'
import { fromLocalInput, toLocalInput } from '@/lib/datetime'
import { cn } from '@/lib/utils'
import { num, type AssessmentType, type EvalStatus, type EvalTest, type MasterQuestion, type TeacherClass } from '@/types'

type Step = 'questions' | 'scripts' | 'results'
const STATUS: Record<EvalStatus, { label: string; tone: 'neutral' | 'warn' | 'ok' | 'brand' | 'aqua' }> = {
  DRAFT: { label: 'Needs questions', tone: 'neutral' }, READY: { label: 'Ready', tone: 'brand' },
  PROCESSING: { label: 'Evaluating…', tone: 'warn' }, EVALUATED: { label: 'Evaluated', tone: 'ok' }, PUBLISHED: { label: 'Published', tone: 'aqua' },
}
const TYPE: Record<AssessmentType, { label: string; icon: typeof FolderUp }> = {
  ONLINE_TEST: { label: 'Online test', icon: MonitorCheck }, ASSIGNMENT: { label: 'Assignment', icon: ClipboardList },
  OFFLINE_EXAM: { label: 'Offline exam', icon: FolderUp },
}
const defaultStep = (t: EvalTest): Step =>
  t.status === 'DRAFT' ? 'questions' : t.assessment_type === 'OFFLINE_EXAM' && (t.status === 'READY' || t.status === 'PROCESSING') ? 'scripts'
    : t.assessment_type !== 'OFFLINE_EXAM' && !t.evaluated ? 'scripts' : 'results'

const PAGE: Record<AssessmentType, { title: [string, string]; intro: string; empty: string; newLabel: string }> = {
  OFFLINE_EXAM: {
    title: ['AI ', 'evaluation'], newLabel: 'New evaluation',
    intro: 'Upload the question paper, SL.No model answers and a folder of student scripts — the AI marks each SL.No with reasons, missing points and feedback.',
    empty: 'No evaluations yet. Click “New evaluation” to upload an exam.',
  },
  ONLINE_TEST: {
    title: ['Online ', 'tests'], newLabel: 'New test',
    intro: 'Timed tests students take online. MCQs are marked instantly; written answers are marked by AI with reasons and feedback.',
    empty: 'No tests yet. Click “New test” to create one.',
  },
  ASSIGNMENT: {
    title: ['', 'Assignments'], newLabel: 'New assignment',
    intro: 'Students upload their written answers as a PDF; the AI reads each SL.No and marks it against your model answers.',
    empty: 'No assignments yet. Click “New assignment” to create one.',
  },
}

/** Teacher workspace for one assessment type: AI evaluation (offline exams), online tests or assignments. */
export default function Evaluation({ kind }: { kind: AssessmentType }) {
  const [params, setParams] = useSearchParams()
  const [classes, setClasses] = useState<TeacherClass[] | null>(null)
  const [tests, setTests] = useState<EvalTest[] | null>(null)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<(EvalTest & { masters: MasterQuestion[] }) | null>(null)
  const [step, setStep] = useState<Step>('questions')
  const [creating, setCreating] = useState(() => params.has('new'))
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { classroomService.myClasses().then(setClasses).catch((e) => setError(errorMessage(e))) }, [])

  const loadTests = useCallback(async () => {
    try {
      const [klass, subject] = filter ? filter.split('|') : []
      const t = await evaluationService.tests({ ...(filter ? { class_code: klass, subject_code: subject } : {}), assessment_type: kind })
      setTests(t)
      setSelected((s) => (s && t.some((x) => x.eval_test_id === s) ? s : t[0]?.eval_test_id ?? null))
    } catch (e) { setError(errorMessage(e)) }
  }, [filter, kind])
  useEffect(() => { void loadTests() }, [loadTests])

  const loadDetail = useCallback(async (keepStep = true) => {
    if (!selected) { setDetail(null); return }
    try {
      const d = await evaluationService.get(selected)
      setDetail(d)
      if (!keepStep) setStep(defaultStep(d))
    } catch (e) { setError(errorMessage(e)) }
  }, [selected])
  useEffect(() => { void loadDetail(false) }, [loadDetail])

  const refresh = useCallback(() => { void loadDetail(); void loadTests() }, [loadDetail, loadTests])
  const options = classes?.flatMap((c) => c.subjects.map((s) => ({ key: `${c.class_code}|${s.subject_code}`, label: `${c.class_name} · ${s.subject_name}` }))) ?? []

  async function remove(t: EvalTest) {
    if (!confirm(`Delete "${t.test_title}" with all its submissions and results?`)) return
    try { await evaluationService.remove(t.eval_test_id); setSelected(null); void loadTests() } catch (e) { setError(errorMessage(e)) }
  }

  async function toggleAssign(t: EvalTest) {
    if (t.is_assigned && !confirm('Withdraw this from the class? Students will no longer see it.')) return
    setBusy(true); setError(null)
    try { await evaluationService.setAssigned(t.eval_test_id, !t.is_assigned); refresh() } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <div className="mx-auto max-w-[90rem] space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4 animate-fade-up">
        <div>
          <h1 className="font-display text-3xl font-bold">{PAGE[kind].title[0]}<span className="text-gradient">{PAGE[kind].title[1]}</span></h1>
          <p className="mt-1 text-sm text-ink-300">{PAGE[kind].intro}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select aria-label="Filter by class and subject" className="w-60" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All my classes & subjects</option>
            {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </Select>
          <Button onClick={() => setCreating(true)} disabled={!classes?.length} id="new-evaluation"><Plus className="h-4 w-4" /> {PAGE[kind].newLabel}</Button>
        </div>
      </header>

      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      <div className="grid gap-6 xl:grid-cols-[21rem_1fr]">
        <nav aria-label="Tests and assignments" className="space-y-2">
          {!tests ? <div className="skeleton h-48" /> : tests.length === 0 ? (
            <Card className="p-6 text-center text-sm text-ink-300"><ScanText className="mx-auto mb-2 h-8 w-8 text-ink-500" />{PAGE[kind].empty}</Card>
          ) : tests.map((t) => {
            const Icon = TYPE[t.assessment_type].icon
            return (
              <button key={t.eval_test_id} onClick={() => setSelected(t.eval_test_id)}
                className={cn('w-full cursor-pointer rounded-xl border p-3 text-left transition-all',
                  t.eval_test_id === selected ? 'border-brand-400 bg-brand-500/8 ring-1 ring-brand-400/40' : 'border-line bg-ink-900 hover:border-line-strong')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 font-medium text-fg">{t.test_title}</div>
                  <Badge tone={STATUS[t.status].tone} className="shrink-0">{STATUS[t.status].label}</Badge>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-500"><Icon className="h-3.5 w-3.5" />{TYPE[t.assessment_type].label} · {t.class_name} · {t.subject_name}</div>
                {t.assessment_type !== 'OFFLINE_EXAM' && (
                  <div className="mt-0.5 text-xs text-ink-500">{t.is_assigned ? <>Due {fmtDateTime(t.due_at)}</> : <span className="text-warn">Not assigned yet</span>}</div>
                )}
                <div className="mt-1.5 text-xs text-ink-300">
                  {t.assessment_type === 'OFFLINE_EXAM' ? `${t.evaluated}/${t.scripts} evaluated` : `${t.submitted}/${t.class_students} submitted · ${t.evaluated} evaluated`}
                  {t.average_percentage != null ? ` · avg ${num(t.average_percentage)}%` : ''}
                </div>
              </button>
            )
          })}
        </nav>

        <section className="min-w-0 space-y-5">
          {!detail ? (tests?.length ? <div className="skeleton h-96" /> : null) : (
            <>
              <Card className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-display text-lg font-semibold">{detail.test_title}</div>
                    <div className="text-sm text-ink-300">{TYPE[detail.assessment_type].label} · {detail.class_name} · {detail.subject_name} · {detail.evaluation_scope === 'CHAPTER_LEVEL' ? `Chapter: ${detail.chapter_title}` : 'Subject level'} · pass {num(detail.pass_percentage)}%</div>
                  </div>
                  <Badge tone={STATUS[detail.status].tone}>{STATUS[detail.status].label}</Badge>
                  {detail.assessment_type !== 'OFFLINE_EXAM' && (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setEditing(true)}><CalendarClock className="h-3.5 w-3.5" /> Schedule</Button>
                      <Button size="sm" variant={detail.is_assigned ? 'outline' : 'default'} disabled={busy || (!detail.is_assigned && detail.status === 'DRAFT')} onClick={() => toggleAssign(detail)} id="assign-toggle"
                        title={detail.status === 'DRAFT' ? 'Save questions first' : undefined}>
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : detail.is_assigned ? <Undo2 className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
                        {detail.is_assigned ? 'Withdraw' : 'Assign to class'}
                      </Button>
                    </>
                  )}
                  {detail.status !== 'PUBLISHED' && detail.status !== 'PROCESSING' && !detail.is_assigned && (
                    <Button size="sm" variant="ghost" aria-label="Delete" onClick={() => remove(detail)}><Trash2 className="h-4 w-4" /></Button>
                  )}
                </div>
                {detail.assessment_type !== 'OFFLINE_EXAM' && (
                  <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-3 text-xs text-ink-300">
                    {detail.duration_minutes && <span><b className="text-ink-100">{detail.duration_minutes} min</b> timer</span>}
                    <span>Opens <b className="text-ink-100">{detail.available_from ? fmtDateTime(detail.available_from) : 'when assigned'}</b></span>
                    <span>Due <b className="text-ink-100">{fmtDateTime(detail.due_at)}</b>{detail.allow_late ? ' · late allowed' : ''}</span>
                    <span>Results <b className="text-ink-100">{detail.results_release === 'INSTANT' ? 'shown instantly' : 'after you publish'}</b></span>
                    {detail.is_assigned ? <span className="text-ok">● Visible to students</span> : <span className="text-warn">● Not assigned — students can’t see it</span>}
                  </div>
                )}
              </Card>

              <Tabs value={step} onChange={setStep} items={[
                { id: 'questions', label: '1 · Questions & answers', icon: ListChecks, count: detail.masters.length },
                { id: 'scripts', label: detail.assessment_type === 'OFFLINE_EXAM' ? '2 · Student scripts' : '2 · Submissions', icon: FileStack,
                  count: detail.assessment_type === 'OFFLINE_EXAM' ? detail.scripts : detail.submitted },
                { id: 'results', label: '3 · Results & analytics', icon: BarChart3, count: detail.evaluated },
              ]} />

              <div key={`${detail.eval_test_id}-${step}`} className="animate-fade-up">
                {step === 'questions' && <QuestionsStep test={detail} masters={detail.masters} onSaved={() => { refresh(); setStep(detail.assessment_type === 'OFFLINE_EXAM' ? 'scripts' : 'questions') }} />}
                {step === 'scripts' && (detail.status === 'DRAFT'
                  ? <Card className="p-8 text-center text-sm text-ink-300">Save the questions and model answers first (step 1).</Card>
                  : <ScriptsStep test={detail} onChanged={refresh} />)}
                {step === 'results' && <ResultsStep test={detail} onChanged={refresh} />}
              </div>
            </>
          )}
        </section>
      </div>

      {creating && classes && (
        <NewTestDialog classes={classes} initialType={kind} lockType onClose={() => { setCreating(false); setParams({}, { replace: true }) }}
          onCreated={(t) => { setCreating(false); setParams({}, { replace: true }); setSelected(t.eval_test_id); void loadTests() }} />
      )}
      {editing && detail && <ScheduleDialog test={detail} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refresh() }} />}
    </div>
  )
}

function ScheduleDialog({ test, onClose, onSaved }: { test: EvalTest; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    test_title: test.test_title, instructions: test.instructions ?? '', duration_minutes: test.duration_minutes ?? 30,
    available_from: toLocalInput(test.available_from), due_at: toLocalInput(test.due_at), allow_late: test.allow_late,
    results_release: test.results_release, pass_percentage: num(test.pass_percentage),
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await evaluationService.updateSettings(test.eval_test_id, {
        test_title: f.test_title, instructions: f.instructions, pass_percentage: f.pass_percentage,
        ...(test.assessment_type === 'ONLINE_TEST' ? { duration_minutes: f.duration_minutes } : {}),
        available_from: fromLocalInput(f.available_from), due_at: fromLocalInput(f.due_at), allow_late: f.allow_late,
        results_release: f.results_release,
      })
      onSaved()
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  return (
    <Dialog open onClose={onClose} title="Schedule & settings" description={TYPE[test.assessment_type].label}>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Label htmlFor="sc-title">Title</Label><Input id="sc-title" required minLength={2} value={f.test_title} onChange={(e) => setF({ ...f, test_title: e.target.value })} /></div>
        <div className="sm:col-span-2"><Label htmlFor="sc-instr">Instructions</Label><Textarea id="sc-instr" rows={2} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></div>
        {test.assessment_type === 'ONLINE_TEST' && <div><Label htmlFor="sc-dur">Duration (min)</Label><Input id="sc-dur" type="number" min={1} max={600} value={f.duration_minutes} onChange={(e) => setF({ ...f, duration_minutes: Number(e.target.value) })} /></div>}
        <div><Label htmlFor="sc-pass">Pass %</Label><Input id="sc-pass" type="number" min={0} max={100} value={f.pass_percentage} onChange={(e) => setF({ ...f, pass_percentage: Number(e.target.value) })} /></div>
        <div><Label htmlFor="sc-from">Opens</Label><Input id="sc-from" type="datetime-local" value={f.available_from} onChange={(e) => setF({ ...f, available_from: e.target.value })} /></div>
        <div><Label htmlFor="sc-due">Due</Label><Input id="sc-due" type="datetime-local" required value={f.due_at} onChange={(e) => setF({ ...f, due_at: e.target.value })} /></div>
        <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={f.allow_late} onChange={(e) => setF({ ...f, allow_late: e.target.checked })} className="accent-[var(--color-brand-500)]" /> Accept late submissions</label>
        <div><Label htmlFor="sc-rel">Show results</Label>
          <Select id="sc-rel" value={f.results_release} onChange={(e) => setF({ ...f, results_release: e.target.value as 'INSTANT' | 'ON_PUBLISH' })}>
            <option value="INSTANT">Instantly</option><option value="ON_PUBLISH">After I publish</option>
          </Select>
        </div>
        {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad sm:col-span-2">{error}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save</Button>
        </div>
      </form>
    </Dialog>
  )
}
