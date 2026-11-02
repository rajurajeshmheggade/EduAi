import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, CheckCircle2, Clock, Loader2, Lock, LockOpen, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label, Textarea } from '@/components/ui/field'
import { ErrorState } from '@/components/ui/loading'
import { Progress } from '@/components/ui/progress'
import { toast } from '@/components/ui/toast'
import { LabRecord } from '@/components/virtual-labs/LabRecord'
import { duration, fmtDateTime, fmtMarks, localInput, STATUS_META, windowBadge } from '@/lib/virtualLabs'
import { errorMessage } from '@/services/apiClient'
import { virtualLabService, type AssignmentDetail as Detail, type AttemptDetail } from '@/services/virtualLabService'

/** Teacher: class progress on one lab, each student's record, marks / feedback, return for redo; close, extend, delete. */
export function AssignmentDetail({ assignmentId, onClose, onChanged }: { assignmentId: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<Detail | null>(null)
  const [student, setStudent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [due, setDue] = useState('')
  const [now] = useState(() => localInput(new Date()))
  const load = useCallback(() => virtualLabService.assignment(assignmentId).then(setData).catch((e) => setError(errorMessage(e))), [assignmentId])
  useEffect(() => { void load() }, [load])

  async function act(fn: () => Promise<unknown>, done: string) {
    setError(null)
    try { await fn(); toast(`✓ ${done}`); await load(); onChanged() } catch (e) { setError(errorMessage(e)) }
  }

  const s = data?.stats
  const badge = data && windowBadge(data.window.state, data.due_at, data.available_from)
  return (
    <Dialog open onClose={onClose} title={data?.title ?? 'Virtual lab'} description={data ? `${data.class_name} · ${data.subject_name} · ${data.max_marks} marks` : undefined}
      className="w-[min(64rem,calc(100vw-2rem))]">
      {error && data && <p role="alert" className="mb-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      {!data || !s ? (error ? <ErrorState title="Couldn’t load this lab" message={error} onRetry={() => { setError(null); void load() }} /> : <div className="skeleton h-64" />) : student ? (
        <Review assignmentId={assignmentId} studentCode={student} onBack={() => { setStudent(null); void load(); onChanged() }} />
      ) : (
        <div className="max-h-[72vh] space-y-4 overflow-y-auto pr-1">
          <div className="flex flex-wrap items-center gap-2">
            {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
            <Badge tone="neutral"><Clock className="h-3 w-3" /> min {data.min_minutes} min in lab</Badge>
            <span className="text-xs text-ink-500">{data.lab_name}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[['Submitted', `${s.submitted}/${s.students}`], ['To review', String(s.submitted - s.reviewed)],
              ['Avg time in lab', s.average_minutes == null ? '—' : `${s.average_minutes} min`], ['Class average', s.average_pct == null ? '—' : `${s.average_pct}%`]]
              .map(([k, v]) => (
                <div key={k} className="rounded-xl border border-line p-3">
                  <div className="text-[11px] uppercase tracking-widest text-ink-500">{k}</div>
                  <div className="mt-1 font-display text-xl font-bold tabular-nums text-fg">{v}</div>
                </div>
              ))}
          </div>
          <Progress value={s.students ? (s.submitted / s.students) * 100 : 0} tone="ok" />

          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Students</caption>
              <thead className="bg-ink-800 text-xs text-ink-300">
                <tr><th className="px-3 py-2 font-medium">Roll</th><th className="px-3 py-2 font-medium">Student</th><th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Time in lab</th><th className="px-3 py-2 font-medium">Submitted</th><th className="px-3 py-2 font-medium">MCQ</th>
                  {data.roster.some((r) => r.videos_required) && <th className="px-3 py-2 font-medium" title="Lab videos watched to the end (needed before submitting)">Videos</th>}
                  <th className="px-3 py-2 font-medium">AI suggests</th><th className="px-3 py-2 font-medium">Marks</th>
                  <th className="px-3 py-2 font-medium" title="Camera/mic check flags during the lab">Flags</th><th className="px-3 py-2" /></tr>
              </thead>
              <tbody>
                {data.roster.map((r) => {
                  const st = STATUS_META[r.status]
                  return (
                    <tr key={r.student_code} className="border-t border-line">
                      <td className="px-3 py-2 tabular-nums text-ink-500">{r.roll_number ?? ''}</td>
                      <td className="px-3 py-2 font-medium text-fg">{r.full_name}</td>
                      <td className="px-3 py-2"><Badge tone={st.tone}>{st.label}</Badge>{r.returned_count ? <span className="ml-1 text-xs text-ink-500">redo ×{r.returned_count}</span> : null}</td>
                      <td className="px-3 py-2 tabular-nums">{r.status === 'not_started' ? '—' : duration(r.active_seconds)}{r.launches ? <span className="text-xs text-ink-500"> · {r.launches}× opened</span> : null}</td>
                      <td className="px-3 py-2 text-xs">{r.submitted_at ? fmtDateTime(r.submitted_at) : '—'}{r.is_late && <Badge tone="bad" className="ml-1">late</Badge>}</td>
                      <td className="px-3 py-2 tabular-nums">{r.auto_max ? `${fmtMarks(r.auto_score)}/${fmtMarks(r.auto_max)}` : '—'}</td>
                      {data.roster.some((x) => x.videos_required) && (
                        <td className="px-3 py-2 tabular-nums">{r.status === 'not_started' ? '—'
                          : <Badge tone={r.videos_watched === r.videos_required ? 'ok' : 'neutral'}>{r.videos_watched ?? 0}/{r.videos_required}</Badge>}</td>
                      )}
                      <td className="px-3 py-2 tabular-nums">{fmtMarks(r.suggested_marks)}</td>
                      <td className="px-3 py-2 font-semibold tabular-nums text-fg">{r.marks == null ? '—' : `${fmtMarks(r.marks)}/${fmtMarks(data.max_marks)}`}</td>
                      <td className="px-3 py-2 tabular-nums">{r.proctor_flag_count ? <Badge tone="warn">{r.proctor_flag_count}</Badge> : <span className="text-ink-500">—</span>}</td>
                      <td className="px-3 py-2 text-right">
                        {r.status !== 'not_started' && (
                          <Button size="sm" variant={r.status === 'submitted' ? 'default' : 'secondary'} onClick={() => setStudent(r.student_code)}
                            aria-label={`${r.status === 'submitted' ? 'Review' : 'Open'} ${r.full_name}`}>
                            {r.status === 'submitted' ? 'Review' : 'Open'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-end gap-2 border-t border-line pt-4">
            <div><Label htmlFor="vl-extend">New due date</Label>
              <Input id="vl-extend" type="datetime-local" className="w-56" min={now} value={due} onChange={(e) => setDue(e.target.value)} /></div>
            <Button variant="secondary" disabled={!due} onClick={() => act(() => virtualLabService.update(assignmentId, { due_at: new Date(due).toISOString() }), 'Due date updated')}>Extend</Button>
            {data.status === 'active'
              ? <Button variant="secondary" onClick={() => act(() => virtualLabService.update(assignmentId, { status: 'closed' }), 'Lab closed')}><Lock className="h-4 w-4" /> Close lab</Button>
              : <Button variant="secondary" onClick={() => act(() => virtualLabService.update(assignmentId, { status: 'active' }), 'Lab reopened')}><LockOpen className="h-4 w-4" /> Reopen</Button>}
            <Button variant="danger" className="ml-auto" onClick={async () => {
              if (!confirm(`Delete "${data.title}" and all student work?`)) return
              try { await virtualLabService.remove(assignmentId); toast('✓ Lab deleted'); onChanged(); onClose() } catch (e) { setError(errorMessage(e)) }
            }}><Trash2 className="h-4 w-4" /> Delete</Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

function Review({ assignmentId, studentCode, onBack }: { assignmentId: string; studentCode: string; onBack: () => void }) {
  const [d, setD] = useState<AttemptDetail | null>(null)
  const [marks, setMarks] = useState('')
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    virtualLabService.attempt(assignmentId, studentCode).then((x) => {
      setD(x)
      const r = x.attempt.result
      const suggested = r.marks ?? r.suggested_marks ?? (x.worksheet.questions.every((q) => q.type === 'mcq') && !x.worksheet.record_marks ? r.auto_score : null)
      setMarks(suggested == null ? '' : String(suggested))
      setFeedback(x.attempt.teacher_feedback ?? '')
    }).catch((e) => setError(errorMessage(e)))
  }, [assignmentId, studentCode, reload])

  async function send(redo: boolean) {
    setBusy(true); setError(null)
    try {
      await virtualLabService.review(assignmentId, studentCode, redo ? { return_for_redo: true, feedback } : { marks: Number(marks), feedback })
      toast(redo ? '✓ Sent back to the student to redo' : '✓ Marks saved')
      onBack()
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  if (!d) return error ? <ErrorState title="Couldn’t load this student’s record" message={error} onRetry={() => { setError(null); setReload((n) => n + 1) }} /> : <div className="skeleton h-64" />
  const a = d.attempt
  const fb = a.result.feedback
  const submitted = a.status === 'submitted' || a.status === 'reviewed'
  return (
    <div className="max-h-[72vh] space-y-4 overflow-y-auto pr-1">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft className="h-4 w-4" /> All students</Button>
        <h3 className="font-display text-lg font-semibold text-fg">{d.student.full_name}</h3>
        <Badge tone={STATUS_META[a.status].tone}>{STATUS_META[a.status].label}</Badge>
        {a.is_late && <Badge tone="bad">Late</Badge>}
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
        <div className="rounded-lg bg-ink-800 p-2"><dt className="text-xs text-ink-500">Time in lab</dt><dd className="font-medium text-fg">{duration(a.active_seconds)} <span className="text-xs text-ink-500">(min {d.min_minutes} min)</span></dd></div>
        <div className="rounded-lg bg-ink-800 p-2"><dt className="text-xs text-ink-500">Simulation opened</dt><dd className="font-medium text-fg">{a.launches}×</dd></div>
        <div className="rounded-lg bg-ink-800 p-2"><dt className="text-xs text-ink-500">Procedure steps ticked</dt><dd className="font-medium text-fg">{a.steps_done.length}/{d.worksheet.steps.length}</dd></div>
        <div className="rounded-lg bg-ink-800 p-2"><dt className="text-xs text-ink-500">Submitted</dt><dd className="font-medium text-fg">{a.submitted_at ? fmtDateTime(a.submitted_at) : '—'}</dd></div>
        <div className="rounded-lg bg-ink-800 p-2"><dt className="text-xs text-ink-500">Camera check flags</dt><dd className="font-medium text-fg">{a.proctor_flag_count}</dd></div>
      </dl>
      {!!a.videos?.length && (
        <div className="rounded-xl border border-line p-3" aria-label="Lab videos">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Lab videos (must be watched to the end before submitting)</h4>
          <ul className="space-y-1.5 text-sm">
            {a.videos.map((v) => {
              const pct = Math.round((v.progress?.coverage ?? 0) * 100)
              return (
                <li key={v.resource_id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-ink-100">{v.name ?? 'Video'}</span>
                  {v.progress?.completed
                    ? <Badge tone="ok"><CheckCircle2 className="h-3 w-3" /> Watched{v.progress.completed_at ? ` · ${fmtDateTime(v.progress.completed_at)}` : ''}</Badge>
                    : <><Progress value={pct} className="w-24" /><span className="w-24 text-xs text-ink-500">{v.progress ? `${pct}% watched` : 'Not started'}</span></>}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {fb?.overall && <p className="flex gap-2 rounded-xl border border-brand-400/30 bg-brand-500/5 p-3 text-sm text-ink-100"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />{fb.overall}</p>}
      <LabRecord worksheet={d.worksheet} work={a} result={a.result} />

      {submitted && (
        <div className="space-y-3 rounded-2xl border border-line p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div><Label htmlFor="vl-marks">Marks (out of {fmtMarks(d.max_marks)})</Label>
              <Input id="vl-marks" type="number" min={0} max={d.max_marks} step={0.5} className="w-36" value={marks} onChange={(e) => setMarks(e.target.value)} /></div>
            <p className="pb-2 text-xs text-ink-500">
              MCQs {fmtMarks(a.result.auto_score)}/{fmtMarks(a.result.auto_max)}
              {a.result.suggested_marks != null ? ` · AI suggests ${fmtMarks(a.result.suggested_marks)}` : fb?.engine?.startsWith('offline') ? ' · mark the short answers and the record yourself' : ''}
            </p>
            {fb?.overall && !feedback && <Button size="sm" variant="ghost" className="mb-1" onClick={() => setFeedback(fb.overall ?? '')}><Sparkles className="h-3.5 w-3.5" /> Use AI feedback</Button>}
          </div>
          <div><Label htmlFor="vl-feedback">Feedback to the student</Label>
            <Textarea id="vl-feedback" rows={3} maxLength={4000} value={feedback} onChange={(e) => setFeedback(e.target.value)} /></div>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" disabled={busy || !feedback.trim()} onClick={() => send(true)} title="Needs feedback saying what to redo"><RotateCcw className="h-4 w-4" /> Return for redo</Button>
            <Button disabled={busy || marks === ''} onClick={() => send(false)} id="save-lab-marks">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Save marks</Button>
          </div>
        </div>
      )}
    </div>
  )
}
