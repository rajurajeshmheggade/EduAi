import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bot, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ClipboardList, Eye, Layers, NotebookPen, PencilLine, Plus, Search, Trash2 } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { LessonPlanAssistant } from '@/components/lesson-plan/LessonPlanAssistant'
import { LessonPlanCreator } from '@/components/lesson-plan/LessonPlanCreator'
import { LessonPlanView } from '@/components/lesson-plan/LessonPlanView'
import { AiManualDialog, ConfirmDialog } from '@/components/lesson-plan/dialogs'
import { SessionManager } from '@/components/session-plan/SessionManager'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/field'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/services/apiClient'
import { lessonPlanService } from '@/services/lessonPlanService'
import type { LessonPlanRow, LpScope } from '@/types/lessonPlan'

const PAGE_SIZE = 10
type View = 'repo' | 'creator' | 'plan' | 'sessions' | 'assistant'

/** Teacher ▸ Lesson Plans — the Lesson Plan Repository and everything scoped to one plan (ported from Rapid).
    Repository → Create (AI Bot assistant | Manual 7-step creator) → Lesson Plan View → Session Manager. */
export default function LessonPlans() {
  const { user } = useAuth()
  const [scope, setScope] = useState<LpScope | null>(null)
  const [plans, setPlans] = useState<LessonPlanRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [klass, setKlass] = useState('all')
  const [subject, setSubject] = useState('all')
  const [lessonName, setLessonName] = useState('')
  const [page, setPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [createOpen, setCreateOpen] = useState(false)
  const [delTarget, setDelTarget] = useState<LessonPlanRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [view, setView] = useState<View>('repo')
  const [active, setActive] = useState<LessonPlanRow | null>(null)
  const [readOnly, setReadOnly] = useState(false)
  const [draft, setDraft] = useState<{ state: unknown; id: string | null } | null>(null)

  const loadPlans = useCallback(() => {
    lessonPlanService.listPlans().then((p) => { setPlans(p); setError(null) }).catch((e) => setError(errorMessage(e)))
  }, [])
  useEffect(() => {
    loadPlans()
    lessonPlanService.scope().then(setScope).catch((e) => setError(errorMessage(e)))
  }, [loadPlans])

  const classOpts = useMemo(() => scope?.classes ?? [], [scope])
  const subjectOpts = useMemo(() => {
    const src = klass === 'all' ? classOpts : classOpts.filter((c) => c.class_code === klass)
    const m = new Map<string, string>()
    src.forEach((c) => c.subjects.forEach((s) => m.set(s.subject_code, s.subject_name)))
    return [...m.entries()].map(([code, name]) => ({ code, name }))
  }, [classOpts, klass])

  const filtered = useMemo(() => (plans ?? []).filter((p) =>
    (klass === 'all' || p.classCode === klass) &&
    (subject === 'all' || p.subjectCode === subject) &&
    (!lessonName.trim() || p.title.toLowerCase().includes(lessonName.trim().toLowerCase()))), [plans, klass, subject, lessonName])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const cur = Math.min(page, totalPages)
  const rows = filtered.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE)
  const resetPage = () => { setPage(1); setPageInput('1') }
  const goPage = (n: number) => { const c = Math.min(Math.max(1, n), totalPages); setPage(c); setPageInput(String(c)) }

  const backToRepo = () => { setView('repo'); setActive(null); setDraft(null); loadPlans() }
  const openPlan = (p: LessonPlanRow, ro = false) => { setActive(p); setReadOnly(ro); setView('plan') }
  const editDraft = (p: LessonPlanRow) => {
    const state = p.plan?.__creatorState ?? null
    if (!state) toast('This draft predates resume support — opening a fresh plan.')
    setDraft({ state, id: p.id })
    setView('creator')
  }
  const createPlan = (mode: 'ai' | 'manual') => {
    setCreateOpen(false)
    if (mode === 'manual') { toast('Opening Lesson Plan Creator…'); setDraft(null); setView('creator'); return }
    setView('assistant')
  }
  const doDelete = async () => {
    if (!delTarget) return
    const t = delTarget
    setDeleting(true)
    try {
      await lessonPlanService.deletePlan(t.id)
      setPlans((xs) => (xs ?? []).filter((x) => x.id !== t.id))
      toast('Unit plan deleted successfully.', 'success')
    } catch (e) { toast(errorMessage(e, 'The lesson plan could not be deleted.'), 'error'); loadPlans() }
    finally { setDeleting(false); setDelTarget(null) }
  }
  // After the creator saves: drafts return to the repository, a completed plan opens in the view.
  const onCreatorSaved = async (id: string, completed: boolean) => {
    loadPlans()
    if (!completed) { setDraft(null); setView('repo'); return }
    try { openPlan(await lessonPlanService.getPlan(id)) } catch { setView('repo') }
  }

  if (!user) return null
  if (view === 'creator' && scope) {
    return <LessonPlanCreator scope={scope} defaultClassCode={klass !== 'all' ? klass : undefined}
      defaultSubjectCode={subject !== 'all' ? subject : undefined}
      draft={draft?.state ?? null} draftId={draft?.id ?? null} onBack={backToRepo} onSaved={onCreatorSaved} />
  }
  if (view === 'assistant' && scope) {
    return <LessonPlanAssistant scope={scope} onClose={backToRepo} onSaved={loadPlans} />
  }
  if (view === 'plan' && active) {
    return <LessonPlanView row={active} readOnly={readOnly} onBack={backToRepo} onSaved={(r) => { setActive(r); loadPlans() }} />
  }
  if (view === 'sessions' && active) {
    return <SessionManager plan={active} onBack={backToRepo} onChanged={loadPlans} />
  }

  const pageButtons = (() => {
    const max = 5
    if (totalPages <= max) return Array.from({ length: totalPages }, (_, i) => i + 1)
    const start = Math.max(1, Math.min(cur - Math.floor(max / 2), totalPages - max + 1))
    const end = start + max - 1
    const out: (number | '...')[] = Array.from({ length: max }, (_, i) => start + i)
    if (start > 1) { if (start > 2) out.unshift('...'); out.unshift(1) }
    if (end < totalPages) { if (end < totalPages - 1) out.push('...'); out.push(totalPages) }
    return out
  })()

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4 animate-fade-up">
        <div>
          <h1 className="font-display text-3xl font-bold text-fg">Lesson Plan <span className="text-gradient">Repository</span></h1>
          <p className="mt-1 text-sm text-ink-300">Manage and organize your lesson plans — build them with the AI Bot or step by step, then plan each session.</p>
        </div>
        <Button id="create-lesson-plan" onClick={() => setCreateOpen(true)} disabled={!scope}><Plus className="h-4 w-4" />Create new lesson plan</Button>
      </header>

      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      {scope && scope.classes.length === 0 && (
        <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">You are not assigned to any class subject yet, so lesson plans cannot be created. Ask your institution admin to assign you.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
          <Input aria-label="Search lesson name" placeholder="Search lesson name" className="pl-9" value={lessonName}
            onChange={(e) => { setLessonName(e.target.value); resetPage() }} />
        </div>
        <Select aria-label="Class" className="w-52" value={klass} onChange={(e) => { setKlass(e.target.value); setSubject('all'); resetPage() }}>
          <option value="all">All classes</option>
          {classOpts.map((c) => <option key={c.class_code} value={c.class_code}>{c.class_name}</option>)}
        </Select>
        <Select aria-label="Subject" className="w-48" value={subject} onChange={(e) => { setSubject(e.target.value); resetPage() }}>
          <option value="all">All subjects</option>
          {subjectOpts.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
        </Select>
      </div>

      <Card className="overflow-hidden">
        {plans === null ? <div className="m-5 skeleton h-48" /> : filtered.length === 0 ? (
          <div className="grid min-h-56 place-items-center p-10 text-center">
            <div>
              <NotebookPen className="mx-auto mb-3 h-10 w-10 text-ink-500" />
              <p className="font-medium text-fg">No Lesson Plans Found</p>
              <p className="mt-1 text-sm text-ink-300">{plans.length ? 'Try a different search or filter.' : 'Create your first lesson plan with the AI Bot or the step-by-step creator.'}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-ink-800 text-left text-xs font-semibold uppercase tracking-wide text-ink-300">
                    <th className="w-16 px-4 py-3">SL No.</th><th className="px-4 py-3">Lesson Plan Title</th><th className="px-4 py-3">Grade</th>
                    <th className="px-4 py-3">Subject</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Session</th><th className="w-36 px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p, i) => {
                    const done = p.isCompleted
                    const ai = p.source === 'ai_bot'
                    return (
                      <tr key={p.id} className="border-t border-line transition-colors hover:bg-ink-800/50">
                        <td className="px-4 py-3.5 text-ink-500">{(cur - 1) * PAGE_SIZE + i + 1}</td>
                        <td className="px-4 py-3.5 font-medium text-fg">
                          <span className="inline-flex items-center gap-2">{p.title}
                            {ai ? <Bot aria-label="Created with AI Bot" className="h-4 w-4 shrink-0 text-purple-500" />
                              : <ClipboardList aria-label="Created manually" className="h-4 w-4 shrink-0 text-brand-400" />}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-ink-300">{p.className}</td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-ink-300">{p.subjectName}</td>
                        <td className="px-4 py-3.5"><Badge tone={done ? 'ok' : 'warn'}>{done ? 'Completed' : 'Draft'}</Badge></td>
                        <td className="px-4 py-3.5">
                          <button type="button" disabled={!done} onClick={() => { setActive(p); setView('sessions') }} id={`sessions-${p.id}`}
                            title={done ? 'Open the Session Manager' : 'Complete the draft to plan sessions'}
                            className={cn('inline-flex items-center gap-2 rounded-full border py-1 pl-3.5 pr-1.5 text-sm font-medium transition-all',
                              done ? 'cursor-pointer border-brand-400/30 bg-brand-500/10 text-fg hover:bg-brand-500/20 hover:shadow-glow' : 'cursor-not-allowed border-line bg-ink-800 text-ink-500')}>
                            <Layers className="h-3.5 w-3.5" />Session
                            <span className={cn('grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-xs font-semibold', done ? 'bg-brand-500/20 text-brand-600' : 'bg-ink-700 text-ink-500')}>{p.sessionCount}</span>
                          </button>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex gap-1">
                            <IconAction title={done ? 'Edit' : 'Edit Draft'} className={done ? 'text-purple-600 hover:bg-purple-500/10' : 'text-warn hover:bg-warn/10'}
                              onClick={() => (done ? openPlan(p) : editDraft(p))}><PencilLine className="h-4 w-4" /></IconAction>
                            <IconAction title={done ? 'Preview' : 'Complete the draft to preview'} disabled={!done} className="text-ok hover:bg-ok/10"
                              onClick={() => openPlan(p, true)}><Eye className="h-4 w-4" /></IconAction>
                            <IconAction title="Delete" className="text-bad hover:bg-bad/10" onClick={() => setDelTarget(p)}><Trash2 className="h-4 w-4" /></IconAction>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {filtered.length > PAGE_SIZE && (
              <div className="flex flex-col items-center gap-2 border-t border-line px-4 py-5">
                <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-xl border border-line bg-ink-800 px-3 py-2">
                  <PageBtn disabled={cur === 1} onClick={() => goPage(1)} label="First page"><ChevronsLeft className="h-4 w-4" /></PageBtn>
                  <PageBtn disabled={cur === 1} onClick={() => goPage(cur - 1)} label="Previous page"><ChevronLeft className="h-4 w-4" />Prev</PageBtn>
                  {pageButtons.map((n, idx) => n === '...'
                    ? <span key={`d${idx}`} className="px-1 font-semibold text-ink-500">…</span>
                    : <PageBtn key={n} active={n === cur} onClick={() => goPage(n)} label={`Page ${n}`}>{n}</PageBtn>)}
                  <span className="mx-1.5 flex items-center gap-1.5 text-xs text-ink-500">Go to:
                    <input value={pageInput} inputMode="numeric" aria-label="Page number"
                      onChange={(e) => { const v = e.target.value.replace(/[^0-9]/g, ''); setPageInput(v ? String(Math.min(Math.max(1, parseInt(v, 10)), totalPages)) : '') }}
                      onBlur={() => goPage(parseInt(pageInput, 10) || 1)} onKeyDown={(e) => { if (e.key === 'Enter') goPage(parseInt(pageInput, 10) || 1) }}
                      className="h-8 w-12 rounded-lg border border-line bg-ink-900 text-center text-sm text-fg focus:border-brand-400/70 focus:outline-none" />
                    / {totalPages}</span>
                  <PageBtn disabled={cur === totalPages} onClick={() => goPage(cur + 1)} label="Next page">Next<ChevronRight className="h-4 w-4" /></PageBtn>
                  <PageBtn disabled={cur === totalPages} onClick={() => goPage(totalPages)} label="Last page"><ChevronsRight className="h-4 w-4" /></PageBtn>
                </div>
                <span className="text-xs text-ink-500">{filtered.length} results • Page {cur} of {totalPages}</span>
              </div>
            )}
          </>
        )}
      </Card>

      {createOpen && <AiManualDialog onClose={() => setCreateOpen(false)} onPick={createPlan}
        badge="New Lesson Plan" title="Create Lesson Plan" subtitle="Choose how you'd like to build your next lesson plan."
        aiDesc="Generate a personalized lesson plan instantly with AI." manualDesc="Build your lesson plan step by step with complete control." />}

      {delTarget && <ConfirmDialog title="Delete Unit plan?" busy={deleting} onClose={() => setDelTarget(null)} onConfirm={doDelete}
        message={<>Are you sure you want to delete <b className="text-fg">{delTarget.title}</b>? Its sessions are removed with it. This action cannot be undone.</>} />}
    </div>
  )
}

function IconAction({ title, className, disabled, onClick, children }: { title: string; className?: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick}
      className={cn('grid h-8 w-8 cursor-pointer place-items-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:text-ink-500 disabled:hover:bg-transparent', className)}>
      {children}
    </button>
  )
}

function PageBtn({ children, active, disabled, onClick, label }: { children: React.ReactNode; active?: boolean; disabled?: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" aria-label={label} aria-current={active ? 'page' : undefined} disabled={disabled} onClick={onClick}
      className={cn('inline-flex h-8 min-w-8 cursor-pointer items-center justify-center gap-1 rounded-lg px-2 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:text-ink-500',
        active ? 'rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-glow' : 'text-ink-300 hover:bg-ink-700')}>
      {children}
    </button>
  )
}
