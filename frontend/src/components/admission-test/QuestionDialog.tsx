import { useState, type FormEvent } from 'react'
import { Circle, CircleCheck, Plus, Square, SquareCheck, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label, Select, Textarea } from '@/components/ui/field'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/services/apiClient'
import { QTYPE_LABEL, type AdmQType, type AdmQuestion, type AdmSection, type HqDimension, type QuestionInput } from '@/services/admissionTestService'

const HQ_TYPES: AdmQType[] = ['SJT', 'REFLECTIVE', 'IDEAS']
const ACADEMIC_TYPES: AdmQType[] = ['MCQ', 'MULTI', 'NUMERICAL', 'SHORT', 'DESCRIPTIVE']
const POINTS = [{ v: 2, label: 'Best' }, { v: 1, label: 'Acceptable' }, { v: 0, label: 'Poor' }]

function blank(section: AdmSection): QuestionInput {
  const hq = section.kind === 'HQ'
  return { section: section.key, qtype: hq ? 'SJT' : 'MCQ', prompt: '', options: hq ? ['', '', '', ''] : ['', '', '', ''],
    answer_key: hq ? { points: [2, 1, 0, 0] } : { option: 0 }, rubric: [], model_answer: '', marks: hq ? 2 : 1, topic: '',
    difficulty: null, hq_dimension: hq ? 'EQ' : null, status: 'APPROVED' }
}

/** Create or edit one admission question of any type (answer keys stay on the server; candidates never see them). */
export function QuestionDialog({ sections, question, defaultSection, onSave, onClose }: {
  sections: AdmSection[]
  question: AdmQuestion | null
  defaultSection: string
  onSave: (q: QuestionInput) => Promise<void>
  onClose: () => void
}) {
  const start = sections.find((s) => s.key === (question?.section ?? defaultSection)) ?? sections[0]
  const [q, setQ] = useState<QuestionInput>(() => (question ? {
    section: question.section, qtype: question.qtype, prompt: question.prompt, options: [...question.options], answer_key: question.answer_key,
    rubric: question.rubric, model_answer: question.model_answer ?? '', marks: Number(question.marks), topic: question.topic ?? '',
    difficulty: question.difficulty, hq_dimension: question.hq_dimension, status: question.status,
  } : blank(start)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const section = sections.find((s) => s.key === q.section) ?? start
  const isHq = section.kind === 'HQ'
  const types = isHq ? HQ_TYPES : ACADEMIC_TYPES
  const set = (p: Partial<QuestionInput>) => setQ((x) => ({ ...x, ...p }))
  const key = q.answer_key ?? {}
  const choice = q.qtype === 'MCQ' || q.qtype === 'MULTI' || q.qtype === 'SJT'

  function changeType(t: AdmQType) {
    const opts = t === 'MCQ' || t === 'MULTI' || t === 'SJT' ? (q.options.length >= 2 ? q.options : ['', '', '', '']) : []
    const k = t === 'MCQ' ? { option: 0 } : t === 'MULTI' ? { options: [0] } : t === 'SJT' ? { points: opts.map((_, i) => (i === 0 ? 2 : i === 1 ? 1 : 0)) } : null
    set({ qtype: t, options: opts, answer_key: k, marks: t === 'SJT' ? 2 : HQ_TYPES.includes(t) ? 0 : q.marks || 1,
      hq_dimension: HQ_TYPES.includes(t) ? (t === 'IDEAS' ? 'CQ' : q.hq_dimension ?? 'EQ') : null })
  }
  function setOption(i: number, text: string) { set({ options: q.options.map((o, j) => (j === i ? text : o)) }) }
  function addOption() {
    set({ options: [...q.options, ''], answer_key: q.qtype === 'SJT' ? { points: [...(key.points ?? []), 0] } : q.answer_key })
  }
  function removeOption(i: number) {
    const options = q.options.filter((_, j) => j !== i)
    let k = q.answer_key
    if (q.qtype === 'MCQ') k = { option: key.option === i ? 0 : (key.option ?? 0) > i ? (key.option ?? 0) - 1 : key.option }
    if (q.qtype === 'MULTI') k = { options: (key.options ?? []).filter((x) => x !== i).map((x) => (x > i ? x - 1 : x)) }
    if (q.qtype === 'SJT') k = { points: (key.points ?? []).filter((_, j) => j !== i) }
    set({ options, answer_key: k })
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await onSave({ ...q, prompt: q.prompt.trim(), options: q.options.map((o) => o.trim()), topic: q.topic?.trim() || null,
        model_answer: q.model_answer?.trim() || null, rubric: q.rubric.filter((r) => r.criterion.trim()) })
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  return (
    <Dialog open onClose={onClose} title={question ? 'Edit question' : 'Add question'} description={question?.source_label ? `From: ${question.source_label}` : undefined}
      className="w-[min(46rem,calc(100vw-2rem))]">
      <form onSubmit={submit} className="max-h-[72vh] space-y-3 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-3">
          <div><Label htmlFor="q-section">Section</Label>
            <Select id="q-section" value={q.section} onChange={(e) => {
              const s = sections.find((x) => x.key === e.target.value)!
              if ((s.kind === 'HQ') !== isHq) { setQ({ ...blank(s), prompt: q.prompt }) } else set({ section: s.key })
            }}>{sections.map((s) => <option key={s.key} value={s.key}>{s.title}</option>)}</Select></div>
          <div><Label htmlFor="q-type">Type</Label>
            <Select id="q-type" value={q.qtype} onChange={(e) => changeType(e.target.value as AdmQType)}>
              {types.map((t) => <option key={t} value={t}>{QTYPE_LABEL[t]}</option>)}</Select></div>
          {isHq ? (
            <div><Label htmlFor="q-dim">HQ dimension</Label>
              <Select id="q-dim" value={q.hq_dimension ?? 'EQ'} onChange={(e) => set({ hq_dimension: e.target.value as HqDimension })}>
                {(['EQ', 'SQ', 'AQ', 'CQ', 'IQ'] as HqDimension[]).map((d) => <option key={d}>{d}</option>)}</Select></div>
          ) : (
            <div><Label htmlFor="q-marks">Marks</Label>
              <Input id="q-marks" type="number" min={0} max={100} step={0.5} value={q.marks} onChange={(e) => set({ marks: Number(e.target.value) || 0 })} /></div>
          )}
        </div>
        <div><Label htmlFor="q-prompt">{isHq && q.qtype === 'SJT' ? 'Scenario and question' : 'Question'}</Label>
          <Textarea id="q-prompt" rows={3} required minLength={3} maxLength={5000} value={q.prompt} onChange={(e) => set({ prompt: e.target.value })} /></div>

        {choice && (
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-300">
              Options {q.qtype === 'SJT' ? '(mark one Best, one Acceptable, others Poor)' : q.qtype === 'MULTI' ? '(tick every correct option)' : '(mark the one correct option)'}
            </legend>
            {q.options.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                {q.qtype === 'MCQ' && (
                  <button type="button" aria-pressed={key.option === i} aria-label={`Option ${i + 1} is correct`} onClick={() => set({ answer_key: { option: i } })}
                    className={cn('cursor-pointer', key.option === i ? 'text-ok' : 'text-ink-500')}>{key.option === i ? <CircleCheck className="h-4 w-4" /> : <Circle className="h-4 w-4" />}</button>
                )}
                {q.qtype === 'MULTI' && (
                  <button type="button" aria-pressed={key.options?.includes(i)} aria-label={`Option ${i + 1} is correct`}
                    onClick={() => set({ answer_key: { options: key.options?.includes(i) ? key.options.filter((x) => x !== i) : [...(key.options ?? []), i] } })}
                    className={cn('cursor-pointer', key.options?.includes(i) ? 'text-ok' : 'text-ink-500')}>{key.options?.includes(i) ? <SquareCheck className="h-4 w-4" /> : <Square className="h-4 w-4" />}</button>
                )}
                <Input aria-label={`Option ${i + 1}`} className="h-9" maxLength={500} required value={o} onChange={(e) => setOption(i, e.target.value)} />
                {q.qtype === 'SJT' && (
                  <Select aria-label={`Option ${i + 1} key`} className="h-9 w-36 text-xs" value={key.points?.[i] ?? 0}
                    onChange={(e) => set({ answer_key: { points: q.options.map((_, j) => (j === i ? Number(e.target.value) : key.points?.[j] ?? 0)) } })}>
                    {POINTS.map((p) => <option key={p.v} value={p.v}>{p.label} ({p.v})</option>)}
                  </Select>
                )}
                {q.options.length > 2 && <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" aria-label={`Remove option ${i + 1}`} onClick={() => removeOption(i)}><Trash2 className="h-4 w-4" /></Button>}
              </div>
            ))}
            {q.options.length < 8 && <Button size="sm" variant="ghost" onClick={addOption}><Plus className="h-3.5 w-3.5" /> Option</Button>}
          </fieldset>
        )}

        {q.qtype === 'NUMERICAL' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="q-num">Correct value (optional; otherwise the AI grades with the rubric)</Label>
              <Input id="q-num" type="number" step="any" value={key.value ?? ''} onChange={(e) => set({ answer_key: e.target.value === '' ? null : { value: Number(e.target.value), tolerance: key.tolerance ?? 0.01 } })} /></div>
            <div><Label htmlFor="q-tol">Tolerance (±)</Label>
              <Input id="q-tol" type="number" step="any" min={0} value={key.tolerance ?? 0.01} disabled={key.value === undefined}
                onChange={(e) => set({ answer_key: { value: key.value, tolerance: Number(e.target.value) || 0 } })} /></div>
          </div>
        )}
        {q.qtype === 'SHORT' && (
          <div><Label htmlFor="q-accept">Accepted answers (optional, one per line — exact match; otherwise the AI grades)</Label>
            <Textarea id="q-accept" rows={2} value={(key.accept ?? []).join('\n')}
              onChange={(e) => { const accept = e.target.value.split('\n'); set({ answer_key: accept.some((a) => a.trim()) ? { accept, regex: key.regex ?? null } : null }) }} /></div>
        )}
        {(q.qtype === 'SHORT' || q.qtype === 'DESCRIPTIVE' || q.qtype === 'NUMERICAL') && (
          <>
            <div><Label htmlFor="q-model">Model answer</Label>
              <Textarea id="q-model" rows={2} maxLength={5000} value={q.model_answer ?? ''} onChange={(e) => set({ model_answer: e.target.value })} /></div>
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-300">Rubric (criterion → marks)</legend>
              {q.rubric.map((r, i) => (
                <div key={i} className="flex gap-2">
                  <Input aria-label={`Rubric criterion ${i + 1}`} className="h-9" value={r.criterion} maxLength={300}
                    onChange={(e) => set({ rubric: q.rubric.map((x, j) => (j === i ? { ...x, criterion: e.target.value } : x)) })} />
                  <Input aria-label={`Rubric marks ${i + 1}`} className="h-9 w-24" type="number" min={0} step={0.5} value={r.marks}
                    onChange={(e) => set({ rubric: q.rubric.map((x, j) => (j === i ? { ...x, marks: Number(e.target.value) || 0 } : x)) })} />
                  <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" aria-label={`Remove criterion ${i + 1}`} onClick={() => set({ rubric: q.rubric.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              <Button size="sm" variant="ghost" onClick={() => set({ rubric: [...q.rubric, { criterion: '', marks: 1 }] })}><Plus className="h-3.5 w-3.5" /> Criterion</Button>
            </fieldset>
          </>
        )}
        {!isHq && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="q-topic">Topic</Label><Input id="q-topic" maxLength={200} value={q.topic ?? ''} onChange={(e) => set({ topic: e.target.value })} /></div>
            <div><Label htmlFor="q-diff">Difficulty</Label>
              <Select id="q-diff" value={q.difficulty ?? ''} onChange={(e) => set({ difficulty: (e.target.value || null) as QuestionInput['difficulty'] })}>
                <option value="">Not set</option><option value="EASY">Easy</option><option value="MEDIUM">Medium</option><option value="HARD">Hard</option>
              </Select></div>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-ink-100">
          <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={q.status === 'APPROVED'} onChange={(e) => set({ status: e.target.checked ? 'APPROVED' : 'DRAFT' })} />
          Approved for use (drafts block publishing)
        </label>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy} id="save-question">Save question</Button>
        </div>
      </form>
    </Dialog>
  )
}
