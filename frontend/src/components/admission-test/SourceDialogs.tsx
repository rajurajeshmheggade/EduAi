import { useEffect, useMemo, useState } from 'react'
import { CheckSquare, Loader2, Search, Sparkles, Square } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label, Select } from '@/components/ui/field'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/services/apiClient'
import { admissionTestService as svc, type AdmSection, type AgeBand, type BankFilters, type BankQuestion, type BankSource, type HqItem } from '@/services/admissionTestService'

const EVAL_QTYPE: Record<BankQuestion['question_type'], string> = { MCQ: 'MCQ', SHORT_ANSWER: 'Short answer', DESCRIPTIVE: 'Descriptive', NUMERICAL: 'Numerical' }

/** Pick questions from the teacher's own Assignments and Online tests; they are copied (snapshotted) into the test. */
export function ImportDialog({ testId, sections, onClose, onDone }: { testId: string; sections: AdmSection[]; onClose: () => void; onDone: () => void }) {
  const academic = sections.filter((s) => s.kind !== 'HQ')
  const [f, setF] = useState<BankFilters>({ page: 1 })
  const [data, setData] = useState<{ questions: BankQuestion[]; total: number; sources: BankSource[] } | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)
  const [section, setSection] = useState(academic[0]?.key ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const t = window.setTimeout(() => {
      svc.bank(f).then((d) => { if (live) { setData(d); setError(null) } }).catch((e) => live && setError(errorMessage(e)))
    }, 250)
    return () => { live = false; window.clearTimeout(t) }
  }, [f])

  const classes = useMemo(() => [...new Map((data?.sources ?? []).map((s) => [s.class_code, s.class_name])).entries()], [data])
  const subjects = useMemo(() => [...new Map((data?.sources ?? []).filter((s) => !f.class_code || s.class_code === f.class_code)
    .map((s) => [s.subject_code, s.subject_name])).entries()], [data, f.class_code])
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const set = (p: Partial<BankFilters>) => setF((x) => ({ ...x, ...p, page: 1 }))

  async function doImport() {
    setBusy(true); setError(null)
    try {
      const r = await svc.importQuestions(testId, [...picked], section)
      toast(`✓ Imported ${r.imported.length} question${r.imported.length === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} already in the test)` : ''}${r.needs_review ? ` · ${r.needs_review} need a correct option` : ''}`)
      onDone()
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Dialog open onClose={onClose} title="Import from your Assignments and Online tests" description="Questions are copied: later edits to the assignment do not change this admission test."
      className="w-[min(60rem,calc(100vw-2rem))]">
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-5">
          <Select aria-label="Class" value={f.class_code ?? ''} onChange={(e) => set({ class_code: e.target.value || undefined, subject_code: undefined })}>
            <option value="">All classes</option>{classes.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</Select>
          <Select aria-label="Subject" value={f.subject_code ?? ''} onChange={(e) => set({ subject_code: e.target.value || undefined })}>
            <option value="">All subjects</option>{subjects.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</Select>
          <Select aria-label="Assessment type" value={f.assessment_type ?? ''} onChange={(e) => set({ assessment_type: e.target.value || undefined })}>
            <option value="">Assignments + Online tests</option><option value="ASSIGNMENT">Assignments</option><option value="ONLINE_TEST">Online tests</option></Select>
          <Select aria-label="Question type" value={f.qtype ?? ''} onChange={(e) => set({ qtype: e.target.value || undefined })}>
            <option value="">All types</option>{Object.entries(EVAL_QTYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-500" />
            <Input aria-label="Search questions" placeholder="Search" className="pl-9" value={f.q ?? ''} onChange={(e) => set({ q: e.target.value })} /></div>
        </div>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        <ul className="max-h-[48vh] space-y-1.5 overflow-y-auto pr-1" aria-label="Your questions">
          {!data ? <li className="skeleton h-48" /> : data.questions.length === 0 ? (
            <li className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-ink-300">No questions match. Questions come from your own Assignments and Online tests (Teacher → Assessments).</li>
          ) : data.questions.map((q) => {
            const on = picked.has(q.master_q_id)
            return (
              <li key={q.master_q_id} className={cn('rounded-xl border p-3 transition-colors', on ? 'border-brand-400/50 bg-brand-500/5' : 'border-line')}>
                <div className="flex items-start gap-2">
                  <button type="button" onClick={() => toggle(q.master_q_id)} aria-pressed={on} aria-label={`Select question ${q.sl_no} of ${q.test_title}`}
                    className={cn('mt-0.5 cursor-pointer', on ? 'text-brand-600' : 'text-ink-500')}>{on ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}</button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-fg">{q.question_text}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
                      <Badge>{EVAL_QTYPE[q.question_type]}</Badge><Badge tone="neutral">{q.max_marks} marks</Badge>
                      <span>From: {q.source_label}</span>
                      <button type="button" className="cursor-pointer text-brand-600 hover:underline" onClick={() => setOpen(open === q.master_q_id ? null : q.master_q_id)}>
                        {open === q.master_q_id ? 'Hide answer' : 'Preview answer'}</button>
                    </div>
                    {open === q.master_q_id && (
                      <div className="mt-2 space-y-1 rounded-lg bg-ink-800 p-2 text-xs text-ink-300">
                        {q.mcq_options.length > 0 && <p>Options: {q.mcq_options.join(' · ')} — correct: <b className="text-ok">{q.correct_option ?? 'not set'}</b></p>}
                        <p><b className="text-ink-100">Model answer:</b> {q.model_answer_text}</p>
                        {q.key_rubric_points.length > 0 && <p><b className="text-ink-100">Rubric:</b> {q.key_rubric_points.join(' · ')}</p>}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
        {data && data.total > (data.questions.length + ((f.page ?? 1) - 1) * 50) && (
          <Button size="sm" variant="ghost" onClick={() => setF((x) => ({ ...x, page: (x.page ?? 1) + 1 }))}>Next page</Button>
        )}
        <div className="flex flex-wrap items-end justify-end gap-2 border-t border-line pt-3">
          <span className="mr-auto text-sm text-ink-300">{picked.size} selected{data ? ` · ${data.total} available` : ''}</span>
          <div><Label htmlFor="imp-section">Into section</Label>
            <Select id="imp-section" className="w-48" value={section} onChange={(e) => setSection(e.target.value)}>
              {academic.map((s) => <option key={s.key} value={s.key}>{s.title}</option>)}</Select></div>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={doImport} disabled={busy || !picked.size || !section} id="import-selected">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Import {picked.size || ''}</Button>
        </div>
      </div>
    </Dialog>
  )
}

/** Built-in, age-banded HQ items (situational judgement, reflective, ideas). */
export function HqBankDialog({ testId, defaultBand, onClose, onDone }: { testId: string; defaultBand: AgeBand; onClose: () => void; onDone: () => void }) {
  const [band, setBand] = useState<AgeBand>(defaultBand)
  const [items, setItems] = useState<HqItem[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    svc.hqBank(band).then((d) => { if (live) { setItems(d.items); setPicked(new Set()) } }).catch((e) => live && setError(errorMessage(e)))
    return () => { live = false }
  }, [band])

  async function add(standard: boolean) {
    setBusy(true); setError(null)
    try {
      const r = await svc.addFromBank(testId, standard ? { age_band: band } : { item_ids: [...picked] })
      toast(`✓ Added ${r.added.length} HQ item${r.added.length === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} already in the test)` : ''}`)
      onDone()
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Dialog open onClose={onClose} title="HQ item bank" description="Situational judgement items are keyed Best 2 · Acceptable 1 · Poor 0. Reflective and ideas items are scored by the AI against the HQ rubric."
      className="w-[min(56rem,calc(100vw-2rem))]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Age band">
          {(['6-8', '9-11', '12-14', '15-17'] as AgeBand[]).map((b) => (
            <button key={b} aria-pressed={band === b} onClick={() => setBand(b)}
              className={cn('cursor-pointer rounded-full border px-3 py-1 text-sm', band === b ? 'border-brand-400/60 bg-brand-500/10 text-brand-600' : 'border-line text-ink-300')}>Ages {b}</button>
          ))}
        </div>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        <ul className="max-h-[50vh] space-y-1.5 overflow-y-auto pr-1">
          {!items ? <li className="skeleton h-48" /> : items.map((i) => {
            const on = picked.has(i.item_id)
            return (
              <li key={i.item_id} className={cn('rounded-xl border p-3', on ? 'border-brand-400/50 bg-brand-500/5' : 'border-line')}>
                <label className="flex cursor-pointer items-start gap-2">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-500" checked={on}
                    onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(i.item_id)) n.delete(i.item_id); else n.add(i.item_id); return n })} />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="flex flex-wrap gap-1.5"><Badge tone="aqua">{i.qtype}</Badge><Badge>{i.hq_dimension}</Badge></span>
                    <span className="mt-1 block text-fg">{i.prompt}</span>
                    {i.options.length > 0 && (
                      <span className="mt-1 block space-y-0.5 text-xs text-ink-300">
                        {i.options.map((o, k) => <span key={k} className="block">{['A', 'B', 'C', 'D', 'E'][k]}. {o} <b className={i.answer_key?.points[k] === 2 ? 'text-ok' : 'text-ink-500'}>({i.answer_key?.points[k]})</b></span>)}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
          <Button variant="secondary" onClick={() => add(true)} disabled={busy} id="add-hq-standard">Add the standard set (10 SJT · 2 reflective · 1 ideas)</Button>
          <Button onClick={() => add(false)} disabled={busy || !picked.size}>Add {picked.size || ''} selected</Button>
        </div>
      </div>
    </Dialog>
  )
}

/** AI drafts land as drafts; the teacher edits and approves each one. */
export function DraftDialog({ testId, sections, defaultBand, onClose, onDone }: {
  testId: string; sections: AdmSection[]; defaultBand: AgeBand; onClose: () => void; onDone: () => void
}) {
  const [kind, setKind] = useState<'HQ' | 'ACADEMIC'>(sections.some((s) => s.kind === 'HQ') ? 'HQ' : 'ACADEMIC')
  const pool = sections.filter((s) => (kind === 'HQ' ? s.kind === 'HQ' : s.kind !== 'HQ'))
  const [section, setSection] = useState(pool[0]?.key ?? '')
  const [topic, setTopic] = useState('')
  const [count, setCount] = useState(4)
  const [band, setBand] = useState<AgeBand>(defaultBand)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const target = pool.find((s) => s.key === section)?.key ?? pool[0]?.key ?? ''

  async function run() {
    setBusy(true); setError(null)
    try {
      const r = await svc.draft(testId, { kind, section: target, topic: topic.trim() || undefined, count, age_band: band })
      toast(`✓ Drafted ${r.drafted.length} item${r.drafted.length === 1 ? '' : 's'} — review and approve each one${r.rejected ? ` (${r.rejected} unusable dropped)` : ''}`)
      onDone()
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Dialog open onClose={onClose} title="Draft with AI" description="Every drafted item lands as a draft for you to edit and approve before publishing.">
      <div className="space-y-3">
        <div className="flex rounded-xl border border-line bg-ink-800 p-1" role="group" aria-label="What to draft">
          {(['HQ', 'ACADEMIC'] as const).map((k) => (
            <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)} disabled={!sections.some((s) => (k === 'HQ' ? s.kind === 'HQ' : s.kind !== 'HQ'))}
              className={cn('flex-1 cursor-pointer rounded-lg px-3 py-1.5 text-sm disabled:opacity-40', kind === k ? 'bg-ink-900 font-medium text-brand-600 ring-1 ring-line' : 'text-ink-300')}>
              {k === 'HQ' ? 'HQ section' : 'Academic gap filling'}</button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="d-section">Section</Label>
            <Select id="d-section" value={target} onChange={(e) => setSection(e.target.value)}>{pool.map((s) => <option key={s.key} value={s.key}>{s.title}</option>)}</Select></div>
          {kind === 'HQ' ? (
            <div><Label htmlFor="d-band">Age band</Label>
              <Select id="d-band" value={band} onChange={(e) => setBand(e.target.value as AgeBand)}>{['6-8', '9-11', '12-14', '15-17'].map((b) => <option key={b}>{b}</option>)}</Select></div>
          ) : (
            <div><Label htmlFor="d-topic">Topic</Label><Input id="d-topic" required maxLength={200} placeholder="Fractions and decimals" value={topic} onChange={(e) => setTopic(e.target.value)} /></div>
          )}
          <div><Label htmlFor="d-count">{kind === 'HQ' ? 'Situational judgement items' : 'Questions'}</Label>
            <Input id="d-count" type="number" min={1} max={12} value={count} onChange={(e) => setCount(Math.max(1, Math.min(12, Number(e.target.value) || 1)))} /></div>
        </div>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={run} disabled={busy || !target || (kind === 'ACADEMIC' && !topic.trim())}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Draft</Button>
        </div>
      </div>
    </Dialog>
  )
}
