import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowDown, ArrowLeft, ArrowUp, BookmarkPlus, CheckCircle2, Copy, Eye, FileDown, FileText, GitBranchPlus, GripVertical,
  Library, ListChecks, Lock, Pencil, Plus, Printer, Save, Settings2, Sparkles, Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label, Select } from '@/components/ui/field'
import { Spinner } from '@/components/ui/loading'
import { Tabs } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toast'
import { errorMessage } from '@/services/apiClient'
import { downloadBlob, questionGenService } from '@/services/questionGenService'
import { blankQuestion, duplicateAt, fmtMarks, moveItem, nudge, numberPaper, paperFileBase, removeAt, totalMarks, validateQuestion } from '@/lib/questionGen/paper'
import { printPaper } from '@/lib/questionGen/paperPrint'
import { paperHtml } from '@/lib/questionGen/render'
import { cn } from '@/lib/utils'
import type { AssessmentResult, MediaInfo, Paper, PaperItem, QgenMeta, Question, QType } from '@/types/questionGen'
import { BankPanel } from './BankPanel'
import { BankSaveDialog, GeneratorPanel } from './GeneratorPanel'
import { NewQuestionDialog, QuestionEditorDialog } from './QuestionEditor'
import { PaperSettings } from './PaperSettings'
import { renderCtx } from '@/lib/questionGen/render'
import { PaperStyles, QuestionBadges, QuestionView } from './shared'

/* The question-paper editor: questions by section (drag-and-drop or keyboard reorder, edit, duplicate, delete, move
   between sections, add manually / from AI / from the bank), exam header and sections, full preview, Save as
   draft, Save to question bank, Publish (final; new version to edit again), PDF / Word / print of the paper and
   of the answer key, and conversion of a published paper into an Online Test / Assignment. */

type Tab = 'questions' | 'settings' | 'generate' | 'bank'

export function PaperEditor({ initial, meta, onReload }: { initial: Paper; meta: QgenMeta; onReload: () => void }) {
  const nav = useNavigate()
  const [paper, setPaper] = useState<Paper>(initial)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<Tab>('questions')
  const [editing, setEditing] = useState<{ index: number | null; q: Question; section: string } | null>(null)
  const [picking, setPicking] = useState<string | null>(null)
  const [preview, setPreview] = useState<boolean | null>(null)
  const [withKey, setWithKey] = useState(false)
  const [dlg, setDlg] = useState<'publish' | 'assessment' | 'bank' | 'conflict' | null>(null)
  const [exporting, setExporting] = useState<string | null>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const published = paper.status === 'PUBLISHED'
  const ctx = useMemo(() => renderCtx(meta, paper.language, paper.media), [meta, paper.language, paper.media])

  // a reload hands in a new `initial`: adopt it (derived during render, not in an effect)
  const [seen, setSeen] = useState(initial)
  if (seen !== initial) { setSeen(initial); setPaper(initial); setDirty(false) }
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const update = useCallback((patch: Partial<Paper>) => { setPaper((p) => ({ ...p, ...patch })); setDirty(true) }, [])
  const setItems = (items: PaperItem[]) => update({ items, total_marks: totalMarks(items), question_count: items.length })
  const addMedia = (id: string, info: MediaInfo) => setPaper((p) => ({ ...p, media: { ...p.media, [id]: info } }))

  const save = useCallback(async (): Promise<Paper | null> => {
    const invalid = paper.items.map((it, i) => ({ i, e: validateQuestion(it.question) })).find((x) => x.e.length)
    if (invalid) { toast(`Question ${invalid.i + 1}: ${invalid.e[0]}`, 'error'); return null }
    if (paper.title.trim().length < 2) { toast('Give the paper a name (Paper settings)', 'error'); return null }
    setSaving(true)
    try {
      const saved = await questionGenService.savePaper(paper.paper_id, {
        revision: paper.revision, title: paper.title.trim(), language: paper.language, chapter: paper.chapter,
        header: paper.header, sections: paper.sections, items: paper.items,
      })
      setPaper(saved)
      setDirty(false)
      toast('✓ Draft saved')
      return saved
    } catch (e) {
      const msg = errorMessage(e)
      if (/another window|reload/i.test(msg)) setDlg('conflict')
      else toast(msg, 'error')
      return null
    } finally {
      setSaving(false)
    }
  }, [paper])

  /** Server-side operations work on the saved paper: save first when there are unsaved edits. */
  const ensureSaved = async (): Promise<Paper | null> => (dirty ? save() : paper)

  const exportPdf = async (answerKey: boolean) => {
    const p = await ensureSaved()
    if (!p) return
    setExporting(answerKey ? 'key-pdf' : 'pdf')
    try {
      const blob = await questionGenService.pdf(p.paper_id, answerKey)
      downloadBlob(blob, `${paperFileBase(p.header.exam_title || p.title)}${answerKey ? ' - Answer Key' : ''}.pdf`)
    } catch (e) { toast(errorMessage(e), 'error') } finally { setExporting(null) }
  }
  const exportWord = async (answerKey: boolean) => {
    setExporting(answerKey ? 'key-word' : 'word')
    try {
      const { downloadPaperDocx } = await import('@/lib/questionGen/paperDocx')
      await downloadPaperDocx(paper, { arCodes: ctx.arCodes, arInstruction: ctx.arInstruction, lang: paper.language }, { answerKey })
    } catch (e) { toast(errorMessage(e, 'The Word file could not be created'), 'error') } finally { setExporting(null) }
  }
  const print = (answerKey: boolean) => {
    if (!printPaper(paper, ctx, { answerKey })) toast('Allow pop-ups for this site to print the paper', 'error')
  }

  const addQuestions = async (qs: Question[], section?: string) => {
    const p = await ensureSaved()
    if (!p) throw new Error('Save the paper first')
    const r = await questionGenService.addItems(p.paper_id, qs.map((q) => ({ section_id: section ?? p.sections[0]?.id, question: q })))
    setPaper(r); setDirty(false)
    toast(`✓ ${r.added} question${r.added === 1 ? '' : 's'} added${r.skipped_duplicates ? ` · ${r.skipped_duplicates} duplicate${r.skipped_duplicates === 1 ? '' : 's'} skipped` : ''}`)
    setTab('questions')
  }
  const addFromBank = async (ids: string[]) => {
    const p = await ensureSaved()
    if (!p) throw new Error('Save the paper first')
    const r = await questionGenService.addFromBank(p.paper_id, ids, p.sections[0]?.id)
    setPaper(r); setDirty(false)
    toast(`✓ ${r.added} added from the bank${r.skipped_duplicates ? ` · ${r.skipped_duplicates} already on the paper` : ''}`)
    setTab('questions')
  }

  const groups = numberPaper(paper.sections, paper.items, { keepEmpty: true })
  const onDrop = (targetIndex: number | null, sectionId: string) => {
    if (drag === null || published) return
    let items = paper.items.map((it, i) => (i === drag ? { ...it, section_id: sectionId } : it))
    const to = targetIndex === null ? items.length - 1 : targetIndex > drag ? targetIndex - 1 : targetIndex
    items = targetIndex === null ? moveItem(items, drag, items.length - 1) : moveItem(items, drag, to)
    setItems(items)
    setDrag(null)
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-8">
      <PaperStyles />
      <header className="space-y-3">
        <Link to="/teacher/question-generator?tab=papers" onClick={(e) => { if (dirty && !window.confirm('Leave without saving your changes?')) e.preventDefault() }}
          className="inline-flex items-center gap-1 text-sm text-ink-300 hover:text-brand-600"><ArrowLeft className="h-4 w-4" /> All papers</Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold text-fg">{paper.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-300">
              <Badge tone={published ? 'ok' : 'warn'}>{published ? <><Lock className="h-3 w-3" /> Published</> : 'Draft'} · v{paper.version}</Badge>
              <span>{paper.class_name} · {paper.subject_name}{paper.chapter ? ` · ${paper.chapter}` : ''}</span>
              <span>· {paper.items.length} question{paper.items.length === 1 ? '' : 's'} · {fmtMarks(totalMarks(paper.items))} marks</span>
              {dirty && <Badge tone="warn">Unsaved changes</Badge>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!published && <Button onClick={() => void save()} disabled={!dirty || saving}>{saving ? <Spinner className="h-4 w-4 border-white" label="Saving" /> : <Save className="h-4 w-4" />} Save draft</Button>}
            <Button variant="secondary" onClick={() => setPreview(false)}><Eye className="h-4 w-4" /> Preview</Button>
            {!published && <Button variant="outline" disabled={!paper.items.length} onClick={() => setDlg('publish')}><CheckCircle2 className="h-4 w-4" /> Publish</Button>}
            {published && <Button variant="outline" onClick={async () => { try { const p = await questionGenService.newVersion(paper.paper_id); toast(`✓ Version ${p.version} created as a draft`); nav(`/teacher/question-generator/papers/${p.paper_id}`) } catch (e) { toast(errorMessage(e), 'error') } }}><GitBranchPlus className="h-4 w-4" /> New version</Button>}
          </div>
        </div>
        <ExportBar exporting={exporting} disabled={!paper.items.length} onPdf={exportPdf} onWord={exportWord} onPrint={print}
          onBank={() => setDlg('bank')} onAssessment={published ? () => setDlg('assessment') : undefined} evalTestId={paper.eval_test_id} />
        {published && (
          <p className="flex items-center gap-2 rounded-xl border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok"><Lock className="h-4 w-4" />
            Published {paper.published_at ? new Date(paper.published_at).toLocaleString() : ''} — this version is final and can no longer be changed. Use “New version” to edit a copy.</p>
        )}
      </header>

      <Tabs<Tab> value={tab} onChange={setTab} items={[
        { id: 'questions', label: 'Questions', icon: ListChecks, count: paper.items.length },
        { id: 'settings', label: 'Paper settings', icon: Settings2 },
        ...(published ? [] : [{ id: 'generate' as Tab, label: 'Generate with AI', icon: Sparkles }, { id: 'bank' as Tab, label: 'From question bank', icon: Library }]),
      ]} />

      {tab === 'questions' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm text-ink-200"><input type="checkbox" checked={withKey} onChange={(e) => setWithKey(e.target.checked)} className="h-4 w-4 accent-brand-500" /> Show answers</label>
            {!published && <p className="text-xs text-ink-400">Drag <GripVertical className="inline h-3.5 w-3.5" /> to reorder, or use the arrow buttons (Alt + ↑ / ↓ on the handle).</p>}
          </div>
          {groups.map((g) => (
            <section key={g.section.id} aria-label={g.section.title || 'Section'} className="space-y-3"
              onDragOver={(e) => { if (drag !== null) e.preventDefault() }} onDrop={(e) => { e.preventDefault(); if (!g.rows.length) onDrop(null, g.section.id) }}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-1">
                <h2 className="font-display text-base font-semibold text-fg">{g.section.title || 'Questions'}</h2>
                {!published && <Button size="sm" variant="ghost" onClick={() => setPicking(g.section.id)}><Plus className="h-3.5 w-3.5" /> Add question</Button>}
              </div>
              {!g.rows.length && <p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-ink-400">No questions in this section yet{published ? '.' : ' — add one, generate with AI or drop a question here.'}</p>}
              <ol className="space-y-3">
                {g.rows.map((r) => (
                  <li key={`${r.index}:${r.item.question.id}`}
                    onDragOver={(e) => { if (drag !== null) e.preventDefault() }}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDrop(r.index, g.section.id) }}
                    className={cn('rounded-xl border bg-ink-900/70 p-3 transition-colors', drag === r.index ? 'border-brand-400 opacity-60' : 'border-line')}>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {!published && (
                          <button type="button" draggable aria-label={`Question ${r.number}: drag to reorder, or press Alt with the up or down arrow`}
                            onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(r.index)); setDrag(r.index) }}
                            onDragEnd={() => setDrag(null)}
                            onKeyDown={(e) => {
                              if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); setItems(nudge(paper.sections, paper.items, r.index, e.key === 'ArrowUp' ? -1 : 1)) }
                            }}
                            className="cursor-grab rounded p-0.5 text-ink-500 hover:text-fg active:cursor-grabbing"><GripVertical className="h-4 w-4" /></button>
                        )}
                        <QuestionBadges q={r.item.question} meta={meta} />
                      </div>
                      {!published && (
                        <div className="flex flex-wrap items-center gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setEditing({ index: r.index, q: r.item.question, section: r.item.section_id })}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                          <Button size="icon" variant="ghost" aria-label={`Duplicate question ${r.number}`} onClick={() => setItems(duplicateAt(paper.items, r.index))}><Copy className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" aria-label={`Move question ${r.number} up`} disabled={r.number === 1} onClick={() => setItems(nudge(paper.sections, paper.items, r.index, -1))}><ArrowUp className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" aria-label={`Move question ${r.number} down`} disabled={r.number === paper.items.length} onClick={() => setItems(nudge(paper.sections, paper.items, r.index, 1))}><ArrowDown className="h-4 w-4" /></Button>
                          {paper.sections.length > 1 && (
                            <Select aria-label={`Section of question ${r.number}`} className="h-8 w-36 text-xs" value={r.item.section_id}
                              onChange={(e) => setItems(paper.items.map((it, i) => (i === r.index ? { ...it, section_id: e.target.value } : it)))}>
                              {paper.sections.map((s) => <option key={s.id} value={s.id}>{s.title || s.id}</option>)}
                            </Select>
                          )}
                          <Button size="icon" variant="ghost" aria-label={`Delete question ${r.number}`} onClick={() => { if (window.confirm(`Delete question ${r.number}?`)) setItems(removeAt(paper.items, r.index)) }}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      )}
                    </div>
                    <QuestionView q={r.item.question} number={String(r.number)} ctx={ctx} withKey={withKey} />
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      {tab === 'settings' && <PaperSettings paper={paper} meta={meta} readOnly={published} onChange={update} onMedia={addMedia} />}
      {tab === 'generate' && !published && (
        <GeneratorPanel meta={meta} locked={{ class_code: paper.class_code, subject_code: paper.subject_code }} paperId={paper.paper_id}
          paperLanguage={paper.language} onAddToPaper={(qs) => addQuestions(qs)} />
      )}
      {tab === 'bank' && !published && <BankPanel meta={meta} defaultSubject={paper.nlp_subject} onAdd={addFromBank} />}

      {picking && <NewQuestionDialog meta={meta} onClose={() => setPicking(null)} onPick={(t: QType) => {
        setEditing({ index: null, q: blankQuestion(t, { topic: '' }), section: picking }); setPicking(null)
      }} />}
      {editing && (
        <QuestionEditorDialog question={editing.q} meta={meta} media={paper.media} onMedia={addMedia} onClose={() => setEditing(null)}
          title={editing.index === null ? 'New question' : 'Edit question'}
          onSave={(q) => {
            if (editing.index === null) setItems([...paper.items, { item_id: null, section_id: editing.section, question: q }])
            else setItems(paper.items.map((it, i) => (i === editing.index ? { ...it, question: q } : it)))
            setEditing(null)
          }} />
      )}
      {preview !== null && <PreviewDialog paper={paper} meta={meta} answerKey={preview} onToggle={setPreview} onClose={() => setPreview(null)} onPrint={print} />}
      {dlg === 'publish' && <PublishDialog paper={paper} dirty={dirty} onClose={() => setDlg(null)} onPublish={async () => {
        const p = await ensureSaved()
        if (!p) return
        const done = await questionGenService.publish(p.paper_id)
        setPaper(done); setDirty(false); setDlg(null); setTab('questions')
        toast('✓ Paper published')
      }} />}
      {dlg === 'assessment' && <AssessmentDialog paper={paper} onClose={() => setDlg(null)} onDone={() => onReload()} />}
      {dlg === 'bank' && <BankSaveDialog count={paper.items.length} onClose={() => setDlg(null)} onSave={async (visibility) => {
        const p = await ensureSaved()
        if (!p) return
        const r = await questionGenService.saveToBankFromPaper(p.paper_id, { visibility })
        toast(`✓ ${r.saved.length} saved to the question bank${r.duplicates.length ? ` · ${r.duplicates.length} already there` : ''}`)
        setDlg(null)
      }} />}
      {dlg === 'conflict' && (
        <Dialog open onClose={() => setDlg(null)} title="This paper changed elsewhere" description="It was saved in another window or tab after you opened it.">
          <p className="text-sm text-ink-300">Reload to get the latest version. Your unsaved changes in this window will be lost.</p>
          <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => setDlg(null)}>Keep editing</Button><Button onClick={() => { setDlg(null); onReload() }}>Reload</Button></div>
        </Dialog>
      )}
    </div>
  )
}

function ExportBar({ exporting, disabled, onPdf, onWord, onPrint, onBank, onAssessment, evalTestId }: {
  exporting: string | null; disabled: boolean; onPdf: (key: boolean) => void; onWord: (key: boolean) => void; onPrint: (key: boolean) => void
  onBank: () => void; onAssessment?: () => void; evalTestId: string | null
}) {
  const busy = (id: string) => (exporting === id ? <Spinner className="h-3.5 w-3.5" label="Preparing file" /> : null)
  return (
    <div className="flex flex-wrap gap-2 rounded-xl border border-line bg-ink-900/50 p-2" role="group" aria-label="Export">
      <span className="self-center px-1 text-xs font-medium uppercase tracking-wide text-ink-400">Paper</span>
      <Button size="sm" variant="secondary" disabled={disabled || !!exporting} onClick={() => onPdf(false)}>{busy('pdf') ?? <FileDown className="h-3.5 w-3.5" />} PDF</Button>
      <Button size="sm" variant="secondary" disabled={disabled || !!exporting} onClick={() => onWord(false)}>{busy('word') ?? <FileText className="h-3.5 w-3.5" />} Word</Button>
      <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onPrint(false)}><Printer className="h-3.5 w-3.5" /> Print</Button>
      <span className="self-center px-1 text-xs font-medium uppercase tracking-wide text-ink-400">Answer key</span>
      <Button size="sm" variant="secondary" disabled={disabled || !!exporting} onClick={() => onPdf(true)}>{busy('key-pdf') ?? <FileDown className="h-3.5 w-3.5" />} PDF</Button>
      <Button size="sm" variant="secondary" disabled={disabled || !!exporting} onClick={() => onWord(true)}>{busy('key-word') ?? <FileText className="h-3.5 w-3.5" />} Word</Button>
      <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onPrint(true)}><Printer className="h-3.5 w-3.5" /> Print</Button>
      <span className="mx-1 hidden w-px self-stretch bg-line sm:block" />
      <Button size="sm" variant="ghost" disabled={disabled} onClick={onBank}><BookmarkPlus className="h-3.5 w-3.5" /> Save to question bank</Button>
      {onAssessment && <Button size="sm" variant="ghost" onClick={onAssessment}><ListChecks className="h-3.5 w-3.5" /> {evalTestId ? 'Create another online test' : 'Create online test / assignment'}</Button>}
    </div>
  )
}

function PreviewDialog({ paper, meta, answerKey, onToggle, onClose, onPrint }: {
  paper: Paper; meta: QgenMeta; answerKey: boolean; onToggle: (k: boolean) => void; onClose: () => void; onPrint: (k: boolean) => void
}) {
  const html = useMemo(() => paperHtml(paper, renderCtx(meta, paper.language, paper.media), { answerKey }), [paper, meta, answerKey])
  return (
    <Dialog open onClose={onClose} title={answerKey ? 'Answer key preview' : 'Paper preview'} className="w-[min(64rem,calc(100vw-1rem))]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Tabs<'paper' | 'key'> value={answerKey ? 'key' : 'paper'} onChange={(v) => onToggle(v === 'key')} items={[{ id: 'paper', label: 'Question paper' }, { id: 'key', label: 'Answer key' }]} />
        <Button size="sm" variant="secondary" onClick={() => onPrint(answerKey)}><Printer className="h-3.5 w-3.5" /> Print</Button>
      </div>
      <div className="max-h-[72vh] overflow-y-auto rounded-xl bg-white p-6 shadow-inner md:p-10">
        <div className="mx-auto max-w-[46rem]" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </Dialog>
  )
}

function PublishDialog({ paper, dirty, onPublish, onClose }: { paper: Paper; dirty: boolean; onPublish: () => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const issues = paper.items.map((it, i) => validateQuestion(it.question).map((e) => `Q${i + 1}: ${e}`)).flat()
  return (
    <Dialog open onClose={onClose} title="Publish this paper?" description="A published paper is final: it can no longer be edited, only copied into a new version.">
      <ul className="space-y-1 text-sm text-ink-200">
        <li>{paper.items.length} questions · {fmtMarks(totalMarks(paper.items))} marks · version {paper.version}</li>
        {dirty && <li className="text-warn">Your unsaved changes are saved first.</li>}
        {!paper.header.duration_minutes && <li className="text-warn">No time duration is set (Paper settings).</li>}
      </ul>
      {issues.length > 0 && <ul role="alert" className="mt-2 list-disc pl-5 text-sm text-bad">{issues.slice(0, 6).map((x) => <li key={x}>{x}</li>)}</ul>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={busy || issues.length > 0} onClick={async () => { setBusy(true); try { await onPublish() } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) } }}>
          {busy ? <Spinner className="h-4 w-4" label="Publishing" /> : <CheckCircle2 className="h-4 w-4" />} Publish
        </Button>
      </div>
    </Dialog>
  )
}

function AssessmentDialog({ paper, onClose, onDone }: { paper: Paper; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<'ONLINE_TEST' | 'ASSIGNMENT'>('ONLINE_TEST')
  const [duration, setDuration] = useState<number | ''>(paper.header.duration_minutes ?? 60)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AssessmentResult | null>(null)
  const done = useRef(false)
  const create = async () => {
    setBusy(true)
    try {
      const r = await questionGenService.createAssessment(paper.paper_id, { assessment_type: kind, duration_minutes: kind === 'ONLINE_TEST' ? Number(duration) || null : null })
      setResult(r); done.current = true
    } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }
  const close = () => { if (done.current) onDone(); onClose() }
  return (
    <Dialog open onClose={close} title="Create an online test or assignment" description="The published paper’s questions are copied into Tests & AI evaluation as a draft with its answer key; you then set dates and assign it.">
      {!result ? (
        <div className="space-y-3">
          <div>
            <Label htmlFor="as-kind">Type</Label>
            <Select id="as-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="ONLINE_TEST">Online test (timed, in the browser)</option>
              <option value="ASSIGNMENT">Assignment (students upload their answers)</option>
            </Select>
          </div>
          {kind === 'ONLINE_TEST' && (
            <div className="w-48"><Label htmlFor="as-dur">Duration (minutes)</Label>
              <Input id="as-dur" type="number" min={1} max={600} value={duration} onChange={(e) => setDuration(e.target.value === '' ? '' : Number(e.target.value))} /></div>
          )}
          <p className="text-xs text-ink-400">Multiple choice, Assertion–Reason and single-statement True/False are graded exactly; every other type is graded by the AI examiner against its model answer and marking points. Case, scenario and passage questions become one item per sub-question.</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button onClick={() => void create()} disabled={busy || (kind === 'ONLINE_TEST' && !duration)}>{busy && <Spinner className="h-4 w-4" label="Creating" />} Create</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-ok">✓ Created with {result.items} items ({result.auto_graded_exactly} graded exactly, {result.ai_graded} by AI) · {result.total_marks} marks.</p>
          {result.warnings.length > 0 && <ul className="list-disc pl-5 text-warn">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>Close</Button>
            <Link to={result.assessment_type === 'ONLINE_TEST' ? '/teacher/tests' : '/teacher/assignments'} className="inline-flex h-10 items-center rounded-xl bg-brand-500 px-4 text-sm font-medium text-white">Open in {result.assessment_type === 'ONLINE_TEST' ? 'Online tests' : 'Assignments'}</Link>
          </div>
        </div>
      )}
    </Dialog>
  )
}
