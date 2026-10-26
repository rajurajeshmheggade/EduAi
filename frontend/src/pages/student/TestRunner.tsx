import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, CloudCheck, Flag, Loader2, Send, Timer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/field'
import { errorMessage } from '@/services/apiClient'
import { assessmentService } from '@/services/assessmentService'
import { cn } from '@/lib/utils'
import { num, type StudentAssessment } from '@/types'

const AUTOSAVE_MS = 4000

/** FR-TST-03: timed online test with SL.No palette, autosave and auto-submit at time-up. */
export default function TestRunner() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const [test, setTest] = useState<StudentAssessment | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [flagged, setFlagged] = useState<string[]>([])
  const [idx, setIdx] = useState(0)
  const [left, setLeft] = useState<number | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved')
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef({ answers, flagged })  // read by autosave / submit without re-subscribing timers
  useEffect(() => { latest.current = { answers, flagged } }, [answers, flagged])
  const done = useRef(false)

  // Load (or resume) the attempt; anything but an open attempt goes back to the details page.
  useEffect(() => {
    assessmentService.get(id).then((t) => {
      if (t.my.status !== 'IN_PROGRESS' || !t.questions) { nav(`/student/tests/${id}`, { replace: true }); return }
      setTest(t); setAnswers(t.answers ?? {}); setFlagged(t.flagged ?? []); setLeft(t.my.seconds_left ?? 0)
    }).catch((e) => setError(errorMessage(e)))
  }, [id, nav])

  const submit = useCallback(async (auto = false) => {
    if (done.current) return
    done.current = true
    setSubmitting(true); setConfirming(false)
    try {
      await assessmentService.submit(id, latest.current.answers, latest.current.flagged)
    } catch (e) {
      if (!auto) { done.current = false; setSubmitting(false); setError(errorMessage(e)); return }
    }
    nav(`/student/tests/${id}`, { replace: true })
  }, [id, nav])

  // Countdown from the server's remaining seconds; auto-submit at zero.
  useEffect(() => {
    if (left === null) return
    if (left <= 0) { void submit(true); return }
    const t = window.setTimeout(() => setLeft((s) => (s === null ? s : s - 1)), 1000)
    return () => window.clearTimeout(t)
  }, [left, submit])

  // Debounced autosave; also re-syncs the clock with the server.
  useEffect(() => {
    if (saveState !== 'dirty') return
    const t = window.setTimeout(async () => {
      setSaveState('saving')
      try {
        const r = await assessmentService.autosave(id, latest.current.answers, latest.current.flagged)
        setLeft(r.seconds_left); setSaveState('saved')
      } catch { setSaveState('error') }
    }, AUTOSAVE_MS)
    return () => window.clearTimeout(t)
  }, [saveState, answers, flagged, id])

  // Warn before closing the tab with unsaved answers.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (saveState !== 'saved' && !done.current) e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [saveState])

  if (!test?.questions) return <div className="grid h-full place-items-center p-8">{error ? <p className="text-sm text-bad">{error}</p> : <Loader2 className="h-6 w-6 animate-spin text-brand-600" />}</div>

  const qs = test.questions
  const q = qs[idx]
  const answered = (s: string) => !!answers[s]?.trim()
  const unanswered = qs.filter((x) => !answered(x.sl_no)).length
  const setAnswer = (v: string) => { setAnswers((a) => ({ ...a, [q.sl_no]: v })); setSaveState('dirty') }
  const toggleFlag = () => { setFlagged((f) => (f.includes(q.sl_no) ? f.filter((x) => x !== q.sl_no) : [...f, q.sl_no])); setSaveState('dirty') }
  const mm = Math.floor((left ?? 0) / 60), ss = (left ?? 0) % 60

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 md:p-6">
      <Card className="flex flex-wrap items-center gap-4 p-4">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium uppercase tracking-wide text-brand-600">{test.subject_name}</div>
          <div className="truncate font-display text-lg font-semibold">{test.test_title}</div>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-ink-500" aria-live="polite">
          {saveState === 'saving' ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : saveState === 'error' ? <span className="text-bad">Not saved — check connection</span>
            : saveState === 'dirty' ? 'Unsaved changes' : <><CloudCheck className="h-3.5 w-3.5 text-ok" /> Saved</>}
        </span>
        <div role="timer" aria-label="Time left" className={cn('flex items-center gap-2 rounded-xl px-4 py-2 font-display text-2xl font-bold tabular-nums',
          (left ?? 0) <= 60 ? 'animate-pulse bg-bad text-white' : (left ?? 0) <= 300 ? 'bg-bad/10 text-bad' : 'bg-ink-800 text-fg')}>
          <Timer className="h-5 w-5" /> {String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}
        </div>
        <Button onClick={() => setConfirming(true)} disabled={submitting} id="finish-test"><Send className="h-4 w-4" /> Submit</Button>
      </Card>

      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
        <Card className="p-5 md:p-6">
          <div className="mb-3 flex items-center gap-3">
            <span className="grid h-9 min-w-9 place-items-center rounded-lg bg-brand-500 px-2 font-semibold text-white">{q.sl_no}</span>
            <span className="text-xs text-ink-500">Question {idx + 1} of {qs.length} · {num(q.max_marks)} mark{num(q.max_marks) === 1 ? '' : 's'}</span>
            <button onClick={toggleFlag} aria-pressed={flagged.includes(q.sl_no)} className={cn('ml-auto flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs',
              flagged.includes(q.sl_no) ? 'bg-warn/15 text-warn' : 'text-ink-500 hover:bg-ink-800')}><Flag className="h-3.5 w-3.5" /> {flagged.includes(q.sl_no) ? 'Flagged' : 'Flag for review'}</button>
          </div>
          <p className="whitespace-pre-line text-base text-fg">{q.question_text}</p>

          <div className="mt-5">
            {q.question_type === 'MCQ' ? (
              <div role="radiogroup" aria-label={`Options for question ${q.sl_no}`} className="space-y-2">
                {q.mcq_options.map((o) => {
                  const k = o.slice(1, 2).toLowerCase()
                  const on = answers[q.sl_no] === k
                  return (
                    <label key={o} className={cn('flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors', on ? 'border-brand-400 bg-brand-500/8 ring-1 ring-brand-400/40' : 'border-line hover:border-line-strong')}>
                      <input type="radio" name={`q-${q.sl_no}`} checked={on} onChange={() => setAnswer(k)} className="accent-[var(--color-brand-500)]" />
                      <span className="text-ink-100">{o}</span>
                    </label>
                  )
                })}
                {answers[q.sl_no] && <button className="cursor-pointer text-xs text-ink-500 hover:underline" onClick={() => setAnswer('')}>Clear selection</button>}
              </div>
            ) : (
              <Textarea aria-label={`Answer for question ${q.sl_no}`} rows={q.question_type === 'SHORT_ANSWER' ? 4 : 10} value={answers[q.sl_no] ?? ''} maxLength={10_000}
                onChange={(e) => setAnswer(e.target.value)} placeholder={q.question_type === 'NUMERICAL' ? 'Show formula, substitution, working and the final answer with units…' : 'Write your answer…'} />
            )}
          </div>

          <div className="mt-6 flex justify-between">
            <Button variant="secondary" disabled={idx === 0} onClick={() => setIdx(idx - 1)}><ChevronLeft className="h-4 w-4" /> Previous</Button>
            {idx < qs.length - 1
              ? <Button variant="secondary" onClick={() => setIdx(idx + 1)} id="next-question">Next <ChevronRight className="h-4 w-4" /></Button>
              : <Button onClick={() => setConfirming(true)}><Send className="h-4 w-4" /> Review & submit</Button>}
          </div>
        </Card>

        <Card className="h-fit p-4">
          <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-ink-500">Questions</div>
          <div className="grid grid-cols-5 gap-1.5" role="list" aria-label="Question palette">
            {qs.map((x, i) => (
              <button key={x.sl_no} role="listitem" onClick={() => setIdx(i)} aria-label={`Question ${x.sl_no}${answered(x.sl_no) ? ', answered' : ', unanswered'}${flagged.includes(x.sl_no) ? ', flagged' : ''}`}
                className={cn('relative h-9 cursor-pointer rounded-lg border text-sm font-semibold transition-colors',
                  i === idx && 'ring-2 ring-brand-400', answered(x.sl_no) ? 'border-ok bg-ok text-white' : 'border-line bg-ink-900 text-ink-300 hover:border-line-strong')}>
                {x.sl_no}
                {flagged.includes(x.sl_no) && <Flag className="absolute -right-1 -top-1 h-3.5 w-3.5 fill-warn text-warn" />}
              </button>
            ))}
          </div>
          <ul className="mt-4 space-y-1 text-xs text-ink-300">
            <li className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-ok" /> Answered ({qs.length - unanswered})</li>
            <li className="flex items-center gap-2"><span className="h-3 w-3 rounded border border-line bg-ink-900" /> Unanswered ({unanswered})</li>
            <li className="flex items-center gap-2"><Flag className="h-3 w-3 fill-warn text-warn" /> Flagged ({flagged.length})</li>
          </ul>
        </Card>
      </div>

      <Dialog open={confirming} onClose={() => setConfirming(false)} title="Submit your test?" description="You can’t change your answers after submitting.">
        <div className="space-y-4 text-sm">
          <p>{qs.length - unanswered} of {qs.length} answered.{unanswered > 0 && <b className="text-warn"> {unanswered} unanswered question{unanswered === 1 ? '' : 's'} will score 0.</b>}{flagged.length > 0 && ` ${flagged.length} flagged for review.`}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)}>Keep working</Button>
            <Button onClick={() => submit(false)} disabled={submitting} id="confirm-submit">{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit test</Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
