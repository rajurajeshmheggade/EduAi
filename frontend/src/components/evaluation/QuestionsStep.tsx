import { useState } from 'react'
import { AlertTriangle, FileQuestion, FileText, Loader2, Plus, Save, ScrollText, Sparkles, Trash2, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Select, Textarea } from '@/components/ui/field'
import { errorMessage } from '@/services/apiClient'
import { evaluationService } from '@/services/evaluationService'
import { num, type EvalTest, type MasterDraft, type MasterQuestion, type QuestionType } from '@/types'
import axios from 'axios'

const ACCEPT = '.pdf,.docx,.md,.txt'
const TYPE_LABEL: Record<QuestionType, string> = { MCQ: 'MCQ', SHORT_ANSWER: 'Short answer', DESCRIPTIVE: 'Descriptive', NUMERICAL: 'Numerical' }
const letter = (o: string, i: number) => (/^\(([a-h])\)/i.exec(o)?.[1] ?? 'abcdefgh'[i]).toLowerCase()
const optionText = (o: string) => o.replace(/^\([a-h]\)\s*/i, '')

/** FR-EV-02/03/04: question paper + SL.No model answers -> editable preview -> save (embeddings generated). */
export function QuestionsStep({ test, masters, onSaved }: { test: EvalTest; masters: MasterQuestion[]; onSaved: () => void }) {
  const [qp, setQp] = useState<File | null>(null)
  const [ans, setAns] = useState<File | null>(null)
  const [draft, setDraft] = useState<MasterDraft[] | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [parser, setParser] = useState<'ai' | 'rules' | null>(null)
  const [busy, setBusy] = useState<'parse' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const locked = test.status === 'PROCESSING' || test.status === 'PUBLISHED'

  async function parse() {
    if (!qp || !ans) return
    setBusy('parse'); setError(null)
    try {
      const r = await evaluationService.parseMasters(test.eval_test_id, qp, ans)
      setDraft(r.items.length ? r.items : [{ sl_no: '1', question_type: 'DESCRIPTIVE', mcq_options: [], correct_option: null, question_text: '', max_marks: null, model_answer_text: '', key_rubric_points: [] }])
      setWarnings(r.warnings); setParser(r.parser)
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(null) }
  }

  async function save() {
    if (!draft) return
    setBusy('save'); setError(null)
    const clean = draft.map((d) => ({ ...d, key_rubric_points: d.key_rubric_points.filter((p) => p.trim()),
      mcq_options: d.question_type === 'MCQ' ? d.mcq_options.filter((o) => o.trim()) : [] }))
    try {
      await evaluationService.saveMasters(test.eval_test_id, clean)
      setDraft(null); onSaved()
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 409 && String((e.response.data as { detail?: string })?.detail).includes('reset_evaluations')
          && confirm(`${errorMessage(e)}\n\nSave the new questions and clear those results?`)) {
        try { await evaluationService.saveMasters(test.eval_test_id, clean, true); setDraft(null); onSaved() } catch (e2) { setError(errorMessage(e2)) }
      } else setError(errorMessage(e))
    } finally { setBusy(null) }
  }

  const edit = (i: number, patch: Partial<MasterDraft>) => setDraft((d) => d!.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const invalid = draft?.some((d) => !d.sl_no.trim() || !d.question_text.trim() || !d.max_marks || d.max_marks <= 0 ||
    (d.question_type === 'MCQ' ? d.mcq_options.filter((o) => o.trim()).length < 2 || !d.correct_option : !d.model_answer_text.trim()))
  const total = draft?.reduce((a, d) => a + (d.max_marks || 0), 0) ?? 0

  return (
    <div className="space-y-5">
      {!draft && masters.length > 0 && (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><ScrollText className="h-5 w-5 text-brand-600" /> {masters.length} questions · {num(test.total_max_marks)} marks</CardTitle>
              <CardDescription className="flex flex-wrap gap-3">
                {test.question_paper_url && <a className="inline-flex items-center gap-1 text-brand-600 hover:underline" href={test.question_paper_url} target="_blank" rel="noreferrer"><FileText className="h-3 w-3" />{test.question_paper_name}</a>}
                {test.model_answer_url && <a className="inline-flex items-center gap-1 text-brand-600 hover:underline" href={test.model_answer_url} target="_blank" rel="noreferrer"><FileText className="h-3 w-3" />{test.model_answer_name}</a>}
              </CardDescription>
            </div>
            {!locked && <Button variant="secondary" onClick={() => setDraft(masters.map((m) => ({ sl_no: m.sl_no, question_type: m.question_type, mcq_options: m.mcq_options, correct_option: m.correct_option, question_text: m.question_text, max_marks: num(m.max_marks), model_answer_text: m.model_answer_text, key_rubric_points: m.key_rubric_points })))}>Edit questions</Button>}
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-500"><th className="py-2 pr-3 font-medium">SL.No</th><th className="py-2 pr-3 font-medium">Question</th><th className="py-2 pr-3 text-right font-medium">Marks</th><th className="py-2 font-medium">Model answer & rubric</th></tr></thead>
                <tbody>{masters.map((m) => (
                  <tr key={m.master_q_id} className="border-b border-line align-top last:border-0">
                    <td className="py-2.5 pr-3 font-semibold text-fg">{m.sl_no}</td>
                    <td className="py-2.5 pr-3 text-ink-100">
                      <Badge className="mb-1">{TYPE_LABEL[m.question_type]}</Badge><div>{m.question_text}</div>
                      {m.question_type === 'MCQ' && <ul className="mt-1 space-y-0.5 text-xs">{m.mcq_options.map((o, i) => (
                        <li key={o} className={letter(o, i) === m.correct_option ? 'font-semibold text-ok' : 'text-ink-300'}>{o}{letter(o, i) === m.correct_option && ' ✓'}</li>
                      ))}</ul>}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{num(m.max_marks)}</td>
                    <td className="py-2.5 text-ink-300"><p className="line-clamp-3">{m.model_answer_text}</p>
                      {m.key_rubric_points.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{m.key_rubric_points.map((p) => <Badge key={p} className="!whitespace-normal">{p}</Badge>)}</div>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {!draft && !locked && (
        <Card>
          <CardHeader><CardTitle>{masters.length ? 'Replace from new files' : 'Upload question paper & model answers'}</CardTitle>
            <CardDescription>Number questions as SL.No 1, Q1 or 1. with marks like “(5 marks)”; give answers per SL.No with step marks like “(2M)”. PDF, DOCX, Markdown or text.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <FilePick id="qp-file" icon={FileQuestion} label="1 · Question paper (SL.No-wise)" file={qp} onPick={setQp} />
              <FilePick id="ans-file" icon={ScrollText} label="2 · SL.No-wise model answers & marking scheme" file={ans} onPick={setAns} />
            </div>
            {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
            <Button onClick={parse} disabled={!qp || !ans || busy === 'parse'} id="parse-masters">
              {busy === 'parse' ? <><Loader2 className="h-4 w-4 animate-spin" /> Reading documents…</> : <><Sparkles className="h-4 w-4" /> Read & preview SL.Nos</>}
            </Button>
          </CardContent>
        </Card>
      )}

      {draft && (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Review SL.No table</CardTitle>
              <CardDescription>{draft.length} questions · {total} marks{parser && ` · parsed by ${parser === 'ai' ? 'AI' : 'rules'}`}. Edit anything before saving — the AI grades against exactly this.</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
              <Button onClick={save} disabled={!!invalid || busy === 'save'} id="save-masters">{busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save questions</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {warnings.length > 0 && (
              <div className="rounded-lg border border-warn/30 bg-warn/10 p-3 text-sm text-warn">
                {warnings.map((w) => <div key={w} className="flex gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{w}</div>)}
              </div>
            )}
            {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
            {draft.map((d, i) => (
              <div key={i} className="grid gap-2 rounded-xl border border-line p-3 md:grid-cols-[5rem_1fr_6rem_auto]">
                <div className="space-y-2">
                  <Input aria-label={`SL.No ${i + 1}`} value={d.sl_no} onChange={(e) => edit(i, { sl_no: e.target.value })} className="font-semibold" maxLength={32} />
                  <Select aria-label={`Question type ${d.sl_no}`} className="h-9 px-2 text-xs" value={d.question_type}
                    onChange={(e) => edit(i, { question_type: e.target.value as QuestionType, ...(e.target.value === 'MCQ' && !d.mcq_options.length ? { mcq_options: ['', '', '', ''] } : {}) })}>
                    {(Object.keys(TYPE_LABEL) as QuestionType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                  </Select>
                </div>
                <Textarea aria-label={`Question ${d.sl_no}`} rows={2} value={d.question_text} onChange={(e) => edit(i, { question_text: e.target.value })} placeholder="Question text" />
                <Input aria-label={`Max marks ${d.sl_no}`} type="number" min={0.25} step={0.25} value={d.max_marks ?? ''} placeholder="Marks"
                  onChange={(e) => edit(i, { max_marks: e.target.value ? Number(e.target.value) : null })} className={!d.max_marks ? 'border-warn' : ''} />
                <Button variant="ghost" size="icon" aria-label={`Remove SL.No ${d.sl_no}`} onClick={() => setDraft((x) => x!.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                {d.question_type === 'MCQ' && (
                  <div className="space-y-1.5 md:col-span-2 md:col-start-2">
                    {d.mcq_options.map((o, k) => (
                      <div key={k} className="flex items-center gap-2">
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-500" title="Correct option">
                          <input type="radio" name={`correct-${i}`} checked={d.correct_option === 'abcdefgh'[k]} onChange={() => edit(i, { correct_option: 'abcdefgh'[k] })} className="accent-[var(--color-ok)]" />
                          ({'abcdefgh'[k]})
                        </label>
                        <Input aria-label={`Option ${'abcdefgh'[k]} for SL.No ${d.sl_no}`} className="h-9" value={optionText(o)} placeholder={`Option ${'abcdefgh'[k].toUpperCase()}`}
                          onChange={(e) => edit(i, { mcq_options: d.mcq_options.map((x, j) => (j === k ? `(${'abcdefgh'[k]}) ${e.target.value}` : x)) })} />
                      </div>
                    ))}
                    <div className="flex gap-2 text-xs">
                      {d.mcq_options.length < 8 && <button type="button" className="cursor-pointer text-brand-600 hover:underline" onClick={() => edit(i, { mcq_options: [...d.mcq_options, ''] })}>+ option</button>}
                      {d.mcq_options.length > 2 && <button type="button" className="cursor-pointer text-ink-500 hover:underline" onClick={() => edit(i, { mcq_options: d.mcq_options.slice(0, -1) })}>− option</button>}
                      {!d.correct_option && <span className="text-warn">Select the correct option</span>}
                    </div>
                  </div>
                )}
                <Textarea aria-label={`Model answer ${d.sl_no}`} rows={d.question_type === 'MCQ' ? 2 : 3} className="md:col-span-2 md:col-start-2" value={d.model_answer_text} onChange={(e) => edit(i, { model_answer_text: e.target.value })}
                  placeholder={d.question_type === 'MCQ' ? 'Explanation shown to students after the test (optional)' : 'Model answer with step marks, e.g. Mirror formula 1/v + 1/u = 1/f (1M) …'} />
                {d.question_type !== 'MCQ' && (
                  <Textarea aria-label={`Rubric points ${d.sl_no}`} rows={3} className="md:col-span-2 md:col-start-2 text-xs" value={d.key_rubric_points.join('\n')}
                    onChange={(e) => edit(i, { key_rubric_points: e.target.value.split('\n') })} placeholder="Rubric points — one per line (optional)" />
                )}
              </div>
            ))}
            <Button variant="secondary" size="sm" onClick={() => setDraft((x) => [...x!, { sl_no: String(x!.length + 1), question_type: 'DESCRIPTIVE', mcq_options: [], correct_option: null, question_text: '', max_marks: null, model_answer_text: '', key_rubric_points: [] }])}><Plus className="h-3.5 w-3.5" /> Add SL.No</Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function FilePick({ id, icon: Icon, label, file, onPick }: { id: string; icon: typeof FileText; label: string; file: File | null; onPick: (f: File | null) => void }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-line-strong bg-ink-800/60 p-4 transition-colors hover:border-brand-400/60">
      <Icon className="h-8 w-8 shrink-0 text-brand-600" />
      <div className="min-w-0">
        <div className="text-sm font-medium text-fg">{label}</div>
        <div className="truncate text-xs text-ink-500">{file ? file.name : <span className="inline-flex items-center gap-1"><Upload className="h-3 w-3" /> PDF, DOCX, MD or TXT</span>}</div>
      </div>
      <input id={id} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
    </label>
  )
}
