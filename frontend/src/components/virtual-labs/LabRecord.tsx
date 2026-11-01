import { CheckCircle2, CircleX, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { fmtMarks } from '@/lib/virtualLabs'
import { cn } from '@/lib/utils'
import type { LabResult, LabWork, Worksheet } from '@/services/virtualLabService'

/** A submitted lab record: observations, conclusion and every answer with its marks and (AI) feedback. */
export function LabRecord({ worksheet, work, result }: { worksheet: Worksheet; work: LabWork; result: LabResult | null }) {
  const fb = result?.feedback
  const mcq = new Map((fb?.mcq ?? []).map((m) => [m.id, m]))
  const short = new Map((fb?.questions ?? []).map((m) => [m.id, m]))
  const rows = work.observations.filter((r) => r.some((c) => c.trim()))
  return (
    <div className="space-y-5 text-sm">
      {worksheet.observation_columns.length > 0 && (
        <section aria-labelledby="rec-obs">
          <h4 id="rec-obs" className="mb-2 font-semibold text-fg">Observations</h4>
          {rows.length === 0 ? <p className="text-ink-500">No observations recorded.</p> : (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-left text-sm">
                <thead className="bg-ink-800 text-xs text-ink-300"><tr>{worksheet.observation_columns.map((c) => <th key={c} className="px-3 py-2 font-medium">{c}</th>)}</tr></thead>
                <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-line">{worksheet.observation_columns.map((_, j) => <td key={j} className="px-3 py-2 text-ink-100">{r[j] || '—'}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
        </section>
      )}
      <section aria-labelledby="rec-conc">
        <h4 id="rec-conc" className="mb-1 font-semibold text-fg">{worksheet.conclusion_prompt || 'Conclusion'}</h4>
        <p className="whitespace-pre-line text-ink-100">{work.conclusion || <span className="text-ink-500">No conclusion written.</span>}</p>
        {fb?.record && (
          <p className="mt-2 flex gap-1.5 rounded-lg bg-brand-500/5 p-2 text-xs text-ink-300">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />
            <span><b className="text-fg">Lab record {fmtMarks(fb.record.marks)}/{fmtMarks(fb.record.max)}.</b> {fb.record.feedback}</span>
          </p>
        )}
      </section>
      {worksheet.questions.length > 0 && (
        <section aria-labelledby="rec-q">
          <h4 id="rec-q" className="mb-2 font-semibold text-fg">Viva questions</h4>
          <ol className="space-y-3">
            {worksheet.questions.map((q, i) => {
              const given = work.answers[q.id]
              const m = q.type === 'mcq' ? mcq.get(q.id) : short.get(q.id)
              return (
                <li key={q.id} className="rounded-xl border border-line p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-fg"><span className="text-ink-500">Q{i + 1}.</span> {q.prompt}</p>
                    {m ? <Badge tone={m.marks >= m.max ? 'ok' : m.marks > 0 ? 'warn' : 'bad'}>{fmtMarks(m.marks)}/{fmtMarks(m.max)}</Badge>
                      : <Badge>{fmtMarks(q.marks)} mark{q.marks === 1 ? '' : 's'}</Badge>}
                  </div>
                  {q.type === 'mcq' ? (
                    <ul className="mt-2 space-y-1">
                      {q.options.map((o, k) => {
                        const chosen = given === k
                        const right = q.answer === k
                        return (
                          <li key={k} className={cn('flex items-center gap-2 rounded-lg px-2 py-1', right && 'bg-ok/10', chosen && !right && 'bg-bad/10')}>
                            {right ? <CheckCircle2 className="h-4 w-4 text-ok" aria-label="Correct answer" /> : chosen ? <CircleX className="h-4 w-4 text-bad" aria-label="Wrong answer" /> : <span className="w-4" />}
                            <span className={cn(chosen ? 'font-medium text-fg' : 'text-ink-300')}>{o}</span>
                            {chosen && <span className="text-xs text-ink-500">(answer given)</span>}
                          </li>
                        )
                      })}
                      {given === undefined && <li className="text-xs text-ink-500">Not answered.</li>}
                      {q.explanation && <li className="pt-1 text-xs text-ink-300">{q.explanation}</li>}
                    </ul>
                  ) : (
                    <div className="mt-2 space-y-1.5">
                      <p className="whitespace-pre-line rounded-lg bg-ink-800 p-2 text-ink-100">{typeof given === 'string' && given.trim() ? given : <span className="text-ink-500">Not answered.</span>}</p>
                      {q.model_answer && <p className="text-xs text-ink-300"><b className="text-ink-100">Model answer:</b> {q.model_answer}</p>}
                      {m && 'feedback' in m && m.feedback && (
                        <p className="flex gap-1.5 text-xs text-ink-300"><Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />{m.feedback}</p>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      )}
    </div>
  )
}
