import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft, Bot, CheckCircle2, ChevronDown, CircleAlert, Clock, FlaskConical, Loader2, MessageCircleQuestion, Play, Plus, RotateCcw, Send, Sparkles,
} from 'lucide-react'
import { SourceAttribution } from '@/components/library/diksha/SourceAttribution'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Label, Textarea } from '@/components/ui/field'
import { Progress } from '@/components/ui/progress'
import { Tabs } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toast'
import { LabClock } from '@/components/virtual-labs/labClock'
import { LabRecord } from '@/components/virtual-labs/LabRecord'
import { LabStage } from '@/components/virtual-labs/LabStage'
import { LiveCameraCheck } from '@/components/proctor/LiveCameraCheck'
import { clock, duration, fmtDateTime, fmtMarks, STATUS_META, windowBadge } from '@/lib/virtualLabs'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/services/apiClient'
import { virtualLabService, type ChatMessage, type LabWork, type StudentLabView, type Worksheet } from '@/services/virtualLabService'

type Section = 'brief' | 'procedure' | 'observations' | 'viva' | 'submit'
type SaveState = { state: 'idle' | 'pending' | 'saving' | 'saved' | 'error'; at?: string; error?: string }

/** Rows to show: at least the number the teacher asked for, plus any the student added. */
function tableRows(ws: Worksheet, work: LabWork): string[][] {
  const n = Math.max(ws.observation_rows, work.observations.length)
  return Array.from({ length: n }, (_, i) => Array.from({ length: ws.observation_columns.length }, (_, j) => work.observations[i]?.[j] ?? ''))
}

function progressOf(ws: Worksheet, work: LabWork) {
  const rows = work.observations.filter((r) => r.some((c) => c.trim())).length
  const answered = ws.questions.filter((q) => {
    const a = work.answers[q.id]
    return q.type === 'mcq' ? typeof a === 'number' : typeof a === 'string' && a.trim() !== ''
  }).length
  return { rows, answered, steps: work.steps_done.length, conclusion: !!work.conclusion?.trim() }
}

/** Student performs a DIKSHA virtual lab: simulation beside the lab worksheet, time in lab, autosave, AI lab assistant. */
export default function VirtualLabWorkspace() {
  const { id = '' } = useParams()
  const [view, setView] = useState<StudentLabView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => virtualLabService.myLab(id).then(setView).catch((e) => setError(errorMessage(e))), [id])
  useEffect(() => { void load() }, [load])

  async function start() {
    setBusy(true); setError(null)
    try { setView(await virtualLabService.start(id)) } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  if (!view) {
    return <div className="mx-auto max-w-7xl p-4 md:p-8">{error ? <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p> : <div className="skeleton h-96" />}</div>
  }
  const { assignment: a, attempt } = view
  const badge = windowBadge(a.window.state, a.due_at, a.available_from)
  const status = attempt?.status ?? 'not_started'

  return (
    <div className="mx-auto max-w-[96rem] space-y-4 p-4 md:p-6">
      <header className="flex flex-wrap items-start gap-3">
        <Link to="/student/virtual-labs" className="mt-1 rounded-lg p-1.5 text-ink-300 hover:bg-ink-800 hover:text-fg" aria-label="Back to my labs"><ArrowLeft className="h-5 w-5" /></Link>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium uppercase tracking-wide text-brand-600">{a.subject_name} · Virtual lab</div>
          <h1 className="font-display text-2xl font-bold text-fg">{a.title}</h1>
          <p className="text-xs text-ink-500">{a.title !== a.lab_name ? `${a.lab_name} · ` : ''}from {a.teacher_name ?? 'your teacher'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={STATUS_META[status].tone}>{STATUS_META[status].label}</Badge>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </div>
      </header>
      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      {!attempt ? (
        <Card className="mx-auto max-w-3xl space-y-4 p-6">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-500/10"><FlaskConical className="h-6 w-6 text-brand-600" /></div>
            <div>
              <h2 className="font-display text-lg font-semibold text-fg">Aim</h2>
              <p className="text-ink-100">{view.worksheet.aim}</p>
            </div>
          </div>
          {a.instructions && <p className="whitespace-pre-line rounded-xl bg-ink-800 p-3 text-sm text-ink-100">{a.instructions}</p>}
          <ul className="grid gap-2 text-sm text-ink-300 sm:grid-cols-3">
            <li className="rounded-xl border border-line p-3"><Clock className="mb-1 h-4 w-4 text-brand-600" />Spend at least <b className="text-fg">{a.min_minutes} min</b> in the lab</li>
            <li className="rounded-xl border border-line p-3"><CheckCircle2 className="mb-1 h-4 w-4 text-brand-600" /><b className="text-fg">{view.worksheet.steps.length}</b> procedure steps · <b className="text-fg">{view.worksheet.questions.length}</b> viva questions</li>
            <li className="rounded-xl border border-line p-3"><Sparkles className="mb-1 h-4 w-4 text-brand-600" /><b className="text-fg">{fmtMarks(a.max_marks)}</b> marks · your work saves automatically</li>
          </ul>
          {a.window.can_work ? (
            <Button size="lg" onClick={start} disabled={busy} id="start-lab" className="w-full">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />} Start the lab</Button>
          ) : <p className="rounded-xl bg-ink-800 p-3 text-center text-sm text-ink-300">{a.window.state === 'scheduled' ? 'This lab has not opened yet.' : 'This lab is no longer open.'}</p>}
        </Card>
      ) : status === 'in_progress' ? (
        <Workspace key={`${attempt.started_at}-${attempt.returned_count}`} id={id} view={view} onSubmitted={setView} />
      ) : (
        <Results view={view} />
      )}
    </div>
  )
}

function Workspace({ id, view, onSubmitted }: { id: string; view: StudentLabView; onSubmitted: (v: StudentLabView) => void }) {
  const { assignment: a, worksheet: ws, lab } = view
  const attempt = view.attempt!
  const [work, setWork] = useState<LabWork>(() => ({ steps_done: attempt.steps_done ?? [], observations: attempt.observations ?? [],
    answers: attempt.answers ?? {}, conclusion: attempt.conclusion ?? null }))
  const [section, setSection] = useState<Section>('brief')
  const [save, setSave] = useState<SaveState>({ state: 'idle' })
  const [submitting, setSubmitting] = useState(false)
  // Gates Submit (see LiveCameraCheck): no viva questions = nothing to check, so ready from the start.
  const [vivaReady, setVivaReady] = useState(ws.questions.length === 0)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const latest = useRef<{ work: LabWork; dirty: boolean }>({ work, dirty: false })

  // time in the lab
  const labClock = useMemo(() => new LabClock(attempt.active_seconds, (s, l) => virtualLabService.activity(id, s, l)), [id, attempt.active_seconds])
  useEffect(() => labClock.start(), [labClock])
  const seconds = useSyncExternalStore(labClock.subscribe, labClock.get)
  const need = a.min_minutes * 60

  // autosave (debounced); what is left is sent when the workspace closes
  const persist = useCallback(async (w: LabWork) => {
    setSave({ state: 'saving' })
    try {
      const r = await virtualLabService.saveWork(id, w)
      if (latest.current.work === w) latest.current.dirty = false
      setSave({ state: 'saved', at: r.saved_at })
    } catch (e) { setSave({ state: 'error', error: errorMessage(e) }) }
  }, [id])
  useEffect(() => () => {
    window.clearTimeout(timer.current)
    if (latest.current.dirty) void virtualLabService.saveWork(id, latest.current.work).catch(() => {})
  }, [id])
  const update = (patch: Partial<LabWork>) => {
    const next = { ...work, ...patch }
    setWork(next)
    latest.current = { work: next, dirty: true }
    setSave({ state: 'pending' })
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void persist(next), 1200)
  }

  const p = progressOf(ws, work)
  async function submit(e?: FormEvent) {
    e?.preventDefault()
    const missing = [
      ws.observation_columns.length && p.rows === 0 ? 'observations' : null,
      p.answered < ws.questions.length ? `${ws.questions.length - p.answered} question(s)` : null,
      ws.conclusion_prompt && !p.conclusion ? 'the conclusion' : null,
    ].filter(Boolean)
    if (missing.length && !confirm(`You have not completed ${missing.join(', ')}. Submit anyway?`)) return
    window.clearTimeout(timer.current)
    setSubmitting(true); setError(null)
    try {
      await labClock.flush()
      labClock.pause()                                  // no time reports after the lab is submitted
      const v = await virtualLabService.submit(id, work)
      latest.current.dirty = false
      toast('✓ Lab submitted')
      onSubmitted(v)
    } catch (err) { labClock.resume(); setError(errorMessage(err)) } finally { setSubmitting(false) }
  }

  const rows = tableRows(ws, work)
  const sections: { id: Section; label: string }[] = [
    { id: 'brief', label: 'Aim' }, { id: 'procedure', label: `Procedure ${p.steps}/${ws.steps.length}` },
    ...(ws.observation_columns.length ? [{ id: 'observations' as Section, label: 'Observations' }] : []),
    { id: 'viva', label: `Viva ${p.answered}/${ws.questions.length}` },
    { id: 'submit', label: 'Conclude' },
  ]
  const idx = sections.findIndex((s) => s.id === section)

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(24rem,1fr)]">
      <div className="min-w-0 space-y-3">
        {attempt.returned_count > 0 && attempt.teacher_feedback && (
          <p className="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/10 p-3 text-sm text-ink-100" role="status">
            <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-warn" /><span><b>Your teacher sent this lab back:</b> {attempt.teacher_feedback}</span>
          </p>
        )}
        <LabStage lab={lab} height="62vh" onLaunch={(_, inApp) => labClock.launch(inApp)} />
        {lab.collection && <SourceAttribution item={lab.collection} compact className="px-1" />}
      </div>

      <div className="min-w-0 space-y-3 xl:sticky xl:top-4 xl:self-start">
        <Card className="space-y-2 p-4" aria-label="Time in lab">
          <div className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-brand-600" />
            <span className="text-ink-300">Time in lab</span>
            <b className="font-display text-lg tabular-nums text-fg" data-testid="lab-clock">{clock(seconds)}</b>
            {need > 0 && <span className="text-xs text-ink-500">/ {a.min_minutes} min needed</span>}
            <span className="ml-auto text-xs text-ink-500" aria-live="polite">
              {save.state === 'saving' ? 'Saving…' : save.state === 'pending' ? 'Unsaved changes' : save.state === 'saved' ? 'All changes saved'
                : save.state === 'error' ? <span className="text-bad">{save.error}</span> : ''}
            </span>
          </div>
          {need > 0 && <Progress value={(seconds / need) * 100} tone={seconds >= need ? 'ok' : 'brand'} />}
        </Card>

        {ws.questions.length > 0 && (
          <LiveCameraCheck title="Lab camera check" totalQuestions={ws.questions.length} answered={p.answered}
            reportFlag={() => virtualLabService.proctorFlag(id)} onReady={setVivaReady} />
        )}

        <Card className="p-4">
          <Tabs items={sections} value={section} onChange={setSection} className="mb-4 flex-wrap" />
          {section === 'brief' && (
            <div className="space-y-3 text-sm">
              <div><h3 className="font-semibold text-fg">Aim</h3><p className="text-ink-100">{ws.aim}</p></div>
              {a.instructions && <div><h3 className="font-semibold text-fg">Teacher&rsquo;s instructions</h3><p className="whitespace-pre-line text-ink-100">{a.instructions}</p></div>}
              {ws.materials.length > 0 && <div><h3 className="font-semibold text-fg">Apparatus / materials</h3>
                <ul className="mt-1 flex flex-wrap gap-1.5">{ws.materials.map((m) => <li key={m}><Badge>{m}</Badge></li>)}</ul></div>}
              <p className="rounded-xl bg-brand-500/5 p-3 text-ink-300">Open the <b className="text-fg">Simulation</b> on the left and follow the procedure. The <b className="text-fg">Theory</b>, <b className="text-fg">Procedure</b> and
                <b className="text-fg"> Animation</b> tabs explain the experiment. Stuck? Ask the lab assistant below.</p>
            </div>
          )}
          {section === 'procedure' && (
            <fieldset>
              <legend className="mb-2 text-sm text-ink-300">Tick each step as you do it in the simulation.</legend>
              <ol className="space-y-1.5">
                {ws.steps.map((s, i) => {
                  const done = work.steps_done.includes(i)
                  return (
                    <li key={i}>
                      <label className={cn('flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 text-sm transition-colors', done ? 'border-ok/30 bg-ok/5 text-ink-300' : 'border-line text-ink-100 hover:bg-ink-800')}>
                        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-500" checked={done}
                          onChange={() => update({ steps_done: done ? work.steps_done.filter((x) => x !== i) : [...work.steps_done, i].sort((x, y) => x - y) })} />
                        <span><span className="text-ink-500">{i + 1}.</span> {s}</span>
                      </label>
                    </li>
                  )
                })}
              </ol>
            </fieldset>
          )}
          {section === 'observations' && (
            <div className="space-y-2">
              <p className="text-sm text-ink-300">Record what you see in the simulation{ws.observation_columns.some((c) => /\(.+\)/.test(c)) ? ', with units' : ''}.</p>
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-sm">
                  <caption className="sr-only">Observation table</caption>
                  <thead className="bg-ink-800 text-xs text-ink-300"><tr><th className="w-8 px-2 py-2">#</th>{ws.observation_columns.map((c) => <th key={c} className="px-2 py-2 text-left font-medium">{c}</th>)}</tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-t border-line">
                        <td className="px-2 text-center text-xs tabular-nums text-ink-500">{i + 1}</td>
                        {r.map((c, j) => (
                          <td key={j} className="p-1">
                            <Input aria-label={`Row ${i + 1}, ${ws.observation_columns[j]}`} className="h-9 min-w-24 text-sm" maxLength={200} value={c}
                              onChange={(e) => update({ observations: rows.map((row, x) => (x === i ? row.map((cell, y) => (y === j ? e.target.value : cell)) : row)) })} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length < Math.min(20, ws.observation_rows + 5) && (
                <Button size="sm" variant="ghost" onClick={() => update({ observations: [...rows, ws.observation_columns.map(() => '')] })}><Plus className="h-3.5 w-3.5" /> Add a row</Button>
              )}
            </div>
          )}
          {section === 'viva' && (
            <ol className="space-y-4">
              {ws.questions.length === 0 && <li className="text-sm text-ink-500">No viva questions in this lab.</li>}
              {ws.questions.map((q, i) => (
                <li key={q.id}>
                  {q.type === 'mcq' ? (
                    <fieldset>
                      <legend className="mb-1.5 text-sm text-fg"><span className="text-ink-500">Q{i + 1}.</span> {q.prompt} <span className="text-xs text-ink-500">({fmtMarks(q.marks)})</span></legend>
                      <div className="space-y-1">
                        {q.options.map((o, k) => (
                          <label key={k} className={cn('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm', work.answers[q.id] === k ? 'border-brand-400/50 bg-brand-500/10 text-fg' : 'border-line text-ink-100 hover:bg-ink-800')}>
                            <input type="radio" name={q.id} className="accent-brand-500" checked={work.answers[q.id] === k} onChange={() => update({ answers: { ...work.answers, [q.id]: k } })} />
                            {o}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ) : (
                    <div>
                      <Label htmlFor={`ans-${q.id}`}>{`Q${i + 1}. ${q.prompt} (${fmtMarks(q.marks)})`}</Label>
                      <Textarea id={`ans-${q.id}`} rows={3} maxLength={3000} value={typeof work.answers[q.id] === 'string' ? (work.answers[q.id] as string) : ''}
                        onChange={(e) => update({ answers: { ...work.answers, [q.id]: e.target.value } })} />
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
          {section === 'submit' && (
            <form onSubmit={submit} className="space-y-3">
              <div><Label htmlFor="lab-conclusion">{ws.conclusion_prompt || 'Conclusion'}</Label>
                <Textarea id="lab-conclusion" rows={4} maxLength={4000} value={work.conclusion ?? ''} onChange={(e) => update({ conclusion: e.target.value })} /></div>
              <ul className="space-y-1 text-sm" aria-label="Checklist">
                {[
                  [seconds >= need, need ? `At least ${a.min_minutes} min in the lab (${duration(seconds)} so far)` : `Time in the lab: ${duration(seconds)}`],
                  [p.steps === ws.steps.length, `Procedure: ${p.steps} of ${ws.steps.length} steps ticked`],
                  ...(ws.observation_columns.length ? [[p.rows >= ws.observation_rows, `Observations: ${p.rows} of ${ws.observation_rows} rows filled`] as const] : []),
                  [p.answered === ws.questions.length, `Viva: ${p.answered} of ${ws.questions.length} answered`],
                  ...(ws.questions.length ? [[vivaReady, 'Viva camera check complete'] as const] : []),
                  [p.conclusion, 'Conclusion written'],
                ].map(([ok, text]) => (
                  <li key={String(text)} className={cn('flex items-center gap-2', ok ? 'text-ok' : 'text-ink-300')}>
                    {ok ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4 text-warn" />}{text}
                  </li>
                ))}
              </ul>
              {error && <p role="alert" className="text-sm text-bad">{error}</p>}
              <Button type="submit" size="lg" className="w-full" id="submit-lab" disabled={submitting || seconds < need || !vivaReady}>
                {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                {seconds < need ? `Keep experimenting — ${clock(need - seconds)} to go` : !vivaReady ? 'Complete the viva camera check first'
                  : submitting ? 'Checking your answers…' : 'Submit lab'}
              </Button>
            </form>
          )}
          {section !== 'submit' && (
            <div className="mt-4 flex justify-end">
              <Button size="sm" variant="secondary" onClick={() => setSection(sections[idx + 1].id)}>Next: {sections[idx + 1].label}</Button>
            </div>
          )}
        </Card>

        <LabAssistant id={id} locked={section === 'viva' && ws.questions.length > 0} />
      </div>
    </div>
  )
}

function LabAssistant({ id, locked }: { id: string; locked?: boolean }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)

  if (locked) {
    return (
      <Card className="flex items-start gap-2.5 p-4 text-sm text-ink-300" aria-label="Ask the lab assistant (disabled)">
        <Bot className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" />
        <span><b className="text-fg">Ask the lab assistant</b> is turned off during the viva, so your answers are your own. It's back once you move to Conclude.</span>
      </Card>
    )
  }

  async function ask(e: FormEvent) {
    e.preventDefault()
    const question = q.trim()
    if (question.length < 2) return
    const history = messages
    setMessages([...history, { role: 'user', content: question }]); setQ(''); setBusy(true)
    try {
      const r = await virtualLabService.ask(id, question, history.slice(-6))
      setMessages((m) => [...m, { role: 'assistant', content: r.answer }])
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', content: errorMessage(err) }])
    } finally {
      setBusy(false)
      window.setTimeout(() => end.current?.scrollIntoView?.({ block: 'nearest' }), 0)
    }
  }

  return (
    <Card className="p-0">
      <button className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Bot className="h-4 w-4 text-brand-600" /><span className="font-medium text-fg">Ask the lab assistant</span>
        <span className="text-xs text-ink-500">hints, not answers</span>
        <ChevronDown className={cn('ml-auto h-4 w-4 text-ink-500 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-line p-3">
          <div className="max-h-72 space-y-2 overflow-y-auto" aria-live="polite">
            {messages.length === 0 && <p className="text-xs text-ink-500">e.g. “What should I change first in the simulation?” or “Why does the temperature fall?”</p>}
            {messages.map((m, i) => (
              <p key={i} className={cn('max-w-[90%] whitespace-pre-line rounded-xl px-3 py-2 text-sm', m.role === 'user' ? 'ml-auto bg-brand-500/15 text-fg' : 'bg-ink-800 text-ink-100')}>{m.content}</p>
            ))}
            {busy && <p className="flex items-center gap-2 text-xs text-ink-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…</p>}
            <div ref={end} />
          </div>
          <form onSubmit={ask} className="flex gap-2">
            <Input aria-label="Question for the lab assistant" placeholder="Ask about this experiment" maxLength={1000} value={q} onChange={(e) => setQ(e.target.value)} />
            <Button type="submit" size="icon" aria-label="Ask" disabled={busy || q.trim().length < 2}><MessageCircleQuestion className="h-4 w-4" /></Button>
          </form>
        </div>
      )}
    </Card>
  )
}

function Results({ view }: { view: StudentLabView }) {
  const { assignment: a, attempt, worksheet, lab } = view
  const r = attempt!.result
  const fb = r?.feedback
  const reviewed = attempt!.status === 'reviewed'
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="min-w-0 space-y-4">
        <Card className="space-y-3 p-5">
          <div className="flex flex-wrap items-center gap-3">
            {reviewed ? (
              <div><div className="text-xs uppercase tracking-widest text-ink-500">Marks</div>
                <div className="font-display text-4xl font-bold tabular-nums text-fg" data-testid="lab-marks">{fmtMarks(r?.marks)}<span className="text-xl text-ink-500">/{fmtMarks(a.max_marks)}</span></div></div>
            ) : (
              <div><div className="text-xs uppercase tracking-widest text-ink-500">Submitted</div>
                <div className="text-sm text-ink-100">{attempt!.submitted_at && fmtDateTime(attempt!.submitted_at)}{attempt!.is_late && <Badge tone="bad" className="ml-2">Late</Badge>}</div>
                <div className="text-xs text-ink-500">Your teacher will review it and give final marks.</div></div>
            )}
            <div className="ml-auto grid grid-cols-2 gap-2 text-center text-sm">
              {r?.auto_max ? <div className="rounded-xl bg-ink-800 px-3 py-2"><div className="text-xs text-ink-500">MCQs</div><b className="tabular-nums text-fg">{fmtMarks(r.auto_score)}/{fmtMarks(r.auto_max)}</b></div> : null}
              <div className="rounded-xl bg-ink-800 px-3 py-2"><div className="text-xs text-ink-500">Time in lab</div><b className="tabular-nums text-fg">{duration(attempt!.active_seconds)}</b></div>
            </div>
          </div>
          {!reviewed && r?.suggested_marks != null && <p className="text-xs text-ink-500">AI estimate: {fmtMarks(r.suggested_marks)}/{fmtMarks(a.max_marks)} — your teacher confirms the final marks.</p>}
          {attempt!.teacher_feedback && reviewed && <p className="rounded-xl border border-ok/30 bg-ok/5 p-3 text-sm text-ink-100"><b>Teacher:</b> {attempt!.teacher_feedback}</p>}
          {fb?.overall && <p className="flex gap-2 rounded-xl border border-brand-400/30 bg-brand-500/5 p-3 text-sm text-ink-100"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />{fb.overall}</p>}
        </Card>
        <LabStage lab={lab} height="50vh" />
      </div>
      <Card className="min-w-0 p-5">
        <h2 className="mb-3 font-display text-lg font-semibold text-fg">Your lab record</h2>
        <LabRecord worksheet={worksheet} work={attempt!} result={r} />
      </Card>
    </div>
  )
}
