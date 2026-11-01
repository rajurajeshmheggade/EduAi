import { CircleCheck, Circle, ListPlus, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Label, Select, Textarea } from '@/components/ui/field'
import { cn } from '@/lib/utils'
import { worksheetMarks } from '@/lib/virtualLabs'
import type { Worksheet, WorksheetQuestion } from '@/services/virtualLabService'

/** Lines are kept as typed (empty lines included) and cleaned by the server. */
const lines = (v: string) => v.split('\n')

const newQuestion = (type: WorksheetQuestion['type']): WorksheetQuestion =>
  type === 'mcq' ? { id: '', type, prompt: '', options: ['', '', '', ''], answer: 0, explanation: '', marks: 1 }
    : { id: '', type, prompt: '', options: [], answer: null, model_answer: '', marks: 2 }

/** Teacher edits the lab worksheet: aim, procedure checklist, observation table, viva questions and marks. */
export function WorksheetEditor({ value, onChange }: { value: Worksheet; onChange: (ws: Worksheet) => void }) {
  const ws = value
  const set = (patch: Partial<Worksheet>) => onChange({ ...ws, ...patch })
  const setQ = (i: number, patch: Partial<WorksheetQuestion>) => set({ questions: ws.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) })

  return (
    <div className="space-y-4">
      <div><Label htmlFor="ws-aim">Aim</Label>
        <Textarea id="ws-aim" rows={2} maxLength={1000} required value={ws.aim} onChange={(e) => set({ aim: e.target.value })} /></div>
      <div className="grid gap-3 md:grid-cols-2">
        <div><Label htmlFor="ws-materials">Apparatus / materials (one per line)</Label>
          <Textarea id="ws-materials" rows={4} value={ws.materials.join('\n')} onChange={(e) => set({ materials: lines(e.target.value) })} /></div>
        <div><Label htmlFor="ws-steps">Procedure checklist (one step per line)</Label>
          <Textarea id="ws-steps" rows={4} value={ws.steps.join('\n')} onChange={(e) => set({ steps: lines(e.target.value) })} /></div>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_8rem]">
        <div><Label htmlFor="ws-cols">Observation table columns (one per line, with units)</Label>
          <Textarea id="ws-cols" rows={3} value={ws.observation_columns.join('\n')} onChange={(e) => set({ observation_columns: lines(e.target.value) })} /></div>
        <div><Label htmlFor="ws-rows">Rows</Label>
          <Input id="ws-rows" type="number" min={0} max={20} value={ws.observation_rows} onChange={(e) => set({ observation_rows: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })} /></div>
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-1.5 flex w-full items-center justify-between text-xs font-medium uppercase tracking-wide text-ink-300">
          Viva questions <span className="normal-case tracking-normal text-ink-500">MCQs are marked automatically; short answers get AI-suggested marks</span>
        </legend>
        {ws.questions.length === 0 && <p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-ink-500">No questions yet.</p>}
        {ws.questions.map((q, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-line p-3" data-testid="ws-question">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={q.type === 'mcq' ? 'brand' : 'aqua'}>Q{i + 1}</Badge>
              <Select aria-label={`Question ${i + 1} type`} className="h-8 w-40 text-xs" value={q.type}
                onChange={(e) => setQ(i, { ...newQuestion(e.target.value as WorksheetQuestion['type']), prompt: q.prompt })}>
                <option value="mcq">Multiple choice</option>
                <option value="short">Short answer</option>
              </Select>
              <label className="ml-auto flex items-center gap-1.5 text-xs text-ink-300">Marks
                <Input aria-label={`Question ${i + 1} marks`} type="number" min={0.5} max={20} step={0.5} className="h-8 w-20 text-xs" value={q.marks}
                  onChange={(e) => setQ(i, { marks: Number(e.target.value) || 0 })} />
              </label>
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Remove question ${i + 1}`}
                onClick={() => set({ questions: ws.questions.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
            </div>
            <Textarea aria-label={`Question ${i + 1}`} rows={2} placeholder="Question" maxLength={1000} value={q.prompt} onChange={(e) => setQ(i, { prompt: e.target.value })} />
            {q.type === 'mcq' ? (
              <div className="space-y-1.5">
                {q.options.map((o, k) => (
                  <div key={k} className="flex items-center gap-2">
                    <button type="button" aria-label={`Mark option ${k + 1} of question ${i + 1} correct`} aria-pressed={q.answer === k}
                      onClick={() => setQ(i, { answer: k })} className={cn('cursor-pointer', q.answer === k ? 'text-ok' : 'text-ink-500 hover:text-fg')}>
                      {q.answer === k ? <CircleCheck className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                    </button>
                    <Input aria-label={`Question ${i + 1} option ${k + 1}`} className="h-8 text-sm" maxLength={300} value={o}
                      onChange={(e) => setQ(i, { options: q.options.map((x, m) => (m === k ? e.target.value : x)) })} />
                    {q.options.length > 2 && (
                      <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={`Remove option ${k + 1} of question ${i + 1}`}
                        onClick={() => setQ(i, { options: q.options.filter((_, m) => m !== k), answer: q.answer === k ? 0 : (q.answer ?? 0) > k ? (q.answer ?? 0) - 1 : q.answer })}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                  {q.options.length < 6 && <Button size="sm" variant="ghost" onClick={() => setQ(i, { options: [...q.options, ''] })}><Plus className="h-3.5 w-3.5" /> Option</Button>}
                  <Input aria-label={`Question ${i + 1} explanation`} className="h-8 flex-1 text-xs" placeholder="Why this is correct (shown after submitting)" maxLength={1000}
                    value={q.explanation ?? ''} onChange={(e) => setQ(i, { explanation: e.target.value })} />
                </div>
              </div>
            ) : (
              <Textarea aria-label={`Question ${i + 1} model answer`} rows={2} placeholder="Model answer (guides AI marking; shown after submitting)" maxLength={2000}
                value={q.model_answer ?? ''} onChange={(e) => setQ(i, { model_answer: e.target.value })} />
            )}
          </div>
        ))}
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => set({ questions: [...ws.questions, newQuestion('mcq')] })}><ListPlus className="h-3.5 w-3.5" /> Add MCQ</Button>
          <Button size="sm" variant="secondary" onClick={() => set({ questions: [...ws.questions, newQuestion('short')] })}><Plus className="h-3.5 w-3.5" /> Add short answer</Button>
        </div>
      </fieldset>

      <div className="grid gap-3 md:grid-cols-[1fr_10rem]">
        <div><Label htmlFor="ws-conclusion">Conclusion prompt</Label>
          <Input id="ws-conclusion" maxLength={500} value={ws.conclusion_prompt ?? ''} onChange={(e) => set({ conclusion_prompt: e.target.value })} /></div>
        <div><Label htmlFor="ws-record">Marks for lab record</Label>
          <Input id="ws-record" type="number" min={0} max={50} step={0.5} value={ws.record_marks} onChange={(e) => set({ record_marks: Number(e.target.value) || 0 })} /></div>
      </div>
      <p className="text-right text-sm text-ink-300">Total: <b className="text-fg" data-testid="ws-total">{worksheetMarks(ws)}</b> marks</p>
    </div>
  )
}
