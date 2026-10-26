import { useEffect, useState } from 'react'
import { ArrowLeft, ScanText } from 'lucide-react'
import { ReportSkeleton, ReportView } from '@/components/evaluation/ReportView'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { errorMessage } from '@/services/apiClient'
import { evaluationService, type StudentEvalTest } from '@/services/evaluationService'
import { num, type EvalReport } from '@/types'

/** FR-EV-11: a student's published evaluations and the SL.No-wise report for each. */
export default function StudentEvaluations() {
  const [tests, setTests] = useState<StudentEvalTest[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [report, setReport] = useState<EvalReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { evaluationService.myTests().then(setTests).catch((e) => setError(errorMessage(e))) }, [])
  useEffect(() => {
    setReport(null)
    if (open) evaluationService.myReport(open).then(setReport).catch((e) => setError(errorMessage(e)))
  }, [open])

  if (open) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-8">
        <Button variant="ghost" onClick={() => setOpen(null)}><ArrowLeft className="h-4 w-4" /> All evaluations</Button>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        {report ? <ReportView report={report} /> : !error && <ReportSkeleton />}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <header className="animate-fade-up">
        <h1 className="font-display text-3xl font-bold">My <span className="text-gradient">evaluations</span></h1>
        <p className="mt-1 text-sm text-ink-300">AI-evaluated answer scripts published by your teachers — see marks, why you got them, what was missing and how to improve.</p>
      </header>
      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      {!tests ? !error && <div className="skeleton h-48" /> : tests.length === 0 ? (
        <Card className="p-10 text-center text-sm text-ink-300"><ScanText className="mx-auto mb-2 h-8 w-8 text-ink-500" />No evaluation results published yet.</Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {tests.map((t) => {
            const pct = num(t.percentage)
            const pass = pct >= num(t.pass_percentage)
            return (
              <button key={t.eval_test_id} onClick={() => setOpen(t.eval_test_id)} className="cursor-pointer text-left" id={`eval-${t.eval_test_id}`}>
                <Card className="h-full p-5 transition-all hover:-translate-y-0.5 hover:shadow-glow">
                  <div className="text-xs font-medium uppercase tracking-wide text-brand-600">{t.subject_name}</div>
                  <div className="mt-0.5 font-display text-lg font-semibold text-fg">{t.test_title}</div>
                  <div className="text-xs text-ink-500">{t.evaluation_scope === 'CHAPTER_LEVEL' ? t.chapter_title : 'Subject level'}{t.exam_date ? ` · ${new Date(`${t.exam_date}T00:00:00`).toLocaleDateString()}` : ''}</div>
                  <div className="mt-4 flex items-end justify-between">
                    <div className="font-display text-3xl font-bold tabular-nums text-fg">{num(t.total_obtained_marks)}<span className="text-base text-ink-500">/{num(t.total_max_marks)}</span></div>
                    <Badge tone={pass ? 'ok' : 'bad'}>{pct}% · Grade {t.grade}</Badge>
                  </div>
                  <Progress value={pct} tone={pass ? 'ok' : 'bad'} className="mt-3" />
                </Card>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
