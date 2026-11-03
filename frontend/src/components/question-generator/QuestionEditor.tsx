import { useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ImagePlus, Plus, Shuffle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label, Select, Textarea } from '@/components/ui/field'
import { Spinner } from '@/components/ui/loading'
import { toast } from '@/components/ui/toast'
import { errorMessage } from '@/services/apiClient'
import { questionGenService } from '@/services/questionGenService'
import {
  ALPHA, AR_LETTERS, LIMITS, ROMAN, blankQuestion, blanksOf, derangement, isComposite, moveItem, newId, normaliseMarks, subLabel, validateQuestion,
} from '@/lib/questionGen/paper'
import { cn } from '@/lib/utils'
import type { CompositeData, MediaInfo, QgenMeta, Question, QType } from '@/types/questionGen'
import { HIGHER_ORDER } from '@/types/questionGen'
import { RichTextField } from './RichTextField'

/* Type-specific question editor (manual questions and edits of generated / bank ones). Every type of the catalogue
   has its own inputs; common fields are text, marks, difficulty, Bloom level, topic, hint, explanation and images.
   Validation mirrors the server (lib/questionGen/paper.ts validateQuestion); the server validates again on save. */

type Media = Record<string, MediaInfo>
type Upd = (q: Question) => void

const csv = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean)

export function QuestionEditorDialog({ question, meta, media, onMedia, onSave, onClose, title }: {
  question: Question
  meta: QgenMeta
  media: Media
  onMedia: (id: string, info: MediaInfo) => void
  onSave: (q: Question) => void
  onClose: () => void
  title?: string
}) {
  const [q, setQ] = useState<Question>(() => JSON.parse(JSON.stringify(question)))
  const [errors, setErrors] = useState<string[]>([])
  const save = () => {
    const fixed = normaliseMarks(q)
    const errs = validateQuestion(fixed)
    setErrors(errs)
    if (errs.length) return
    onSave(fixed)
  }
  return (
    <Dialog open onClose={onClose} title={title ?? 'Edit question'} description={meta.types.find((t) => t.code === q.type)?.description}
      className="w-[min(60rem,calc(100vw-1.5rem))]">
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        <QuestionFields q={q} onChange={setQ} meta={meta} media={media} onMedia={onMedia} />
      </div>
      {errors.length > 0 && (
        <ul role="alert" className="mt-3 list-disc space-y-0.5 rounded-lg border border-bad/30 bg-bad/10 py-2 pl-7 pr-3 text-sm text-bad">
          {errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save}>Save question</Button>
      </div>
    </Dialog>
  )
}

/** Pick a type for a new manual question. */
export function NewQuestionDialog({ meta, onPick, onClose }: { meta: QgenMeta; onPick: (t: QType) => void; onClose: () => void }) {
  const groups = [...new Set(meta.types.map((t) => t.group))]
  return (
    <Dialog open onClose={onClose} title="Add a question" description="Choose the question type to write." className="w-[min(46rem,calc(100vw-2rem))]">
      <div className="max-h-[65vh] space-y-4 overflow-y-auto">
        {groups.map((g) => (
          <div key={g}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">{g}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {meta.types.filter((t) => t.group === g).map((t) => (
                <button key={t.code} type="button" onClick={() => onPick(t.code)}
                  className="cursor-pointer rounded-xl border border-line bg-ink-900/60 p-3 text-left transition-colors hover:border-brand-400/60 hover:bg-brand-500/5">
                  <span className="block text-sm font-medium text-fg">{t.label}</span>
                  <span className="mt-0.5 block text-xs text-ink-400">{t.description}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  )
}

export function QuestionFields({ q, onChange, meta, media, onMedia, nested }: {
  q: Question; onChange: Upd; meta: QgenMeta; media: Media; onMedia: (id: string, info: MediaInfo) => void; nested?: boolean
}) {
  const set = (patch: Partial<Question>) => onChange({ ...q, ...patch } as Question)
  const setData = (patch: Record<string, unknown>) => onChange({ ...q, data: { ...q.data, ...patch } } as Question)
  const rk = (k: string) => `${q.id}:${k}`
  const textLabel = q.type === 'MATCH' ? 'Title / instruction (optional)' : q.type === 'FILL_BLANK' ? 'Sentence — put each answer in [square brackets]'
    : q.type === 'TRUE_FALSE' || q.type === 'ORDERING' ? 'Instruction' : isComposite(q.type) ? 'Instruction' : 'Question'
  const blooms = q.type === 'HOTS' ? meta.blooms.filter((b) => HIGHER_ORDER.includes(b.code)) : meta.blooms
  const composite = isComposite(q.type)

  return (
    <div className="space-y-4">
      {q.type !== 'ASSERTION_REASON' && (
        <RichTextField label={textLabel} value={q.text} resetKey={rk('text')} onChange={(text) => set({ text })}
          limit={q.type === 'SHORT_ANSWER' ? LIMITS.short_question : LIMITS.question} minRows={q.type === 'FILL_BLANK' ? 2 : 2}
          placeholder={q.type === 'FILL_BLANK' ? 'Water boils at [100] °C at sea level.' : 'Type the question…'} />
      )}
      <TypeFields q={q} setData={setData} onChange={onChange} meta={meta} media={media} onMedia={onMedia} />
      <div className={cn('grid gap-3', composite ? 'sm:grid-cols-3' : 'sm:grid-cols-4')}>
        {!composite && (
          <div>
            <Label htmlFor={rk('marks')}>Marks</Label>
            <Input id={rk('marks')} type="number" min={0.5} max={100} step={0.5} value={q.marks}
              onChange={(e) => set({ marks: Number(e.target.value) })} />
          </div>
        )}
        <div>
          <Label htmlFor={rk('diff')}>Difficulty</Label>
          <Select id={rk('diff')} value={q.difficulty} onChange={(e) => set({ difficulty: e.target.value as Question['difficulty'] })}>
            {meta.difficulties.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor={rk('bloom')}>Bloom’s level</Label>
          <Select id={rk('bloom')} value={q.bloom} onChange={(e) => set({ bloom: e.target.value as Question['bloom'] })}>
            {blooms.map((b) => <option key={b.code} value={b.code}>{b.label}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor={rk('topic')}>Topic</Label>
          <Input id={rk('topic')} maxLength={300} value={q.topic} onChange={(e) => set({ topic: e.target.value })} />
        </div>
      </div>
      {composite && <p className="text-xs text-ink-400">Marks: {q.marks} (the sum of the sub-questions’ marks)</p>}
      {!nested && <MediaField q={q} onChange={onChange} media={media} onMedia={onMedia} />}
      <details className="rounded-xl border border-line px-3 py-2" open={!!(q.hint || q.explanation)}>
        <summary className="cursor-pointer text-sm font-medium text-ink-200">Hint and explanation</summary>
        <div className="mt-3 space-y-3">
          <div>
            <Label htmlFor={rk('hint')}>Hint (optional, {LIMITS.hint} characters)</Label>
            <Input id={rk('hint')} maxLength={LIMITS.hint} value={q.hint} onChange={(e) => set({ hint: e.target.value })} />
          </div>
          <RichTextField label="Explanation (shown in the answer key)" value={q.explanation} resetKey={rk('expl')} onChange={(explanation) => set({ explanation })} limit={LIMITS.explanation} />
        </div>
      </details>
    </div>
  )
}

function TypeFields({ q, setData, onChange, meta, media, onMedia }: {
  q: Question; setData: (p: Record<string, unknown>) => void; onChange: Upd; meta: QgenMeta; media: Media; onMedia: (id: string, info: MediaInfo) => void
}) {
  const rk = (k: string) => `${q.id}:${k}`
  switch (q.type) {
    case 'MCQ': {
      const d = q.data
      return (
        <div className="space-y-2">
          <Label>Options — choose the correct one</Label>
          {d.options.map((o, i) => (
            <div key={o.id} className="flex items-start gap-2">
              <input type="radio" name={rk('correct')} aria-label={`Option ${ALPHA[i]} is correct`} checked={d.correct === o.id}
                onChange={() => setData({ correct: o.id })} className="mt-9 h-4 w-4 accent-brand-500" />
              <div className="flex-1"><RichTextField label={`Option (${ALPHA[i]})`} value={o.text} resetKey={rk(o.id)} minRows={1} compact limit={LIMITS.option}
                onChange={(text) => setData({ options: d.options.map((x) => (x.id === o.id ? { ...x, text } : x)) })} /></div>
              <Button variant="ghost" size="icon" className="mt-7" aria-label={`Remove option ${ALPHA[i]}`} disabled={d.options.length <= 2}
                onClick={() => setData({ options: d.options.filter((x) => x.id !== o.id), correct: d.correct === o.id ? d.options.find((x) => x.id !== o.id)!.id : d.correct })}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <div className="flex flex-wrap items-end gap-3">
            <Button size="sm" variant="secondary" disabled={d.options.length >= 8} onClick={() => setData({ options: [...d.options, { id: newId('o'), text: '' }] })}><Plus className="h-3.5 w-3.5" /> Option</Button>
            <div className="w-48">
              <Label htmlFor={rk('layout')}>Layout on the paper</Label>
              <Select id={rk('layout')} value={d.layout} onChange={(e) => setData({ layout: e.target.value })}>
                <option value="list">One per line</option><option value="two">Two columns</option><option value="four">Four columns</option>
              </Select>
            </div>
          </div>
        </div>
      )
    }
    case 'MRQ': {
      const d = q.data
      return (
        <div className="space-y-2">
          <Label>Options — tick every correct one (at least two)</Label>
          {d.options.map((o, i) => (
            <div key={o.id} className="flex items-start gap-2">
              <input type="checkbox" aria-label={`Option ${ALPHA[i]} is correct`} checked={o.correct} className="mt-9 h-4 w-4 accent-brand-500"
                onChange={(e) => setData({ options: d.options.map((x) => (x.id === o.id ? { ...x, correct: e.target.checked } : x)) })} />
              <div className="flex-1"><RichTextField label={`Option (${ALPHA[i]})`} value={o.text} resetKey={rk(o.id)} minRows={1} compact limit={LIMITS.option}
                onChange={(text) => setData({ options: d.options.map((x) => (x.id === o.id ? { ...x, text } : x)) })} /></div>
              <Button variant="ghost" size="icon" className="mt-7" aria-label={`Remove option ${ALPHA[i]}`} disabled={d.options.length <= 4}
                onClick={() => setData({ options: d.options.filter((x) => x.id !== o.id) })}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-4">
            <Button size="sm" variant="secondary" disabled={d.options.length >= 8} onClick={() => setData({ options: [...d.options, { id: newId('o'), text: '', correct: false }] })}><Plus className="h-3.5 w-3.5" /> Option</Button>
            <label className="flex items-center gap-2 text-sm text-ink-200"><input type="checkbox" checked={d.partial_credit} onChange={(e) => setData({ partial_credit: e.target.checked })} className="h-4 w-4 accent-brand-500" /> Partial credit: max(0, (right − wrong) ÷ correct) × marks</label>
          </div>
        </div>
      )
    }
    case 'TRUE_FALSE': {
      const d = q.data
      return (
        <div className="space-y-2">
          <Label>Statements</Label>
          {d.statements.map((s, i) => (
            <div key={s.id} className="flex items-start gap-2">
              <div className="flex-1"><RichTextField label={`Statement (${ROMAN[i]})`} value={s.text} resetKey={rk(s.id)} minRows={1} compact limit={LIMITS.statement}
                onChange={(text) => setData({ statements: d.statements.map((x) => (x.id === s.id ? { ...x, text } : x)) })} /></div>
              <div className="mt-6 w-28">
                <Select aria-label={`Answer for statement ${ROMAN[i]}`} value={s.answer ? 'true' : 'false'}
                  onChange={(e) => setData({ statements: d.statements.map((x) => (x.id === s.id ? { ...x, answer: e.target.value === 'true' } : x)) })}>
                  <option value="true">True</option><option value="false">False</option>
                </Select>
              </div>
              <Button variant="ghost" size="icon" className="mt-6" aria-label={`Remove statement ${ROMAN[i]}`} disabled={d.statements.length <= 1}
                onClick={() => setData({ statements: d.statements.filter((x) => x.id !== s.id) })}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button size="sm" variant="secondary" disabled={d.statements.length >= 10} onClick={() => setData({ statements: [...d.statements, { id: newId('s'), text: '', answer: true }] })}><Plus className="h-3.5 w-3.5" /> Statement</Button>
          <p className="text-xs text-ink-500">Marks are split evenly across the statements.</p>
        </div>
      )
    }
    case 'FILL_BLANK': {
      const d = q.data
      const answers = blanksOf(q.text)
      return (
        <div className="space-y-2">
          {answers.length === 0 && <p className="text-sm text-warn">No blanks yet — write each answer in square brackets inside the sentence.</p>}
          {answers.map((a, i) => {
            const rule = d.blanks[i] ?? { alternates: [], case_sensitive: false }
            const setRule = (patch: Partial<typeof rule>) => {
              const blanks = answers.map((_, k) => (k === i ? { ...rule, ...patch } : d.blanks[k] ?? { alternates: [], case_sensitive: false }))
              setData({ blanks })
            }
            return (
              <div key={`${i}:${a}`} className="grid items-end gap-2 rounded-lg border border-line p-2 sm:grid-cols-[1fr_2fr_auto]">
                <div className="text-sm"><span className="text-ink-400">Blank {i + 1}:</span> <b>{a}</b></div>
                <div>
                  <Label htmlFor={rk(`alt${i}`)}>Also accept (comma-separated)</Label>
                  <Input id={rk(`alt${i}`)} defaultValue={rule.alternates.join(', ')} onBlur={(e) => setRule({ alternates: csv(e.target.value).slice(0, 5) })} />
                </div>
                <label className="flex items-center gap-2 pb-2 text-sm text-ink-200"><input type="checkbox" checked={rule.case_sensitive} onChange={(e) => setRule({ case_sensitive: e.target.checked })} className="h-4 w-4 accent-brand-500" /> Case-sensitive</label>
              </div>
            )
          })}
          <div className="grid items-end gap-3 sm:grid-cols-[auto_1fr]">
            <label className="flex items-center gap-2 pb-2 text-sm text-ink-200"><input type="checkbox" checked={d.word_bank} onChange={(e) => setData({ word_bank: e.target.checked })} className="h-4 w-4 accent-brand-500" /> Show a word bank</label>
            {d.word_bank && (
              <div>
                <Label htmlFor={rk('distr')}>Extra words for the word bank (comma-separated)</Label>
                <Input id={rk('distr')} defaultValue={d.distractors.join(', ')} onBlur={(e) => setData({ distractors: csv(e.target.value).slice(0, 6) })} />
              </div>
            )}
          </div>
        </div>
      )
    }
    case 'MATCH': {
      const d = q.data
      const setPairs = (pairs: typeof d.pairs) => setData({ pairs, right_order: derangement(pairs.map((p) => p.id), pairs.map((p) => p.id).join('|')) })
      return (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <div><Label htmlFor={rk('lt')}>Column I title</Label><Input id={rk('lt')} maxLength={60} value={d.left_title} onChange={(e) => setData({ left_title: e.target.value })} /></div>
            <div><Label htmlFor={rk('rt')}>Column II title</Label><Input id={rk('rt')} maxLength={60} value={d.right_title} onChange={(e) => setData({ right_title: e.target.value })} /></div>
          </div>
          {d.pairs.map((p, i) => (
            <div key={p.id} className="grid items-start gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <RichTextField label={`${i + 1}. Column I`} value={p.left} resetKey={rk(`${p.id}l`)} minRows={1} compact limit={LIMITS.option}
                onChange={(left) => setData({ pairs: d.pairs.map((x) => (x.id === p.id ? { ...x, left } : x)) })} />
              <RichTextField label="Its match (Column II)" value={p.right} resetKey={rk(`${p.id}r`)} minRows={1} compact limit={LIMITS.option}
                onChange={(right) => setData({ pairs: d.pairs.map((x) => (x.id === p.id ? { ...x, right } : x)) })} />
              <Button variant="ghost" size="icon" className="mt-6" aria-label={`Remove pair ${i + 1}`} disabled={d.pairs.length <= 2}
                onClick={() => setPairs(d.pairs.filter((x) => x.id !== p.id))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="secondary" disabled={d.pairs.length >= 10} onClick={() => setPairs([...d.pairs, { id: newId('p'), left: '', right: '' }])}><Plus className="h-3.5 w-3.5" /> Pair</Button>
            <Button size="sm" variant="ghost" onClick={() => setData({ right_order: derangement(d.pairs.map((p) => p.id), newId()) })}><Shuffle className="h-3.5 w-3.5" /> Shuffle Column II</Button>
            <label className="flex items-center gap-2 text-sm text-ink-200"><input type="checkbox" checked={d.per_pair_marks} onChange={(e) => setData({ per_pair_marks: e.target.checked })} className="h-4 w-4 accent-brand-500" /> Marks per pair</label>
          </div>
          <p className="text-xs text-ink-500">Enter matching pairs side by side; Column II is shuffled on the paper and the answer key shows the matches.</p>
        </div>
      )
    }
    case 'ONE_WORD': {
      const d = q.data
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor={rk('ans')}>Answer (one word or term)</Label><Input id={rk('ans')} maxLength={LIMITS.alternate} value={d.answer} onChange={(e) => setData({ answer: e.target.value })} /></div>
          <div><Label htmlFor={rk('alts')}>Also accept (comma-separated)</Label><Input id={rk('alts')} defaultValue={d.alternates.join(', ')} onBlur={(e) => setData({ alternates: csv(e.target.value).slice(0, 5) })} /></div>
        </div>
      )
    }
    case 'SHORT_ANSWER':
    case 'HOTS': {
      const d = q.data
      return (
        <div className="space-y-3">
          <RichTextField label="Model answer" value={d.model_answer} resetKey={rk('ma')} onChange={(model_answer) => setData({ model_answer })} limit={q.type === 'HOTS' ? 4000 : LIMITS.answer} minRows={3} />
          <PointsField id={rk('kp')} label="Key points a marker looks for (one per line)" value={d.key_points} onChange={(key_points) => setData({ key_points })} />
        </div>
      )
    }
    case 'LONG_ANSWER':
    case 'ESSAY': {
      const d = q.data as { model_answer: string; marking_points?: { text: string; marks: number }[]; rubric?: { text: string; marks: number }[]; word_limit?: number | null }
      const key = q.type === 'LONG_ANSWER' ? 'marking_points' : 'rubric'
      const points = (q.type === 'LONG_ANSWER' ? d.marking_points : d.rubric) ?? []
      return (
        <div className="space-y-3">
          <RichTextField label="Model answer" value={d.model_answer} resetKey={rk('ma')} onChange={(model_answer) => setData({ model_answer })} limit={q.type === 'ESSAY' ? LIMITS.essay_answer : LIMITS.long_answer} minRows={4} />
          <div className="space-y-2">
            <Label>{q.type === 'LONG_ANSWER' ? 'Marking points' : 'Rubric'}</Label>
            {points.map((p, i) => (
              <div key={i} className="flex gap-2">
                <Input aria-label={`Point ${i + 1}`} maxLength={LIMITS.point} value={p.text} onChange={(e) => setData({ [key]: points.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)) })} />
                <Input aria-label={`Marks for point ${i + 1}`} type="number" min={0} step={0.5} className="w-24" value={p.marks} onChange={(e) => setData({ [key]: points.map((x, k) => (k === i ? { ...x, marks: Number(e.target.value) } : x)) })} />
                <Button variant="ghost" size="icon" aria-label={`Remove point ${i + 1}`} onClick={() => setData({ [key]: points.filter((_, k) => k !== i) })}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button size="sm" variant="secondary" disabled={points.length >= 12} onClick={() => setData({ [key]: [...points, { text: '', marks: 1 }] })}><Plus className="h-3.5 w-3.5" /> Point</Button>
          </div>
          {q.type === 'ESSAY' && (
            <div className="w-40"><Label htmlFor={rk('wl')}>Word limit</Label>
              <Input id={rk('wl')} type="number" min={20} max={3000} value={d.word_limit ?? ''} onChange={(e) => setData({ word_limit: e.target.value === '' ? null : Number(e.target.value) })} /></div>
          )}
        </div>
      )
    }
    case 'ASSERTION_REASON': {
      const d = q.data
      return (
        <div className="space-y-3">
          <RichTextField label="Assertion (A)" value={d.assertion} resetKey={rk('a')} onChange={(assertion) => setData({ assertion })} limit={LIMITS.statement} minRows={1} />
          <RichTextField label="Reason (R)" value={d.reason} resetKey={rk('r')} onChange={(reason) => setData({ reason })} limit={LIMITS.statement} minRows={1} />
          <fieldset>
            <legend className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-300">Correct code</legend>
            <div className="space-y-1">
              {AR_LETTERS.map((c, i) => (
                <label key={c} className="flex cursor-pointer items-start gap-2 text-sm text-ink-200">
                  <input type="radio" name={rk('ar')} checked={d.answer === c} onChange={() => setData({ answer: c })} className="mt-1 h-4 w-4 accent-brand-500" />
                  <span><b>({c})</b> {meta.settings.ar_codes[i]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )
    }
    case 'DIAGRAM': {
      const d = q.data
      return (
        <div className="space-y-3">
          <div><Label htmlFor={rk('dd')}>Diagram to draw / refer to (shown in the answer key)</Label>
            <Textarea id={rk('dd')} rows={2} maxLength={1000} value={d.diagram_description} onChange={(e) => setData({ diagram_description: e.target.value })}
              placeholder="e.g. A labelled diagram of an electric circuit with a cell, key, bulb and ammeter in series" /></div>
          <div><Label htmlFor={rk('lb')}>Labels (comma-separated)</Label>
            <Input id={rk('lb')} defaultValue={d.labels.join(', ')} onBlur={(e) => setData({ labels: csv(e.target.value).slice(0, 12) })} /></div>
          <RichTextField label="Model answer" value={d.model_answer} resetKey={rk('ma')} onChange={(model_answer) => setData({ model_answer })} limit={3000} minRows={2} />
          <PointsField id={rk('kp')} label="Key points (one per line)" value={d.key_points} onChange={(key_points) => setData({ key_points })} />
          <p className="text-xs text-ink-500">Upload the diagram below if the question refers to one.</p>
        </div>
      )
    }
    case 'NUMERICAL': {
      const d = q.data
      return (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div><Label htmlFor={rk('na')}>Answer (number)</Label><Input id={rk('na')} type="number" step="any" value={Number.isFinite(d.answer) ? d.answer : ''} onChange={(e) => setData({ answer: e.target.value === '' ? NaN : Number(e.target.value) })} /></div>
            <div><Label htmlFor={rk('nu')}>Unit</Label><Input id={rk('nu')} maxLength={30} value={d.unit} onChange={(e) => setData({ unit: e.target.value })} placeholder="e.g. Ω, m/s, kg" /></div>
            <div><Label htmlFor={rk('nt')}>Tolerance (±)</Label><Input id={rk('nt')} type="number" min={0} step="any" value={d.tolerance} onChange={(e) => setData({ tolerance: Number(e.target.value) })} /></div>
          </div>
          <RichTextField label="Worked solution" value={d.solution} resetKey={rk('sol')} onChange={(solution) => setData({ solution })} limit={LIMITS.explanation} minRows={3} />
        </div>
      )
    }
    case 'ORDERING': {
      const d = q.data
      const setItems = (items: typeof d.items) => setData({ items, display_order: derangement(items.map((x) => x.id), items.map((x) => x.id).join('|')) })
      return (
        <div className="space-y-2">
          <Label>Items in the CORRECT order (they are shuffled on the paper)</Label>
          {d.items.map((it, i) => (
            <div key={it.id} className="flex items-start gap-2">
              <span className="mt-8 w-5 text-sm text-ink-400">{i + 1}.</span>
              <div className="flex-1"><RichTextField label={`Item ${i + 1}`} value={it.text} resetKey={rk(it.id)} minRows={1} compact limit={LIMITS.option}
                onChange={(text) => setData({ items: d.items.map((x) => (x.id === it.id ? { ...x, text } : x)) })} /></div>
              <div className="mt-6 flex">
                <Button variant="ghost" size="icon" aria-label={`Move item ${i + 1} up`} disabled={i === 0} onClick={() => setItems(moveItem(d.items, i, i - 1))}><ArrowUp className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" aria-label={`Move item ${i + 1} down`} disabled={i === d.items.length - 1} onClick={() => setItems(moveItem(d.items, i, i + 1))}><ArrowDown className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" aria-label={`Remove item ${i + 1}`} disabled={d.items.length <= 3} onClick={() => setItems(d.items.filter((x) => x.id !== it.id))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={d.items.length >= 10} onClick={() => setItems([...d.items, { id: newId('i'), text: '' }])}><Plus className="h-3.5 w-3.5" /> Item</Button>
            <Button size="sm" variant="ghost" onClick={() => setData({ display_order: derangement(d.items.map((x) => x.id), newId()) })}><Shuffle className="h-3.5 w-3.5" /> Shuffle for the paper</Button>
          </div>
        </div>
      )
    }
    case 'CASE_BASED':
    case 'SCENARIO_BASED':
    case 'PASSAGE':
      return <CompositeFields q={q} onChange={onChange} meta={meta} media={media} onMedia={onMedia} />
  }
}

function PointsField({ id, label, value, onChange }: { id: string; label: string; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} rows={3} defaultValue={value.join('\n')}
        onBlur={(e) => onChange(e.target.value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 10).map((x) => x.slice(0, LIMITS.point)))} />
    </div>
  )
}

const SUB_TYPES: QType[] = ['MCQ', 'MRQ', 'TRUE_FALSE', 'FILL_BLANK', 'ONE_WORD', 'SHORT_ANSWER', 'LONG_ANSWER', 'ASSERTION_REASON', 'NUMERICAL', 'MATCH', 'ORDERING', 'HOTS', 'DIAGRAM', 'ESSAY']

function CompositeFields({ q, onChange, meta, media, onMedia }: { q: Question; onChange: Upd; meta: QgenMeta; media: Media; onMedia: (id: string, info: MediaInfo) => void }) {
  const d = q.data as CompositeData
  const [addType, setAddType] = useState<QType>('MCQ')
  const [open, setOpen] = useState<string | null>(d.sub_questions[0]?.id ?? null)
  const setD = (patch: Partial<CompositeData>) => onChange(normaliseMarks({ ...q, data: { ...d, ...patch } } as Question))
  const setSub = (i: number, s: Question) => setD({ sub_questions: d.sub_questions.map((x, k) => (k === i ? s : x)) })
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <div><Label htmlFor={`${q.id}:pt`}>Passage title (optional)</Label><Input id={`${q.id}:pt`} maxLength={200} value={d.passage_title} onChange={(e) => setD({ passage_title: e.target.value })} /></div>
        <div><Label htmlFor={`${q.id}:num`}>Sub-question numbering</Label>
          <Select id={`${q.id}:num`} value={d.numbering} onChange={(e) => setD({ numbering: e.target.value as CompositeData['numbering'] })}>
            <option value="alpha">(a), (b), (c)</option><option value="roman">(i), (ii), (iii)</option>
          </Select></div>
      </div>
      <RichTextField label={q.type === 'PASSAGE' ? 'Passage' : q.type === 'CASE_BASED' ? 'Case' : 'Scenario'} value={d.passage} resetKey={`${q.id}:passage`}
        onChange={(passage) => setD({ passage })} limit={LIMITS.passage} minRows={5} />
      <div className="space-y-2">
        <Label>Sub-questions</Label>
        {d.sub_questions.map((s, i) => (
          <div key={s.id} className="rounded-xl border border-line">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2">
              <button type="button" className="flex-1 cursor-pointer text-left text-sm" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
                <b>{subLabel(i, d.numbering)}</b> {meta.types.find((t) => t.code === s.type)?.label} · {s.marks} mark{s.marks === 1 ? '' : 's'}
              </button>
              <Button variant="ghost" size="icon" aria-label={`Move sub-question ${i + 1} up`} disabled={i === 0} onClick={() => setD({ sub_questions: moveItem(d.sub_questions, i, i - 1) })}><ArrowUp className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" aria-label={`Move sub-question ${i + 1} down`} disabled={i === d.sub_questions.length - 1} onClick={() => setD({ sub_questions: moveItem(d.sub_questions, i, i + 1) })}><ArrowDown className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" aria-label={`Remove sub-question ${i + 1}`} disabled={d.sub_questions.length <= 1} onClick={() => setD({ sub_questions: d.sub_questions.filter((x) => x.id !== s.id) })}><Trash2 className="h-4 w-4" /></Button>
            </div>
            {open === s.id && <div className="border-t border-line p-3"><QuestionFields q={s} onChange={(x) => setSub(i, x)} meta={meta} media={media} onMedia={onMedia} nested /></div>}
          </div>
        ))}
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-56"><Label htmlFor={`${q.id}:addt`}>New sub-question type</Label>
            <Select id={`${q.id}:addt`} value={addType} onChange={(e) => setAddType(e.target.value as QType)}>
              {SUB_TYPES.map((t) => <option key={t} value={t}>{meta.types.find((x) => x.code === t)?.label ?? t}</option>)}
            </Select></div>
          <Button size="sm" variant="secondary" disabled={d.sub_questions.length >= 8} onClick={() => {
            const s = blankQuestion(addType, { difficulty: q.difficulty, bloom: q.bloom })
            setD({ sub_questions: [...d.sub_questions, s] }); setOpen(s.id)
          }}><Plus className="h-3.5 w-3.5" /> Sub-question</Button>
        </div>
      </div>
    </div>
  )
}

function MediaField({ q, onChange, media, onMedia }: { q: Question; onChange: Upd; media: Media; onMedia: (id: string, info: MediaInfo) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const upload = async (file: File | undefined) => {
    if (!file) return
    if (!['image/png', 'image/jpeg'].includes(file.type)) { toast('Upload a PNG or JPEG image', 'error'); return }
    if (file.size > 2 * 1024 * 1024) { toast('Images must be 2 MB or smaller', 'error'); return }
    setBusy(true)
    try {
      const r = await questionGenService.upload(file)
      onMedia(r.media_id, { url: r.url, width: r.width, height: r.height })
      onChange({ ...q, media: [...q.media, { media_id: r.media_id, caption: '' }] } as Question)
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  return (
    <div>
      <Label>Images / diagrams</Label>
      <div className="flex flex-wrap gap-3">
        {q.media.map((m, i) => (
          <div key={m.media_id} className="w-44 rounded-xl border border-line p-2">
            {media[m.media_id] ? <img src={media[m.media_id].url} alt={m.caption || `Image ${i + 1}`} className="mx-auto max-h-28 rounded bg-white object-contain" /> : <div className="grid h-28 place-items-center text-xs text-ink-500">Image</div>}
            <Input aria-label={`Caption for image ${i + 1}`} className="mt-2 h-8 text-xs" maxLength={200} placeholder="Caption (e.g. Fig. 1)" value={m.caption}
              onChange={(e) => onChange({ ...q, media: q.media.map((x) => (x.media_id === m.media_id ? { ...x, caption: e.target.value } : x)) } as Question)} />
            <Button size="sm" variant="ghost" className="mt-1 w-full" onClick={() => onChange({ ...q, media: q.media.filter((x) => x.media_id !== m.media_id) } as Question)}><Trash2 className="h-3.5 w-3.5" /> Remove</Button>
          </div>
        ))}
        {q.media.length < 4 && (
          <button type="button" onClick={() => input.current?.click()} disabled={busy}
            className="grid h-[11.5rem] w-44 cursor-pointer place-items-center rounded-xl border border-dashed border-line text-sm text-ink-400 hover:border-brand-400/60 hover:text-brand-600">
            {busy ? <Spinner label="Uploading image" /> : <span className="flex flex-col items-center gap-1"><ImagePlus className="h-5 w-5" /> Add image</span>}
          </button>
        )}
        <input ref={input} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
      </div>
    </div>
  )
}
