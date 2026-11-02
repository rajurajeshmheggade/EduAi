import { useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { FilePlus2, FileStack, GitBranchPlus, Library, Lock, Sparkles, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label, Select } from '@/components/ui/field'
import { ErrorState, SkeletonPage } from '@/components/ui/loading'
import { Tabs } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toast'
import { BankPanel } from '@/components/question-generator/BankPanel'
import { GeneratorPanel } from '@/components/question-generator/GeneratorPanel'
import { PaperStyles } from '@/components/question-generator/shared'
import { useQgenMeta } from '@/lib/questionGen/useQgenMeta'
import { useAsync } from '@/lib/useAsync'
import { errorMessage } from '@/services/apiClient'
import { questionGenService } from '@/services/questionGenService'
import type { Lang, PaperSummary, QgenMeta } from '@/types/questionGen'

type Tab = 'generate' | 'papers' | 'bank'

/** Teacher → AI Question Generator (/teacher/question-generator[?tab=papers]) and Question Bank (/teacher/question-bank). */
export default function QuestionGenerator() {
  const [params] = useSearchParams()
  const { pathname } = useLocation()
  const nav = useNavigate()
  const tab: Tab = pathname.startsWith('/teacher/question-bank') ? 'bank' : params.get('tab') === 'papers' ? 'papers' : 'generate'
  const setTab = (t: Tab) => nav(t === 'bank' ? '/teacher/question-bank' : t === 'papers' ? '/teacher/question-generator?tab=papers' : '/teacher/question-generator')
  const meta = useQgenMeta()

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <PaperStyles />
      <header className="animate-fade-up">
        <h1 className="font-display text-3xl font-bold">AI Question <span className="text-gradient">Generator</span></h1>
        <p className="mt-1 text-sm text-ink-300">
          Pick a class, subject, chapter, topic and the learning content, choose the question types, and the AI writes questions only from that
          content — with answers, explanations and marks. Edit them into a question paper, save them to the question bank, publish and download.
        </p>
      </header>
      <Tabs<Tab> value={tab} onChange={setTab} items={[
        { id: 'generate', label: 'Generate', icon: Sparkles },
        { id: 'papers', label: 'Question papers', icon: FileStack },
        { id: 'bank', label: 'Question bank', icon: Library },
      ]} />
      {meta.error && <ErrorState title="The question generator could not load" message={meta.error} onRetry={meta.retry} />}
      {!meta.data && !meta.error && <SkeletonPage variant="detail" />}
      {meta.data && tab === 'generate' && <GeneratorPanel meta={meta.data} />}
      {meta.data && tab === 'papers' && <Papers meta={meta.data} />}
      {meta.data && tab === 'bank' && <BankPanel meta={meta.data} />}
    </div>
  )
}

function Papers({ meta }: { meta: QgenMeta }) {
  const nav = useNavigate()
  const list = useAsync((signal) => questionGenService.papers({ signal }), [])
  const [creating, setCreating] = useState(false)
  const [gone, setGone] = useState<Set<string>>(new Set())
  const papers = (list.data ?? []).filter((p) => !gone.has(p.paper_id))

  const remove = async (p: PaperSummary) => {
    if (!window.confirm(`Delete “${p.title}” (v${p.version})?${p.status === 'PUBLISHED' ? ' It is published.' : ''}`)) return
    try { await questionGenService.deletePaper(p.paper_id); setGone((s) => new Set(s).add(p.paper_id)); toast('✓ Paper deleted') }
    catch (e) { toast(errorMessage(e), 'error') }
  }
  const newVersion = async (p: PaperSummary) => {
    try { const v = await questionGenService.newVersion(p.paper_id); nav(`/teacher/question-generator/papers/${v.paper_id}`) }
    catch (e) { toast(errorMessage(e), 'error') }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-300">Drafts can be edited; published papers are final (create a new version to change one).</p>
        <Button onClick={() => setCreating(true)}><FilePlus2 className="h-4 w-4" /> New blank paper</Button>
      </div>
      {list.loading && !list.data && <SkeletonPage variant="table" />}
      {list.error && <ErrorState title="Could not load your papers" message={list.error} onRetry={list.retry} />}
      {list.data && !papers.length && (
        <p className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-ink-400">No question papers yet. Generate questions and add them to a new paper, or start a blank paper.</p>
      )}
      {papers.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="bg-ink-800/60 text-left text-xs uppercase tracking-wide text-ink-400">
              <tr><th className="px-4 py-2.5">Paper</th><th className="px-4 py-2.5">Class · Subject</th><th className="px-4 py-2.5">Questions</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Updated</th><th className="px-4 py-2.5"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {papers.map((p) => (
                <tr key={p.paper_id} className="border-t border-line">
                  <td className="px-4 py-2.5"><Link className="font-medium text-fg hover:text-brand-600" to={`/teacher/question-generator/papers/${p.paper_id}`}>{p.title}</Link>
                    {p.chapter && <div className="text-xs text-ink-400">{p.chapter}</div>}</td>
                  <td className="px-4 py-2.5 text-ink-300">{p.class_name} · {p.subject_name}</td>
                  <td className="px-4 py-2.5 tabular-nums text-ink-300">{p.question_count} · {p.total_marks} marks</td>
                  <td className="px-4 py-2.5"><Badge tone={p.status === 'PUBLISHED' ? 'ok' : 'warn'}>{p.status === 'PUBLISHED' ? <><Lock className="h-3 w-3" /> Published</> : 'Draft'} · v{p.version}</Badge></td>
                  <td className="px-4 py-2.5 text-ink-400">{new Date(p.updated_at).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <Link to={`/teacher/question-generator/papers/${p.paper_id}`} className="inline-flex h-8 items-center rounded-xl border border-line px-3 text-xs hover:border-brand-400/60">Open</Link>
                      {p.status === 'PUBLISHED' && <Button size="icon" variant="ghost" aria-label={`New version of ${p.title}`} onClick={() => void newVersion(p)}><GitBranchPlus className="h-4 w-4" /></Button>}
                      <Button size="icon" variant="ghost" aria-label={`Delete ${p.title}`} onClick={() => void remove(p)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <NewBlankPaper meta={meta} onClose={() => setCreating(false)} onCreated={(id) => nav(`/teacher/question-generator/papers/${id}`)} />}
    </div>
  )
}

function NewBlankPaper({ meta, onClose, onCreated }: { meta: QgenMeta; onClose: () => void; onCreated: (id: string) => void }) {
  const classes = useAsync((signal) => questionGenService.classes({ signal }), [])
  const [classCode, setClassCode] = useState('')
  const [subjectCode, setSubjectCode] = useState('')
  const [title, setTitle] = useState('')
  const [language, setLanguage] = useState<Lang>('en')
  const [busy, setBusy] = useState(false)
  const klass = classes.data?.find((c) => c.class_code === classCode)
  const create = async () => {
    setBusy(true)
    try {
      const p = await questionGenService.createPaper({ class_code: classCode, subject_code: subjectCode, title: title.trim(), language })
      onCreated(p.paper_id)
    } catch (e) { toast(errorMessage(e), 'error'); setBusy(false) }
  }
  return (
    <Dialog open onClose={onClose} title="New blank paper" description="Write questions yourself, generate them with AI or take them from the question bank.">
      {classes.error && <ErrorState message={classes.error} onRetry={classes.retry} />}
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="nb-class">Class</Label>
            <Select id="nb-class" value={classCode} onChange={(e) => { setClassCode(e.target.value); setSubjectCode('') }} disabled={!classes.data}>
              <option value="">{classes.loading ? 'Loading…' : 'Select class'}</option>
              {classes.data?.map((c) => <option key={c.class_code} value={c.class_code}>{c.class_name}</option>)}
            </Select></div>
          <div><Label htmlFor="nb-subject">Subject</Label>
            <Select id="nb-subject" value={subjectCode} onChange={(e) => setSubjectCode(e.target.value)} disabled={!klass}>
              <option value="">{klass ? 'Select subject' : 'Select a class first'}</option>
              {klass?.subjects.map((s) => <option key={s.subject_code} value={s.subject_code}>{s.subject_name}</option>)}
            </Select></div>
        </div>
        <div><Label htmlFor="nb-title">Paper title</Label><Input id="nb-title" maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Unit Test 2 — Electricity" /></div>
        <div className="w-56"><Label htmlFor="nb-lang">Language</Label>
          <Select id="nb-lang" value={language} onChange={(e) => setLanguage(e.target.value as Lang)}>
            {meta.languages.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </Select></div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => void create()} disabled={busy || !classCode || !subjectCode || title.trim().length < 2}>Create paper</Button>
      </div>
    </Dialog>
  )
}
