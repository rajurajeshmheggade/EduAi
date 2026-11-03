import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookmarkPlus, FilePlus2, ListPlus, Pencil, Sparkles, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label, Select, Textarea } from '@/components/ui/field'
import { PageLoader } from '@/components/ui/loading'
import { toast } from '@/components/ui/toast'
import { errorMessage } from '@/services/apiClient'
import { questionGenService } from '@/services/questionGenService'
import type { BlueprintRow, GenerateResult, Lang, MediaInfo, PaperSummary, QgenMeta, Question } from '@/types/questionGen'
import { blueprintErrors, newRow } from '@/lib/questionGen/blueprint'
import { BlueprintEditor } from './BlueprintEditor'
import { ContentPicker, type ContentSelection } from './ContentPicker'
import { QuestionEditorDialog } from './QuestionEditor'
import { renderCtx } from '@/lib/questionGen/render'
import { QuestionBadges, QuestionView, Section } from './shared'

/* Step 1 learning content (cascading dropdowns + preview) → step 2 what to generate (blueprint, language,
   additional instructions) → step 3 review the drafts (edit, drop, select) → add them to a paper or the bank. */

const STEPS = ['Reading the selected learning content…', 'Writing questions for each type…', 'Checking answers, grounding and duplicates…']

export function GeneratorPanel({ meta, locked, paperId, paperLanguage, onAddToPaper }: {
  meta: QgenMeta
  /** Inside a paper: class and subject are the paper's. */
  locked?: { class_code: string; subject_code: string }
  paperId?: string
  paperLanguage?: Lang
  onAddToPaper?: (items: Question[]) => Promise<void>
}) {
  const [sel, setSel] = useState<ContentSelection | null>(null)
  const [rows, setRows] = useState<BlueprintRow[]>(() => [newRow(meta, 'MCQ'), { ...newRow(meta, 'SHORT_ANSWER'), count: 2 }])
  const [language, setLanguage] = useState<Lang>(paperLanguage ?? 'en')
  const [instructions, setInstructions] = useState('')
  const [busy, setBusy] = useState<{ started: number; expected: number } | null>(null)
  const [result, setResult] = useState<GenerateResult | null>(null)
  const [drafts, setDrafts] = useState<Question[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [withKey, setWithKey] = useState(true)
  const [editing, setEditing] = useState<Question | null>(null)
  const [media, setMedia] = useState<Record<string, MediaInfo>>({})
  const [error, setError] = useState<string | null>(null)
  const ctl = useRef<AbortController | null>(null)
  useEffect(() => () => ctl.current?.abort(), [])

  const problems = blueprintErrors(rows, meta)
  const canGenerate = !!sel && !problems.length && !busy

  const generate = async () => {
    if (!sel) return
    setError(null)
    ctl.current = new AbortController()
    setBusy({ started: Date.now(), expected: 8_000 + rows.length * 9_000 })
    try {
      const r = await questionGenService.generate({
        class_code: sel.class_code, subject_code: sel.subject_code, chapter: sel.chapter, topic_id: sel.topic.id,
        segment_ids: sel.segment_ids, language, instructions, blueprint: rows, paper_id: paperId ?? null,
      }, { signal: ctl.current.signal })
      setResult(r)
      setDrafts(r.items)
      setPicked(new Set(r.items.map((q) => q.id)))
      if (!r.items.length) setError('No questions could be generated from the selected content. Select more content or change the blueprint.')
    } catch (e) {
      if (!ctl.current?.signal.aborted) setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const chosen = drafts.filter((q) => picked.has(q.id))
  const ctx = useMemo(() => renderCtx(meta, language, media), [meta, language, media])

  return (
    <div className="space-y-5">
      <Section title="1 · Learning content" description="Questions are generated only from the content you select here.">
        <ContentPicker locked={locked} onChange={setSel} />
      </Section>

      <Section title="2 · Questions to generate" description="Mix as many question types as you need. Leave marks blank to assign them automatically.">
        <BlueprintEditor meta={meta} rows={rows} onChange={setRows} />
        <div className="mt-4 grid gap-3 md:grid-cols-[14rem_1fr]">
          <div>
            <Label htmlFor="qg-lang">Language</Label>
            <Select id="qg-lang" value={language} onChange={(e) => setLanguage(e.target.value as Lang)}>
              {meta.languages.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="qg-instr">Additional instructions (optional)</Label>
            <Textarea id="qg-instr" rows={2} maxLength={1000} value={instructions} onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. Use everyday examples from Indian homes; avoid questions on the activity steps." />
          </div>
        </div>
        {problems.length > 0 && <ul className="mt-3 list-disc pl-5 text-sm text-warn">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={() => void generate()} disabled={!canGenerate}><Sparkles className="h-4 w-4" /> Generate questions</Button>
          {!sel && <span className="text-sm text-ink-400">Select a topic first.</span>}
        </div>
      </Section>

      {busy && <GeneratingLoader started={busy.started} expected={busy.expected} onCancel={() => ctl.current?.abort()} />}
      {error && !busy && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      {result && !busy && drafts.length > 0 && (
        <Section title={`3 · Review ${drafts.length} generated question${drafts.length === 1 ? '' : 's'}`}
          description={`From ${result.source.topic} (${result.source.chapter}). Generated by ${result.engine === 'offline' ? 'the offline generator' : result.engine}.`}
          actions={<label className="flex items-center gap-2 text-sm text-ink-200"><input type="checkbox" checked={withKey} onChange={(e) => setWithKey(e.target.checked)} className="h-4 w-4 accent-brand-500" /> Show answers</label>}>
          {result.warnings.length > 0 && (
            <ul className="mb-3 space-y-1 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">
              {result.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-brand-500" checked={picked.size === drafts.length}
              onChange={(e) => setPicked(e.target.checked ? new Set(drafts.map((q) => q.id)) : new Set())} /> Select all</label>
            <span className="text-ink-400">{chosen.length} selected · {chosen.reduce((s, q) => s + q.marks, 0)} marks</span>
          </div>
          <ol className="space-y-3">
            {drafts.map((q, i) => (
              <li key={q.id} className="rounded-xl border border-line bg-ink-900/60 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={picked.has(q.id)}
                      onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(q.id); else n.delete(q.id); return n })} />
                    <span className="sr-only">Select question {i + 1}</span>
                    <QuestionBadges q={q} meta={meta} />
                  </label>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(q)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                    <Button size="sm" variant="ghost" aria-label={`Discard question ${i + 1}`} onClick={() => setDrafts((d) => d.filter((x) => x.id !== q.id))}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
                <QuestionView q={q} number={String(i + 1)} ctx={ctx} withKey={withKey} />
              </li>
            ))}
          </ol>
          <AddActions sel={sel} language={language} chosen={chosen} paperId={paperId} onAddToPaper={onAddToPaper}
            onDone={(ids) => { setDrafts((d) => d.filter((q) => !ids.has(q.id))); setPicked(new Set()) }} />
        </Section>
      )}

      {editing && (
        <QuestionEditorDialog question={editing} meta={meta} media={media} onMedia={(id, info) => setMedia((m) => ({ ...m, [id]: info }))}
          onClose={() => setEditing(null)} onSave={(q) => { setDrafts((d) => d.map((x) => (x.id === q.id ? q : x))); setEditing(null) }} />
      )}
    </div>
  )
}

/** Progress for a single long request: an honest estimate that slows down near the end and never claims 100 %. */
export function GeneratingLoader({ started, expected, onCancel }: { started: number; expected: number; onCancel: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 400)
    return () => window.clearInterval(t)
  }, [])
  const elapsed = now - started
  const progress = Math.min(95, 95 * (1 - Math.exp(-elapsed / expected)))
  const step = STEPS[Math.min(STEPS.length - 1, Math.floor((progress / 95) * STEPS.length))]
  return (
    <PageLoader message="Generating questions" detail={`${step} (${Math.round(elapsed / 1000)} s)`} progress={progress} slowAfterMs={Math.max(20_000, expected * 1.5)} className="min-h-[14rem] rounded-2xl border border-line">
      <Button size="sm" variant="secondary" className="mt-3" onClick={onCancel}><X className="h-3.5 w-3.5" /> Cancel</Button>
    </PageLoader>
  )
}

function AddActions({ sel, language, chosen, paperId, onAddToPaper, onDone }: {
  sel: ContentSelection | null; language: Lang; chosen: Question[]; paperId?: string
  onAddToPaper?: (items: Question[]) => Promise<void>; onDone: (ids: Set<string>) => void
}) {
  const nav = useNavigate()
  const [dlg, setDlg] = useState<'new' | 'existing' | 'bank' | null>(null)
  const [busy, setBusy] = useState(false)
  const done = () => onDone(new Set(chosen.map((q) => q.id)))

  const addHere = async () => {
    if (!onAddToPaper) return
    setBusy(true)
    try { await onAddToPaper(chosen); done() } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }

  return (
    <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
      {paperId && onAddToPaper ? (
        <Button onClick={() => void addHere()} disabled={!chosen.length || busy}><ListPlus className="h-4 w-4" /> Add {chosen.length} to this paper</Button>
      ) : (
        <>
          <Button onClick={() => setDlg('new')} disabled={!chosen.length || !sel}><FilePlus2 className="h-4 w-4" /> Add to a new paper</Button>
          <Button variant="secondary" onClick={() => setDlg('existing')} disabled={!chosen.length || !sel}><ListPlus className="h-4 w-4" /> Add to a draft paper</Button>
        </>
      )}
      <Button variant="secondary" onClick={() => setDlg('bank')} disabled={!chosen.length || !sel}><BookmarkPlus className="h-4 w-4" /> Save to question bank</Button>
      {dlg === 'new' && sel && <NewPaperDialog sel={sel} language={language} onClose={() => setDlg(null)} onCreated={async (paperIdNew) => {
        const r = await questionGenService.addItems(paperIdNew, chosen.map((q) => ({ question: q })))
        toast(`✓ Paper created with ${r.added} question${r.added === 1 ? '' : 's'}`)
        done()
        nav(`/teacher/question-generator/papers/${paperIdNew}`)
      }} />}
      {dlg === 'existing' && sel && <ExistingPaperDialog sel={sel} onClose={() => setDlg(null)} onPick={async (id) => {
        const r = await questionGenService.addItems(id, chosen.map((q) => ({ question: q })))
        toast(`✓ ${r.added} added${r.skipped_duplicates ? ` · ${r.skipped_duplicates} duplicate${r.skipped_duplicates === 1 ? '' : 's'} skipped` : ''}`)
        done()
        nav(`/teacher/question-generator/papers/${id}`)
      }} />}
      {dlg === 'bank' && sel && <BankSaveDialog onClose={() => setDlg(null)} count={chosen.length} onSave={async (visibility) => {
        const r = await questionGenService.saveToBank({ class_code: sel.class_code, subject_code: sel.subject_code, chapter: sel.chapter, language, visibility, questions: chosen })
        toast(`✓ ${r.saved.length} saved to the question bank${r.duplicates.length ? ` · ${r.duplicates.length} already there` : ''}`)
        setDlg(null)
      }} />}
    </div>
  )
}

export function BankSaveDialog({ count, onSave, onClose }: { count: number; onSave: (v: 'PRIVATE' | 'ORG') => Promise<void>; onClose: () => void }) {
  const [visibility, setVisibility] = useState<'PRIVATE' | 'ORG'>('PRIVATE')
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open onClose={onClose} title="Save to question bank" description={`${count} question${count === 1 ? '' : 's'}. Questions already in the bank (same or nearly the same) are skipped.`}>
      <fieldset className="space-y-2 text-sm">
        <legend className="sr-only">Who can use them</legend>
        <label className="flex items-start gap-2"><input type="radio" name="vis" checked={visibility === 'PRIVATE'} onChange={() => setVisibility('PRIVATE')} className="mt-1 h-4 w-4 accent-brand-500" /> <span><b>Only me</b> — my private bank</span></label>
        <label className="flex items-start gap-2"><input type="radio" name="vis" checked={visibility === 'ORG'} onChange={() => setVisibility('ORG')} className="mt-1 h-4 w-4 accent-brand-500" /> <span><b>My school</b> — every teacher of the institution can reuse them</span></label>
      </fieldset>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={async () => { setBusy(true); try { await onSave(visibility) } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) } }}>Save</Button>
      </div>
    </Dialog>
  )
}

function NewPaperDialog({ sel, language, onCreated, onClose }: { sel: ContentSelection; language: Lang; onCreated: (id: string) => Promise<void>; onClose: () => void }) {
  const [title, setTitle] = useState(`${sel.subject_name} — ${sel.chapter.charAt(0).toUpperCase() + sel.chapter.slice(1)}`)
  const [busy, setBusy] = useState(false)
  const create = async () => {
    setBusy(true)
    try {
      const p = await questionGenService.createPaper({ class_code: sel.class_code, subject_code: sel.subject_code, chapter: sel.chapter, title: title.trim(), language })
      await onCreated(p.paper_id)
    } catch (e) {
      toast(errorMessage(e), 'error')
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={onClose} title="New question paper" description={`${sel.class_name} · ${sel.subject_name}`}>
      <Label htmlFor="np-title">Paper title</Label>
      <Input id="np-title" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} autoFocus />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => void create()} disabled={busy || title.trim().length < 2}>Create paper</Button>
      </div>
    </Dialog>
  )
}

function ExistingPaperDialog({ sel, onPick, onClose }: { sel: ContentSelection; onPick: (id: string) => Promise<void>; onClose: () => void }) {
  const [papers, setPapers] = useState<PaperSummary[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [id, setId] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    questionGenService.papers().then((ps) => {
      const mine = ps.filter((p) => p.status === 'DRAFT' && p.class_code === sel.class_code && p.subject_code === sel.subject_code)
      setPapers(mine); setId(mine[0]?.paper_id ?? '')
    }).catch((e) => setErr(errorMessage(e)))
  }, [sel.class_code, sel.subject_code])
  return (
    <Dialog open onClose={onClose} title="Add to a draft paper" description={`Draft papers for ${sel.class_name} · ${sel.subject_name}`}>
      {err && <p role="alert" className="text-sm text-bad">{err}</p>}
      {!papers && !err && <p className="text-sm text-ink-400">Loading…</p>}
      {papers && !papers.length && <p className="text-sm text-ink-400">No draft papers for this class and subject yet — create a new paper instead.</p>}
      {papers && papers.length > 0 && (
        <>
          <Label htmlFor="ep-paper">Paper</Label>
          <Select id="ep-paper" value={id} onChange={(e) => setId(e.target.value)}>
            {papers.map((p) => <option key={p.paper_id} value={p.paper_id}>{p.title} (v{p.version}, {p.question_count} questions)</option>)}
          </Select>
        </>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={!id || busy} onClick={async () => { setBusy(true); try { await onPick(id) } catch (e) { toast(errorMessage(e), 'error'); setBusy(false) } }}>Add</Button>
      </div>
    </Dialog>
  )
}
