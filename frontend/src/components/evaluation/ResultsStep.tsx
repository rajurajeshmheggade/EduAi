import { useCallback, useEffect, useState } from 'react'
import { AlertOctagon, Clock, Download, Eye, EyeOff, LifeBuoy, Loader2, PencilLine, Trophy, Users } from 'lucide-react'
import { BarList } from '@/components/evaluation/BarList'
import { ReportSkeleton, ReportView } from '@/components/evaluation/ReportView'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { StatCard } from '@/components/ui/stat'
import { errorMessage } from '@/services/apiClient'
import { downloadBlob } from '@/services/classroomService'
import { evaluationService } from '@/services/evaluationService'
import { cn } from '@/lib/utils'
import { num, type EvalDashboard, type EvalReport, type EvalTest, type RegisterRowEval, type ScoreRow, type SubmissionProgress } from '@/types'

/** FR-EV-12 teacher analytics + register + per-student reports (with mark moderation) + publish. */
export function ResultsStep({ test, onChanged, readOnly = false, org }: { test: EvalTest; onChanged: () => void; readOnly?: boolean; org?: string | null }) {
  const [dash, setDash] = useState<EvalDashboard | null>(null)
  const [rows, setRows] = useState<RegisterRowEval[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = test.eval_test_id

  const load = useCallback(async () => {
    try {
      const [d, r] = await Promise.all([evaluationService.dashboard(id, org),
        readOnly ? evaluationService.adminScores({ eval_test_id: id }, org).then((x) => ({ rows: x.rows ?? [] })) : evaluationService.register(id)])
      setDash(d); setRows(r.rows)
    } catch (e) { setError(errorMessage(e)) }
  }, [id, org, readOnly])
  useEffect(() => { void load() }, [load])

  async function togglePublish() {
    setBusy(true); setError(null)
    try { await evaluationService.publish(id, test.status !== 'PUBLISHED'); onChanged() } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  async function exportCsv() {
    const blob = readOnly ? await evaluationService.adminScoresCsv(id, org) : await evaluationService.registerCsv(id)
    downloadBlob(blob, `scores-${test.class_code}-${test.subject_code}-${test.test_title.replace(/\W+/g, '_')}.csv`)
  }

  if (error && !dash) return <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>
  if (!dash || !rows) return <div className="space-y-4"><div className="grid gap-4 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-28" />)}</div><div className="skeleton h-64" /></div>
  const o = dash.overview

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {test.status === 'PUBLISHED' ? <Badge tone="ok"><Eye className="h-3 w-3" /> Published to students</Badge> : <Badge><EyeOff className="h-3 w-3" /> Not visible to students yet</Badge>}
        {o.unmatched_scripts > 0 && <Badge tone="warn">{o.unmatched_scripts} unmatched script(s)</Badge>}
        {o.failed_scripts > 0 && <Badge tone="bad">{o.failed_scripts} failed</Badge>}
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4" /> Export CSV</Button>
          {!readOnly && (
            <Button onClick={togglePublish} disabled={busy || (test.status !== 'PUBLISHED' && !o.total_students_evaluated)} id="publish-results"
              variant={test.status === 'PUBLISHED' ? 'outline' : 'default'}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : test.status === 'PUBLISHED' ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {test.status === 'PUBLISHED' ? 'Unpublish' : 'Publish to students'}
            </Button>
          )}
        </div>
      </div>
      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      {test.assessment_type !== 'OFFLINE_EXAM' && <SubmissionCard p={dash.submission} />}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Overview">
        <StatCard label="Evaluated" value={`${o.total_students_evaluated}/${o.class_students}`} hint={`${o.scripts_uploaded} scripts uploaded`} />
        <StatCard label="Class average" value={o.class_average_percentage != null ? `${o.class_average_percentage}%` : '—'} tone="text-brand-600"
          hint={o.class_average_marks != null ? `${o.class_average_marks}/${o.total_max_marks} marks · median ${o.median_percentage}%` : undefined} />
        <StatCard label="Pass rate" value={o.pass_rate != null ? `${o.pass_rate}%` : '—'} tone={o.pass_rate != null && o.pass_rate < 60 ? 'text-bad' : 'text-ok'} hint={`${o.passed} passed · pass mark ${o.pass_percentage}%`} />
        <StatCard label="Highest / lowest" value={o.highest_marks != null ? `${num(o.highest_marks)} / ${num(o.lowest_marks)}` : '—'} hint={`out of ${o.total_max_marks}`} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <StudentList title="Top scoring students" icon={<Trophy className="h-4 w-4 text-warn" />} rows={dash.top_scoring_students} empty="No evaluated scripts yet." onOpen={setOpen} />
        <StudentList title={`Below pass mark (< ${o.pass_percentage}%)`} icon={<LifeBuoy className="h-4 w-4 text-bad" />} rows={dash.low_scoring_students}
          empty="Everyone evaluated is at or above the pass mark." onOpen={setOpen} showFeedback />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><AlertOctagon className="h-4 w-4 text-warn" /> Unanswered questions</CardTitle>
          <CardDescription>Questions skipped by everyone or by many students often point to a topic that needs re-teaching.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {dash.unanswered_by_all.length > 0 && (
            <p className="rounded-lg border border-bad/30 bg-bad/8 px-3 py-2 text-bad"><b>Not answered by any student:</b> SL.No {dash.unanswered_by_all.join(', ')}</p>
          )}
          {dash.most_skipped.length === 0 ? <p className="text-ok">Every question was attempted by every evaluated student.</p> : (
            <ul className="divide-y divide-line">{dash.most_skipped.map((q) => (
              <li key={q.sl_no} className="flex items-start gap-3 py-2">
                <span className="grid h-7 min-w-7 place-items-center rounded-md bg-ink-800 px-1.5 text-xs font-semibold text-fg">{q.sl_no}</span>
                <span className="flex-1 text-ink-100">{q.question_text}</span>
                <span className="whitespace-nowrap text-xs text-ink-500">{q.unanswered_count}/{q.total_candidates} skipped</span>
              </li>
            ))}</ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader><CardTitle className="text-base">SL.No-wise performance</CardTitle></CardHeader>
          <CardContent>
            <BarList caption="Average score per question, % of its maximum marks" valueHeader="Average"
              data={dash.question_analytics.map((q) => ({
                key: q.sl_no, label: `SL.No ${q.sl_no}`, value: q.avg_percentage,
                display: q.avg_percentage == null ? '—' : `${q.avg_percentage}%`,
                flag: q.not_answered_by_any_student ? 'Skipped by all' : undefined,
                tooltip: [`Avg ${q.avg_marks_scored ?? '—'} of ${q.max_marks} marks`, `Attempted by ${q.attempted_count}/${q.total_candidates} (${q.attempt_rate ?? 0}%)`,
                  `Full marks: ${q.full_marks_count} student(s)`],
              }))} />
            <div className="mt-5 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-widest text-ink-500">Most common missing points</div>
              {dash.question_analytics.filter((q) => q.common_missing_points.length).length === 0
                ? <p className="text-sm text-ink-300">No recurring gaps found.</p>
                : dash.question_analytics.filter((q) => q.common_missing_points.length).map((q) => (
                  <div key={q.sl_no} className="text-sm">
                    <div className="font-medium text-fg">SL.No {q.sl_no}</div>
                    <ul className="mt-0.5 space-y-0.5">{q.common_missing_points.map((p) => (
                      <li key={p.point} className="flex gap-2 text-ink-300"><span className="tabular-nums text-ink-500">{p.students}×</span><span className="first-letter:uppercase">{p.point}</span></li>
                    ))}</ul>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Score distribution</CardTitle></CardHeader>
          <CardContent>
            <BarList caption="Students per score band" valueHeader="Students" max={Math.max(1, ...dash.score_distribution.map((b) => b.students))}
              data={dash.score_distribution.map((b) => ({ key: b.range, label: b.range, value: b.students, display: String(b.students),
                tooltip: [`${b.students} student(s) scored ${b.range}`] }))} />
            {Object.keys(dash.grade_distribution).length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">{Object.entries(dash.grade_distribution).sort().map(([g, n]) => <Badge key={g}>Grade {g}: {n}</Badge>)}</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="min-w-0">
        <CardHeader><CardTitle className="text-base">All students</CardTitle>
          <CardDescription>{readOnly ? 'Open a row for the SL.No-wise report.' : 'Click “Edit marks” to change any question’s marks — the total, rank and student report update immediately.'}
            {!readOnly && test.status === 'PUBLISHED' && ' Results are published, so students see your changes right away.'}</CardDescription></CardHeader>
        <CardContent><RegisterTable rows={rows} onOpen={setOpen} editable={!readOnly} /></CardContent>
      </Card>

      {open && <ReportDialog test={test} scriptId={open} readOnly={readOnly} org={org}
        onClose={() => setOpen(null)} onChanged={() => { void load(); onChanged() }} />}
    </div>
  )
}

function SubmissionCard({ p }: { p: SubmissionProgress }) {
  const pct = p.enrolled ? Math.round((100 * p.submitted) / p.enrolled) : 0
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4 text-brand-600" /> Submission progress</CardTitle>
        {p.due_at && <span className="flex items-center gap-1 text-xs text-ink-500"><Clock className="h-3.5 w-3.5" /> Due {new Date(p.due_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
          <span><b className="font-display text-2xl text-fg">{p.submitted}</b><span className="text-ink-500">/{p.enrolled} submitted</span></span>
          {p.in_progress > 0 && <span className="text-brand-600">{p.in_progress} taking it now</span>}
          {p.evaluating > 0 && <span className="text-warn">{p.evaluating} being evaluated</span>}
          {p.late > 0 && <span className="text-warn">{p.late} late</span>}
          <span className={p.not_submitted ? 'text-bad' : 'text-ok'}>{p.not_submitted} not submitted</span>
        </div>
        <Progress value={pct} tone="ok" />
        {p.not_submitted_students.length > 0 && (
          <p className="text-xs text-ink-300"><b className="text-ink-100">Pending:</b> {p.not_submitted_students.map((s) => `${s.roll_number ? `${s.roll_number}. ` : ''}${s.full_name}`).join(', ')}</p>
        )}
      </CardContent>
    </Card>
  )
}

function StudentList({ title, icon, rows, empty, onOpen, showFeedback }: { title: string; icon: React.ReactNode; rows: ScoreRow[]; empty: string; onOpen: (id: string) => void; showFeedback?: boolean }) {
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base">{icon} {title}</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? <p className="text-sm text-ink-300">{empty}</p> : (
          <ol className="divide-y divide-line">{rows.map((r, i) => (
            <li key={r.script_id}>
              <button onClick={() => onOpen(r.script_id)} className="flex w-full cursor-pointer items-start gap-3 py-2 text-left hover:bg-ink-800/60">
                <span className="w-5 text-right text-xs tabular-nums text-ink-500">{i + 1}</span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-fg">{r.student_name ?? r.uploaded_pdf_filename}</span>
                  {showFeedback && r.overall_ai_feedback && <span className="line-clamp-2 block text-xs text-ink-500">{r.overall_ai_feedback}</span>}</span>
                <span className="text-right text-sm tabular-nums"><b className="text-fg">{num(r.total_obtained_marks)}</b><span className="text-ink-500">/{num(r.total_max_marks)}</span>
                  <span className="block text-xs text-ink-500">{num(r.percentage)}%{r.grade ? ` · ${r.grade}` : ''}</span></span>
              </button>
            </li>
          ))}</ol>
        )}
      </CardContent>
    </Card>
  )
}

export function RegisterTable({ rows, onOpen, editable = false }: { rows: RegisterRowEval[]; onOpen?: (scriptId: string) => void; editable?: boolean }) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-ink-300">No scripts yet.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-500">
          <th className="py-2 pr-2 font-medium">Rank</th><th className="py-2 pr-3 font-medium">Roll</th><th className="py-2 pr-3 font-medium">Student</th>
          <th className="py-2 pr-3 text-right font-medium">Attempted</th><th className="py-2 pr-3 text-right font-medium">Unanswered</th>
          <th className="py-2 pr-3 text-right font-medium">Marks</th><th className="py-2 pr-3 text-right font-medium">%</th><th className="py-2 pr-3 font-medium">Grade</th><th className="py-2 pr-3 font-medium">Status</th>{editable && <th />}
        </tr></thead>
        <tbody>{rows.map((r) => {
          const done = r.processing_status === 'EVALUATED' || r.processing_status === 'REVIEWED'
          const label = r.processing_status === 'NOT_SUBMITTED' ? 'not submitted' : r.processing_status === 'IN_PROGRESS' ? 'taking test' : r.processing_status.toLowerCase().replace(/_/g, ' ')
          return (
            <tr key={r.script_id} onClick={() => done && onOpen?.(r.script_id)} className={cn('border-b border-line last:border-0', done && onOpen && 'cursor-pointer hover:bg-ink-800/60')}>
              <td className="py-2 pr-2 tabular-nums text-ink-500">{r.rank_no ?? '—'}</td>
              <td className="py-2 pr-3 tabular-nums">{r.roll_number ?? '—'}</td>
              <td className="py-2 pr-3"><div className="font-medium text-fg">{r.student_name ?? '(unmatched)'}</div>
                <div className="text-xs text-ink-500">{r.uploaded_pdf_filename ?? (r.submission_mode === 'ONLINE_TEST_UI' ? 'Online test' : '')}{r.is_late && <span className="ml-1 font-semibold text-warn">LATE</span>}</div></td>
              <td className="py-2 pr-3 text-right tabular-nums">{done ? r.attempted_questions : '—'}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{done ? r.unanswered_questions : '—'}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{done ? `${num(r.obtained_marks)}/${num(r.max_marks)}` : '—'}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{done ? `${num(r.percentage)}%` : '—'}</td>
              <td className="py-2 pr-3">{r.grade ? <Badge tone={r.result === 'Fail' ? 'bad' : 'ok'}>{r.grade}</Badge> : '—'}</td>
              <td className={cn('py-2 pr-3 text-xs', r.processing_status === 'NOT_SUBMITTED' ? 'text-bad' : 'text-ink-500')}>{label}{r.processing_status === 'REVIEWED' && ' · edited'}</td>
              {editable && <td className="py-2 text-right">{done && <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); onOpen?.(r.script_id) }}
                aria-label={`Edit marks for ${r.student_name ?? r.uploaded_pdf_filename}`}><PencilLine className="h-3.5 w-3.5" /> Edit marks</Button>}</td>}
            </tr>
          )
        })}</tbody>
      </table>
    </div>
  )
}

function ReportDialog({ test, scriptId, readOnly, org, onClose, onChanged }: { test: EvalTest; scriptId: string; readOnly: boolean; org?: string | null; onClose: () => void; onChanged: () => void }) {
  const [rep, setRep] = useState<EvalReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { evaluationService.report(test.eval_test_id, scriptId, org).then(setRep).catch((e) => setError(errorMessage(e))) }, [test.eval_test_id, scriptId, org])

  return (
    <Dialog open onClose={onClose} title={rep?.summary.student_name ?? 'Evaluation report'} description={test.test_title} className="w-[min(56rem,calc(100vw-2rem))]">
      <div className="max-h-[75vh] overflow-y-auto pr-1">
        {error ? <p className="text-sm text-bad">{error}</p> : !rep ? <ReportSkeleton /> : (
          <ReportView report={rep} onOverride={readOnly ? undefined : async (r, marks, comment, reset) => {
            try {
              setRep(await evaluationService.override(test.eval_test_id, r.slno_result_id,
                reset ? { awarded_marks: 0, reset_to_ai: true } : { awarded_marks: marks, teacher_comment: comment || undefined }))
              onChanged()
            } catch (e) { throw new Error(errorMessage(e)) }
          }} />
        )}
      </div>
    </Dialog>
  )
}
