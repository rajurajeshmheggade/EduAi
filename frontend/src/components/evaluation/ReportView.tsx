import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Lightbulb, Loader2, Medal, PencilLine, Save, UserCheck, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/field'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { num, type EvalReport, type SlnoResult } from '@/types'

const fmt = (n: number) => String(Math.round(n * 100) / 100)
const pctTone = (p: number, pass: boolean | null) => (pass === false ? 'text-bad' : p >= 75 ? 'text-ok' : p >= 50 ? 'text-brand-600' : 'text-warn')

/** FR-EV-11 report: summary header + SL.No-wise cards. Pass `onOverride` to let a teacher moderate marks. */
export function ReportView({ report, onOverride, showModelAnswer = true }: {
  report: EvalReport
  onOverride?: (r: SlnoResult, marks: number, comment: string, resetToAi?: boolean) => Promise<void>
  showModelAnswer?: boolean
}) {
  const s = report.summary
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start gap-5">
          <div className="min-w-48 flex-1">
            <div className="text-xs font-medium uppercase tracking-wide text-ink-500">{s.evaluation_scope === 'CHAPTER_LEVEL' ? `Chapter · ${s.chapter_title}` : 'Subject level'} · {s.subject_code}</div>
            <div className="mt-0.5 font-display text-xl font-semibold">{s.test_title}</div>
            <div className="text-sm text-ink-300">{s.student_name ?? 'Unmatched script'}{s.roll_number ? ` · Roll ${s.roll_number}` : ''}{s.exam_date ? ` · ${new Date(`${s.exam_date}T00:00:00`).toLocaleDateString()}` : ''}</div>
          </div>
          <div className="text-right">
            <div className={cn('font-display text-4xl font-bold tabular-nums', pctTone(s.percentage, s.passed))}>{s.total_obtained_marks}<span className="text-xl text-ink-500">/{s.total_max_marks}</span></div>
            <div className="text-sm text-ink-300">{s.percentage}%{s.grade && <> · Grade <b className="text-fg">{s.grade}</b></>}</div>
          </div>
        </div>
        <Progress value={s.percentage} tone={s.passed === false ? 'bad' : 'ok'} className="mt-4" />
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          {s.rank != null && <Badge tone="brand"><Medal className="h-3 w-3" /> Rank {s.rank} of {s.out_of}</Badge>}
          {s.percentile != null && <Badge>Percentile {s.percentile}</Badge>}
          <Badge tone="ok"><CheckCircle2 className="h-3 w-3" /> {s.attempted_questions_count} attempted</Badge>
          {s.unanswered_questions_count > 0 && <Badge tone="warn"><XCircle className="h-3 w-3" /> {s.unanswered_questions_count} not attempted</Badge>}
          {s.passed != null && <Badge tone={s.passed ? 'ok' : 'bad'}>{s.passed ? 'Pass' : 'Below pass mark'}</Badge>}
          {s.processing_status === 'REVIEWED' && <Badge tone="aqua"><UserCheck className="h-3 w-3" /> Teacher reviewed</Badge>}
          {s.is_late && <Badge tone="warn">Submitted late</Badge>}
          {s.script_url && <a href={s.script_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline"><FileText className="h-3 w-3" /> Answer script ({s.page_count} pages) <ExternalLink className="h-3 w-3" /></a>}
        </div>
        {s.overall_ai_feedback && <p className="mt-4 rounded-xl bg-ink-800 p-3 text-sm text-ink-100"><b className="text-fg">Overall feedback: </b>{s.overall_ai_feedback}</p>}
        {s.error && <p role="alert" className="mt-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{s.error}</p>}
      </Card>

      {report.slno_wise_report.map((r) => <SlnoCard key={r.slno_result_id} r={r} onOverride={onOverride} showModelAnswer={showModelAnswer}
        typedLabel={s.submission_mode === 'ONLINE_TEST_UI' ? 'Your answer' : 'Selected'} />)}
    </div>
  )
}

function SlnoCard({ r, onOverride, showModelAnswer, typedLabel }: {
  r: SlnoResult; onOverride?: (r: SlnoResult, marks: number, comment: string, resetToAi?: boolean) => Promise<void>; showModelAnswer: boolean; typedLabel: string
}) {
  const [editing, setEditing] = useState(false)
  const [marks, setMarks] = useState(String(num(r.awarded_marks)))
  const [comment, setComment] = useState(r.teacher_comment ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const awarded = num(r.awarded_marks), max = num(r.max_marks)
  const ratio = max ? awarded / max : 0

  async function save(reset = false) {
    if (!onOverride) return
    setBusy(true); setErr(null)
    try { await onOverride(r, Number(marks), comment, reset); setEditing(false) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start gap-3 border-b border-line bg-ink-800 px-5 py-3">
        <span className="grid h-8 min-w-8 place-items-center rounded-lg bg-brand-500 px-2 text-sm font-semibold text-white">{r.sl_no}</span>
        <p className="min-w-0 flex-1 text-sm font-medium text-fg">{r.question_text}</p>
        <div className="text-right">
          <div className={cn('font-display text-lg font-bold tabular-nums', !r.is_attempted && !r.teacher_override ? 'text-ink-500' : ratio >= 0.75 ? 'text-ok' : ratio >= 0.4 ? 'text-warn' : 'text-bad')}>{fmt(awarded)}/{fmt(max)}</div>
          {r.teacher_override && <div className="text-[11px] text-ink-500">Edited by teacher · AI gave {fmt(num(r.ai_awarded_marks))}</div>}
        </div>
      </div>
      <div className="space-y-3 p-5 text-sm">
        {r.question_type === 'MCQ' && r.mcq_options.length > 0 ? (
          <ul className="space-y-1" aria-label="Options">
            {r.mcq_options.map((o) => {
              const k = o.slice(1, 2).toLowerCase()
              const chosen = (r.student_ocr_text ?? '').trim().toLowerCase() === k
              const correct = r.correct_option === k
              return (
                <li key={o} className={cn('flex items-center gap-2 rounded-lg border px-3 py-1.5',
                  correct ? 'border-ok/40 bg-ok/8' : chosen ? 'border-bad/40 bg-bad/8' : 'border-line')}>
                  <span className="flex-1 text-ink-100">{o}</span>
                  {chosen && <Badge tone={correct ? 'ok' : 'bad'}>{typedLabel}</Badge>}
                  {correct && <CheckCircle2 className="h-4 w-4 text-ok" aria-label="Correct option" />}
                </li>
              )
            })}
            {!r.is_attempted && <li className="text-xs text-ink-500">Not attempted</li>}
          </ul>
        ) : (
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-ink-500">{typedLabel === 'Your answer' ? 'Your answer' : 'Extracted answer'} {r.page_numbers.length > 0 && `· page ${r.page_numbers.join(', ')}`}</div>
            {r.is_attempted
              ? <p className="whitespace-pre-wrap rounded-lg border border-line bg-ink-900 p-3 font-mono text-[13px] leading-relaxed text-ink-100">{r.student_ocr_text}</p>
              : <p className="rounded-lg border border-dashed border-line p-3 text-ink-500">Not attempted</p>}
          </div>
        )}
        <div className="rounded-lg border border-ok/25 bg-ok/8 p-3">
          <div className="mb-0.5 flex items-center gap-1.5 text-xs font-semibold text-ok"><CheckCircle2 className="h-3.5 w-3.5" /> Why these marks</div>
          {r.teacher_override && (
            <p className="mb-1 font-medium text-fg">Teacher set {fmt(awarded)}/{fmt(max)} (AI gave {fmt(num(r.ai_awarded_marks))}).{r.teacher_comment ? ` “${r.teacher_comment}”` : ''}</p>
          )}
          <p className={r.teacher_override ? 'text-ink-300' : 'text-ink-100'}>{r.teacher_override ? `AI: ${r.why_marks_given}` : r.why_marks_given}</p>
        </div>
        {r.missing_points.length > 0 && (
          <div className="rounded-lg border border-warn/30 bg-warn/8 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-warn"><AlertTriangle className="h-3.5 w-3.5" /> Missing points</div>
            <ul className="list-disc space-y-0.5 pl-5 text-ink-100">{r.missing_points.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </div>
        )}
        <div className="rounded-lg border border-brand-400/25 bg-brand-500/6 p-3">
          <div className="mb-0.5 flex items-center gap-1.5 text-xs font-semibold text-brand-600"><Lightbulb className="h-3.5 w-3.5" /> Feedback</div>
          <p className="text-ink-100">{r.feedback}</p>
          {r.teacher_comment && <p className="mt-1.5 text-ink-300"><b>Teacher:</b> {r.teacher_comment}</p>}
        </div>
        {showModelAnswer && r.question_type !== 'MCQ' && (
          <details className="rounded-lg border border-line p-3 text-ink-300">
            <summary className="cursor-pointer text-xs font-semibold text-ink-500">Model answer</summary>
            <p className="mt-2 whitespace-pre-wrap">{r.model_answer_text}</p>
          </details>
        )}
        {onOverride && (editing ? (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line p-3">
            <label className="text-xs text-ink-500">Marks (0–{fmt(max)})
              <Input type="number" min={0} max={max} step={0.25} value={marks} onChange={(e) => setMarks(e.target.value)} className="mt-1 h-9 w-24" />
            </label>
            <Input aria-label="Teacher comment" placeholder="Comment for the student (optional)" value={comment} onChange={(e) => setComment(e.target.value)} className="h-9 min-w-48 flex-1" maxLength={2000} />
            <Button size="sm" className="h-9" onClick={() => save()} disabled={busy || marks === '' || Number(marks) < 0 || Number(marks) > max} id={`save-marks-${r.sl_no}`}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save</Button>
            <Button size="sm" variant="ghost" className="h-9" onClick={() => setEditing(false)}>Cancel</Button>
            {err && <p className="w-full text-xs text-bad">{err}</p>}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => { setMarks(String(num(r.awarded_marks))); setEditing(true) }} id={`edit-marks-${r.sl_no}`}>
              <PencilLine className="h-3.5 w-3.5" /> Edit marks
            </Button>
            {r.teacher_override && <Button size="sm" variant="ghost" disabled={busy} onClick={() => save(true)}>Reset to AI marks ({fmt(num(r.ai_awarded_marks))})</Button>}
          </div>
        ))}
      </div>
    </Card>
  )
}

export function ReportSkeleton() {
  return <div className="space-y-4"><div className="skeleton h-40" /><div className="skeleton h-56" /><div className="skeleton h-56" /></div>
}

