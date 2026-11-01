import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Archive, ArrowDown, ArrowLeft, ArrowUp, Check, ClipboardList, Download, Lock, Pencil, Plus, Rocket, ShieldCheck, Sparkles, Trash2, Undo2 } from 'lucide-react'
import { DraftDialog, HqBankDialog, ImportDialog } from '@/components/admission-test/SourceDialogs'
import { QuestionDialog } from '@/components/admission-test/QuestionDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label, Select, Textarea } from '@/components/ui/field'
import { Tabs } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/services/apiClient'
import {
  admissionTestService as svc, QTYPE_LABEL, type AdmQuestion, type AdmSection, type AdmTest, type ProctoringConfig, type ScoringConfig,
  type SectionKind, type TestInput, type TestMeta,
} from '@/services/admissionTestService'

type Tab = 'questions' | 'settings' | 'proctoring' | 'scoring'
const ORIGIN: Record<AdmQuestion['origin'], string> = { IMPORTED: 'Imported', HQ_BANK: 'HQ bank', AI_DRAFT: 'AI draft', MANUAL: 'Added' }
const SEV_TONE = { Crit: 'bad', High: 'warn', Med: 'brand', Low: 'neutral', Info: 'neutral' } as const

/** Teacher: build an admission test from their own questions + the HQ section, set proctoring and scoring, publish. */
export default function AdmissionTestEditor() {
  const { testId = '' } = useParams()
  const [t, setT] = useState<AdmTest | null>(null)
  const [meta, setMeta] = useState<TestMeta | null>(null)
  const [tab, setTab] = useState<Tab>('questions')
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => svc.test(testId).then(setT).catch((e) => setError(errorMessage(e))), [testId])
  useEffect(() => { void load(); svc.meta().then(setMeta).catch(() => {}) }, [load])

  async function act(fn: () => Promise<AdmTest>, done: string) {
    setError(null)
    try { setT(await fn()); toast(`✓ ${done}`) } catch (e) { setError(errorMessage(e)) }
  }
  async function save(patch: Partial<TestInput>) {
    if (!t) return
    await act(() => svc.updateTest(t.test_id, { title: t.title, grade_applying: t.grade_applying, instructions: t.instructions,
      duration_minutes: t.duration_minutes, sections: t.sections, shuffle: t.shuffle, proctoring_config: t.proctoring_config,
      scoring_config: t.scoring_config, ...patch }), 'Saved')
  }

  if (!t) return <div className="mx-auto max-w-6xl p-4 md:p-8">{error ? <p role="alert" className="text-sm text-bad">{error}</p> : <div className="skeleton h-96" />}</div>
  const editable = t.status === 'DRAFT'
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-8">
      <header className="flex flex-wrap items-start gap-3">
        <Link to="/teacher/admissions" className="mt-1 rounded-lg p-1.5 text-ink-300 hover:bg-ink-800 hover:text-fg" aria-label="Back to admissions"><ArrowLeft className="h-5 w-5" /></Link>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium uppercase tracking-wide text-brand-600">Admission test · {t.grade_applying}</div>
          <h1 className="font-display text-2xl font-bold text-fg">{t.title}</h1>
          <p className="text-xs text-ink-500">{t.question_count} questions · {Number(t.academic_marks)} academic marks · {t.duration_minutes} min</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={t.status === 'PUBLISHED' ? 'ok' : t.status === 'DRAFT' ? 'warn' : 'neutral'}>{t.status.toLowerCase()}</Badge>
          {t.status === 'DRAFT' && <Button onClick={() => act(() => svc.publish(t.test_id), 'Published — you can now launch it for candidates')} id="publish-test"><Rocket className="h-4 w-4" /> Publish</Button>}
          {t.status === 'PUBLISHED' && t.sessions === 0 && <Button variant="secondary" onClick={() => act(() => svc.unpublish(t.test_id), 'Back to draft')}><Undo2 className="h-4 w-4" /> Unpublish</Button>}
          {t.status === 'PUBLISHED' && <Button variant="ghost" onClick={() => act(() => svc.archive(t.test_id), 'Archived')}><Archive className="h-4 w-4" /> Archive</Button>}
        </div>
      </header>
      {!editable && <p className="flex items-center gap-2 rounded-xl border border-line bg-ink-800 px-3 py-2 text-sm text-ink-300"><Lock className="h-4 w-4" />
        {t.status === 'PUBLISHED' ? (t.sessions ? 'Published and in use: questions and settings are locked.' : 'Published: unpublish to change questions or settings.') : 'Archived.'}</p>}
      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      <Tabs items={[{ id: 'questions', label: 'Questions', icon: ClipboardList, count: t.question_count }, { id: 'settings', label: 'Settings', icon: Pencil },
        { id: 'proctoring', label: 'Proctoring', icon: ShieldCheck }, { id: 'scoring', label: 'Scoring', icon: Check }]} value={tab} onChange={setTab} />
      {tab === 'questions' && <Questions t={t} editable={editable} reload={() => void load()} />}
      {tab === 'settings' && <Settings t={t} editable={editable} onSave={save} />}
      {tab === 'proctoring' && meta && <ProctoringSettings value={t.proctoring_config} meta={meta} editable={editable} onSave={(p) => save({ proctoring_config: p })} />}
      {tab === 'scoring' && <ScoringSettings value={t.scoring_config} editable={editable} onSave={(s) => save({ scoring_config: s })} />}
    </div>
  )
}

function Questions({ t, editable, reload }: { t: AdmTest; editable: boolean; reload: () => void }) {
  const [dialog, setDialog] = useState<null | 'import' | 'hq' | 'draft' | { q: AdmQuestion | null; section: string }>(null)
  const [error, setError] = useState<string | null>(null)
  const qs = t.questions ?? []
  const done = () => { setDialog(null); reload() }

  async function run(fn: () => Promise<unknown>) {
    setError(null)
    try { await fn(); reload() } catch (e) { setError(errorMessage(e)) }
  }
  async function move(q: AdmQuestion, dir: -1 | 1) {
    const ids = qs.map((x) => x.question_id)
    const i = ids.indexOf(q.question_id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    await run(() => svc.reorder(t.test_id, ids))
  }
  const approve = (q: AdmQuestion) => run(() => svc.updateQuestion(q.question_id, {
    section: q.section, qtype: q.qtype, prompt: q.prompt, options: q.options, answer_key: q.answer_key, rubric: q.rubric, model_answer: q.model_answer,
    marks: Number(q.marks), topic: q.topic, difficulty: q.difficulty, hq_dimension: q.hq_dimension, status: 'APPROVED' }))

  return (
    <div className="space-y-4">
      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialog('import')} id="open-import"><Download className="h-4 w-4" /> Import from my assessments</Button>
          {t.sections.some((s) => s.kind === 'HQ') && <Button variant="secondary" onClick={() => setDialog('hq')} id="open-hq-bank"><ShieldCheck className="h-4 w-4" /> HQ item bank</Button>}
          <Button variant="secondary" onClick={() => setDialog('draft')}><Sparkles className="h-4 w-4" /> Draft with AI</Button>
          <Button variant="ghost" onClick={() => setDialog({ q: null, section: t.sections[0].key })}><Plus className="h-4 w-4" /> Add question</Button>
        </div>
      )}
      {t.drafts > 0 && <p className="text-sm text-warn">{t.drafts} drafted item{t.drafts === 1 ? '' : 's'} to review and approve before publishing.</p>}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      {t.sections.map((s) => {
        const items = qs.filter((q) => q.section === s.key)
        const marks = items.reduce((n, q) => n + (s.kind === 'HQ' ? 0 : Number(q.marks)), 0)
        return (
          <Card key={s.key}>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle>{s.title} <span className="text-sm font-normal text-ink-500">· {items.length} items{s.kind !== 'HQ' ? ` · ${marks} marks` : ''}</span></CardTitle>
              <Badge tone={s.kind === 'HQ' ? 'aqua' : 'neutral'}>{s.kind}</Badge>
            </CardHeader>
            <CardContent>
              {items.length === 0 ? <p className="rounded-xl border border-dashed border-line p-5 text-center text-sm text-ink-500">
                {s.kind === 'HQ' ? 'Add the standard set from the HQ item bank, or draft items with AI.' : 'Import questions from your Assignments and Online tests.'}</p> : (
                <ol className="divide-y divide-line">
                  {items.map((q) => (
                    <li key={q.question_id} className="flex flex-wrap items-start gap-3 py-2.5">
                      <span className="w-6 pt-0.5 text-right text-xs tabular-nums text-ink-500">{qs.indexOf(q) + 1}.</span>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm text-fg">{q.prompt}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
                          <Badge>{QTYPE_LABEL[q.qtype]}</Badge>
                          {q.hq_dimension && <Badge tone="aqua">{q.hq_dimension}</Badge>}
                          {s.kind !== 'HQ' && <span>{Number(q.marks)} mark{Number(q.marks) === 1 ? '' : 's'}</span>}
                          <span>· {ORIGIN[q.origin]}</span>
                          {q.source_label && <span className="truncate">· From: {q.source_label}</span>}
                          {q.status === 'DRAFT' && <Badge tone="warn">Draft</Badge>}
                        </div>
                      </div>
                      {editable && (
                        <div className="flex items-center gap-0.5">
                          {q.status === 'DRAFT' && <Button size="sm" variant="secondary" onClick={() => approve(q)} aria-label={`Approve question ${qs.indexOf(q) + 1}`}><Check className="h-3.5 w-3.5" /> Approve</Button>}
                          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Move question ${qs.indexOf(q) + 1} up`} onClick={() => move(q, -1)}><ArrowUp className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Move question ${qs.indexOf(q) + 1} down`} onClick={() => move(q, 1)}><ArrowDown className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Edit question ${qs.indexOf(q) + 1}`} onClick={() => setDialog({ q, section: q.section })}><Pencil className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Delete question ${qs.indexOf(q) + 1}`}
                            onClick={() => { if (confirm('Delete this question from the admission test?')) void run(() => svc.deleteQuestion(q.question_id)) }}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        )
      })}
      {dialog === 'import' && <ImportDialog testId={t.test_id} sections={t.sections} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'hq' && <HqBankDialog testId={t.test_id} defaultBand={t.age_band} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'draft' && <DraftDialog testId={t.test_id} sections={t.sections} defaultBand={t.age_band} onClose={() => setDialog(null)} onDone={done} />}
      {dialog && typeof dialog === 'object' && (
        <QuestionDialog sections={t.sections} question={dialog.q} defaultSection={dialog.section} onClose={() => setDialog(null)}
          onSave={async (q) => { if (dialog.q) await svc.updateQuestion(dialog.q.question_id, q); else await svc.addQuestion(t.test_id, q); done() }} />
      )}
    </div>
  )
}

function Settings({ t, editable, onSave }: { t: AdmTest; editable: boolean; onSave: (p: Partial<TestInput>) => Promise<void> }) {
  const [f, setF] = useState({ title: t.title, grade_applying: t.grade_applying, duration_minutes: t.duration_minutes, instructions: t.instructions ?? '' })
  const [sections, setSections] = useState<AdmSection[]>(t.sections)
  const [shuffle, setShuffle] = useState(t.shuffle)
  async function submit(e: FormEvent) {
    e.preventDefault()
    await onSave({ ...f, instructions: f.instructions.trim() || null, sections, shuffle })
  }
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'section'
  return (
    <Card><CardContent className="pt-5">
      <form onSubmit={submit} className="space-y-4">
        <fieldset disabled={!editable} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_12rem_10rem]">
            <div><Label htmlFor="t-title">Title</Label><Input id="t-title" required minLength={2} maxLength={300} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
            <div><Label htmlFor="t-grade">Grade applying for</Label><Input id="t-grade" required maxLength={64} value={f.grade_applying} onChange={(e) => setF({ ...f, grade_applying: e.target.value })} /></div>
            <div><Label htmlFor="t-dur">Duration (min)</Label><Input id="t-dur" type="number" min={5} max={300} value={f.duration_minutes} onChange={(e) => setF({ ...f, duration_minutes: Number(e.target.value) || 5 })} /></div>
          </div>
          <div><Label htmlFor="t-inst">Instructions for the candidate</Label><Textarea id="t-inst" rows={3} maxLength={5000} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></div>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-300">Sections</legend>
            {sections.map((s, i) => (
              <div key={i} className="flex gap-2">
                <Input aria-label={`Section ${i + 1} title`} className="h-9" maxLength={80} value={s.title}
                  onChange={(e) => setSections(sections.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                <Select aria-label={`Section ${i + 1} kind`} className="h-9 w-40" value={s.kind}
                  onChange={(e) => setSections(sections.map((x, j) => (j === i ? { ...x, kind: e.target.value as SectionKind } : x)))}>
                  {['ACADEMIC', 'APTITUDE', 'LANGUAGE', 'HQ'].map((k) => <option key={k}>{k}</option>)}</Select>
                {sections.length > 1 && <Button size="icon" variant="ghost" className="h-9 w-9" aria-label={`Remove section ${i + 1}`} onClick={() => setSections(sections.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>}
              </div>
            ))}
            {sections.length < 6 && <Button size="sm" variant="ghost" onClick={() => {
              const title = `Section ${sections.length + 1}`
              let key = slug(title)
              while (sections.some((s) => s.key === key)) key = `${key}-x`
              setSections([...sections, { key, title, kind: 'ACADEMIC' }])
            }}><Plus className="h-3.5 w-3.5" /> Section</Button>}
          </fieldset>
          <div className="flex flex-wrap gap-4 text-sm text-ink-100">
            <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-brand-500" checked={shuffle.questions} onChange={(e) => setShuffle({ ...shuffle, questions: e.target.checked })} /> Shuffle questions within each section</label>
            <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-brand-500" checked={shuffle.options} onChange={(e) => setShuffle({ ...shuffle, options: e.target.checked })} /> Shuffle answer options</label>
          </div>
        </fieldset>
        {editable && <div className="flex justify-end"><Button type="submit">Save settings</Button></div>}
      </form>
    </CardContent></Card>
  )
}

function ProctoringSettings({ value, meta, editable, onSave }: { value: ProctoringConfig; meta: TestMeta; editable: boolean; onSave: (p: ProctoringConfig) => Promise<void> }) {
  const [p, setP] = useState(value)
  const preset = meta.presets[p.preset]
  return (
    <Card><CardContent className="space-y-4 pt-5">
      <fieldset disabled={!editable} className="space-y-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Preset">
          {(['strict', 'standard', 'lenient'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={p.preset === k} onClick={() => setP({ ...p, preset: k })}
              className={cn('cursor-pointer rounded-xl border px-4 py-2 text-left text-sm', p.preset === k ? 'border-brand-400/60 bg-brand-500/10' : 'border-line')}>
              <div className="font-medium capitalize text-fg">{k}</div>
              <div className="text-xs text-ink-500">auto-submit at {meta.presets[k].max_warnings} warnings · {meta.presets[k].critical_limit} critical · integrity &lt; {meta.presets[k].auto_submit_below}</div>
            </button>
          ))}
        </div>
        <p className="text-xs text-ink-500">Points ×{preset.points}, durations ×{preset.durations}. The first {meta.tunables.calibration_seconds} s after the start only nudge.</p>
        <div className="flex flex-wrap gap-4 text-sm text-ink-100">
          <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-brand-500" checked={p.require_camera} onChange={(e) => setP({ ...p, require_camera: e.target.checked })} /> Require camera</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-brand-500" checked={p.require_screen_share} onChange={(e) => setP({ ...p, require_screen_share: e.target.checked })} /> Require entire-screen sharing</label>
        </div>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <caption className="sr-only">Proctoring rules</caption>
            <thead className="bg-ink-800 text-xs text-ink-300"><tr><th className="px-3 py-2 text-left font-medium">Rule</th><th className="px-3 py-2 text-left font-medium">Severity</th>
              <th className="px-3 py-2 text-right font-medium">Points / cap</th><th className="px-3 py-2 text-right font-medium">On</th></tr></thead>
            <tbody>{meta.flags.filter((f) => f.code !== 'TIME_ANOMALY').map((f) => (
              <tr key={f.code} className="border-t border-line">
                <td className="px-3 py-1.5 text-fg">{f.label}<span className="ml-2 text-[11px] text-ink-500">{f.code}</span></td>
                <td className="px-3 py-1.5"><Badge tone={SEV_TONE[f.severity]}>{f.severity}</Badge></td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink-300">{f.points} / {f.cap}</td>
                <td className="px-3 py-1.5 text-right"><input type="checkbox" aria-label={`Rule ${f.label}`} className="h-4 w-4 accent-brand-500"
                  checked={p.rules[f.code] !== false} onChange={(e) => setP({ ...p, rules: { ...p.rules, [f.code]: e.target.checked } })} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </fieldset>
      {editable && <div className="flex justify-end"><Button onClick={() => onSave(p)}>Save proctoring</Button></div>}
    </CardContent></Card>
  )
}

function ScoringSettings({ value, editable, onSave }: { value: ScoringConfig; editable: boolean; onSave: (s: ScoringConfig) => Promise<void> }) {
  const [s, setS] = useState(value)
  const pct = (n: number) => Math.round(n * 100)
  return (
    <Card><CardContent className="space-y-4 pt-5">
      <fieldset disabled={!editable} className="space-y-4">
        <p className="text-sm text-ink-300">Composite = academic % × {pct(s.w_academic)}% + HQ composite × {pct(s.w_hq)}%. A Low integrity band shows the recommendation as “On hold – see integrity section”.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="w-academic">Academic weight (%)</Label>
            <Input id="w-academic" type="number" min={0} max={100} value={pct(s.w_academic)} onChange={(e) => { const a = Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100; setS({ ...s, w_academic: a, w_hq: Math.round((1 - a) * 100) / 100 }) }} /></div>
          <div><Label htmlFor="w-hq">HQ weight (%)</Label><Input id="w-hq" type="number" value={pct(s.w_hq)} readOnly /></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {([['strong', 'Strongly recommended ≥'], ['recommended', 'Recommended ≥'], ['borderline', 'Borderline ≥']] as const).map(([k, label]) => (
            <div key={k}><Label htmlFor={`band-${k}`}>{label}</Label>
              <Input id={`band-${k}`} type="number" min={0} max={100} value={s.bands[k]} onChange={(e) => setS({ ...s, bands: { ...s.bands, [k]: Number(e.target.value) || 0 } })} /></div>
          ))}
        </div>
        <p className="text-xs text-ink-500">Below borderline: “Not recommended at this time”.</p>
      </fieldset>
      {editable && <div className="flex justify-end"><Button onClick={() => onSave(s)}>Save scoring</Button></div>}
    </CardContent></Card>
  )
}
