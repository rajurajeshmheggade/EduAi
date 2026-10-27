import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { ConfirmDialog } from '@/components/lesson-plan/dialogs'
import { SETTINGS, STAGES } from '@/components/lesson-plan/data'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/field'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { lessonPlanService, sessionErrorMessage, sessionPlanService } from '@/services/lessonPlanService'
import type { AssetType, LessonPlanRow, LibraryItem, LibraryResponse, LpChapter } from '@/types/lessonPlan'
import { blankStage, isCardKind, kindOfType, type PickedResource, type ResourcesValue, type StageValue } from './resourcesModel'
import { AddResourceDialog } from './resources/AddResourceDialog'
import { BrowseDialog } from './resources/BrowseDialog'
import { DescEditor } from './resources/DescEditor'
import { LibraryPanel, type LibSel } from './resources/LibraryPanel'
import { PickedTray } from './resources/PickedTray'
import { PreviewModal } from './resources/PreviewModal'
import { ReviewStep } from './resources/ReviewStep'

/* Session Resources (port of Rapid's SessionResources.jsx) — the two-step indicator, the Resource Category /
   Class setting / Duration tag bar, the stage Description editor, the picked-resources tray beside the
   collapsible Resource Library, Browse, Preview (with Launch), and Previous / Remove all / Next.

   The library is scoped to the lesson plan's OWN class + subject (locked, like Rapid's scopeLocked); only the
   chapter is browsed. The value model and pure helpers live in resourcesModel.ts and are re-exported here. */

// Part of this module's contract (Rapid exported them from SessionResources.jsx); defined in resourcesModel.ts.
// oxlint-disable-next-line react/only-export-components
export { defaultResources, kindOfType, resourcesFromSession, stagesPayload } from './resourcesModel'
export type { PickedResource, ResourcesValue, StageValue } from './resourcesModel'

const EMPTY_LIB: LibraryResponse = { assetType: 'Resources', total: 0, counts: {}, groups: [] }
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)
const clip = (t: string) => (t.length > 48 ? `${t.slice(0, 48).trimEnd()}…` : t)

/** The library reply read defensively — a group without items is dropped, not rendered as a crash. */
function normLib(res: LibraryResponse | null | undefined): LibraryResponse {
  const groups = (Array.isArray(res?.groups) ? res.groups : [])
    .filter((g) => g && Array.isArray(g.items))
    .map((g) => ({ chapter: String(g.chapter || 'Unassigned'), items: g.items.filter((x) => x && x.title) }))
  return { assetType: res?.assetType ?? 'Resources', total: Number(res?.total) || 0, counts: res?.counts ?? {}, groups }
}

/** The identity of ONE resource: its id within its own source. Only an item with no id falls back to a
 *  descriptor — and that carries the type and url as well as the name, so same-titled items stay distinct. */
function resKey(r: { sourceKind?: string; resourceId?: string | null; resourceType?: string; url?: string; name?: string; title?: string }) {
  const kind = r.sourceKind || 'resource'
  if (r.resourceId) return `${kind}::id:${r.resourceId}`
  return `${kind}::n:${r.resourceType || ''}|${r.url || ''}|${r.name || r.title || ''}`
}

function StepIndicator({ step, onStep1 }: { step: 1 | 2; onStep1: () => void }) {
  return (
    <div className="glass flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3">
      {[{ n: 1 as const, t: 'Select Resources' }, { n: 2 as const, t: 'Preview and Save' }].map((s, si) => {
        const on = step === s.n
        const done = step > s.n
        return (
          <div key={s.n} className="contents">
            {si > 0 && <span className={cn('h-0.5 min-w-8 max-w-[120px] flex-1 rounded-full transition-colors duration-200', step > 1 ? 'bg-brand-500' : 'bg-ink-700')} />}
            <button type="button" onClick={() => { if (s.n === 1) onStep1() }} disabled={!(s.n === 1 && step === 2)} aria-current={on ? 'step' : undefined}
              className="inline-flex items-center gap-2 enabled:cursor-pointer disabled:cursor-default">
              <span className={cn('inline-flex h-7 w-7 items-center justify-center rounded-full text-[12.5px] font-semibold transition-colors',
                on ? 'bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-glow' : done ? 'bg-ok/15 text-ok' : 'bg-ink-800 text-ink-500')}>
                {done ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : s.n}
              </span>
              <span className={cn('whitespace-nowrap text-[13px]', on ? 'font-semibold text-fg' : 'font-medium text-ink-500')}>{s.t}</span>
            </button>
          </div>
        )
      })}
    </div>
  )
}

const Req = () => <span className="ml-0.5 text-bad">*</span>

export function SessionResources({ plan, value: v, onChange, previewOnly = false, onClosePreview, objectives = [] }: {
  plan: LessonPlanRow
  value: ResourcesValue
  onChange: (v: ResourcesValue) => void
  /** Only the Preview modal (the Session Manager's Preview of a saved session). */
  previewOnly?: boolean
  onClosePreview?: () => void
  /** The ELOs selected for the session — shown as the Preview's objectives. */
  objectives?: unknown[]
}) {
  const st: StageValue = v.stages[v.stage] ?? blankStage(v.stage)
  const patchStage = (patch: Partial<StageValue>) => onChange({ ...v, stages: { ...v.stages, [v.stage]: { ...st, ...patch } } })
  const patchFiles = (files: PickedResource[]) => patchStage({ files })

  const [step, setStep] = useState<1 | 2>(1)
  const [openStages, setOpenStages] = useState<Record<string, boolean>>({})
  const hasFiles = (s: string) => (v.stages[s]?.files.length ?? 0) > 0
  const stageOpen = (s: string) => (hasOwn(openStages, s) ? openStages[s] : hasFiles(s))
  const toggleStage = (s: string) => setOpenStages((o) => ({ ...o, [s]: !(hasOwn(o, s) ? o[s] : hasFiles(s)) }))
  const [prevOpen, setPrevOpen] = useState(previewOnly)
  const closePrev = () => { if (previewOnly) onClosePreview?.(); else setPrevOpen(false) }
  const [showErr, setShowErr] = useState(false)
  const settingErr = showErr && (!st.setting || st.setting === 'Select')
  // Duration is per stage — it sits in the per-stage tag bar beside Resource Category and Class setting.
  const durErr = showErr && !(parseInt(st.duration, 10) > 0)
  const [libOpen, setLibOpen] = useState(true)
  const [q, setQ] = useState('')
  const [countKey, setCountKey] = useState(0)
  const [pulseFrom, setPulseFrom] = useState(-1)
  const pulseTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(pulseTimer.current), [])

  // Prerequisites on the Preview header — only when the saved plan actually carries one.
  const planJson = (plan.plan ?? {}) as Record<string, unknown>
  const prereq = [planJson.prerequisiteKnowledge, planJson.prerequisite, planJson.priorKnowledge].find((x): x is string => typeof x === 'string' && !!x.trim()) ?? ''

  // ── Scope: locked to the lesson plan's own class + subject ─────────────────────────────────────────
  const classCode = plan.classCode || ''
  const subjectCode = plan.subjectCode || ''
  const scopeOk = !!(classCode && subjectCode)
  const scopeLine = [plan.className || v.klass, plan.subjectName || v.subject].filter(Boolean).join(' · ')

  // ── Library state ───────────────────────────────────────────────────────────────────────────────────
  const [assetType, setAssetType] = useState<AssetType>('Resources')
  const [libSel, setLibSel] = useState<LibSel | null>(null)
  const [browseOpen, setBrowseOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [delTarget, setDelTarget] = useState<LibraryItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [chapters, setChapters] = useState<LpChapter[] | null>(null)
  const [chaptersBusy, setChaptersBusy] = useState(false)
  const [lib, setLib] = useState<LibraryResponse>(EMPTY_LIB)
  const [libBusy, setLibBusy] = useState(false)
  const [libErr, setLibErr] = useState('')
  const libSeq = useRef(0)

  const ensureChapters = () => {
    if (!scopeOk || chapters || chaptersBusy) return
    setChaptersBusy(true)
    lessonPlanService.chapters(classCode, subjectCode)
      .then((rows) => setChapters(Array.isArray(rows) ? rows : []))
      .catch(() => setChapters([]))
      .finally(() => setChaptersBusy(false))
  }
  const openBrowse = () => { if (!scopeOk) return; ensureChapters(); setBrowseOpen(true) }
  const openAdd = () => { if (!scopeOk) return; ensureChapters(); setAddOpen(true) }

  // Re-fetched when the browsed chapter, the asset type or the (debounced) search change. A stale reply
  // (an earlier search answering late) is ignored. Tests are not narrowed by chapter — the server already
  // groups each under its own chapter.
  const loadLibrary = useCallback((sel: LibSel, type: AssetType, search: string) => {
    if (!scopeOk) return
    const seq = ++libSeq.current
    setLibBusy(true); setLibErr('')
    sessionPlanService.resourceLibrary({ classCode, subjectCode, chapter: sel.chapter || undefined, assetType: type, search: search || undefined })
      .then((res) => { if (seq === libSeq.current) setLib(normLib(res)) })
      .catch((e: unknown) => {
        if (seq !== libSeq.current) return
        setLib(EMPTY_LIB)
        setLibErr(sessionErrorMessage(e, 'The resource library could not be loaded.'))
      })
      .finally(() => { if (seq === libSeq.current) setLibBusy(false) })
  }, [scopeOk, classCode, subjectCode])

  useEffect(() => {
    if (!libSel || previewOnly) return undefined
    const h = window.setTimeout(() => loadLibrary(libSel, assetType, q.trim()), q ? 300 : 0)
    return () => window.clearTimeout(h)
  }, [libSel, assetType, q, loadLibrary, previewOnly])
  const reload = () => { if (libSel) loadLibrary(libSel, assetType, q.trim()) }

  const assetCount = (t: AssetType) => (hasOwn(lib.counts, t) ? (lib.counts[t] ?? null) : (t === assetType ? lib.total : null))
  const isAdded = (x: LibraryItem) => st.files.some((f) => resKey(f) === resKey(x))
  const addLib = (x: LibraryItem) => {
    if (isAdded(x)) return
    const from = st.files.length
    patchFiles([...st.files, {
      // The row id carries the same identity, so removing one of several same-named rows removes that one.
      id: `${resKey(x)}-${Date.now()}`,
      resourceId: x.resourceId || null,
      sourceKind: x.sourceKind || 'resource',
      name: x.title,
      type: isCardKind(x.kind) ? x.kind : kindOfType(x.resourceType),
      resourceType: x.resourceType || '',
      url: x.url || '',
      chapter: x.chapter || '',
      meta: x.meta || '',
    }])
    setCountKey((k) => k + 1)
    setPulseFrom(from)
    window.clearTimeout(pulseTimer.current)
    pulseTimer.current = window.setTimeout(() => setPulseFrom(-1), 950)
  }

  const removeLibraryItem = () => {
    const x = delTarget
    if (!x) return
    setDeleting(true)
    sessionPlanService.deleteResource(x.resourceId)
      .then(() => { toast(`“${clip(x.title)}” removed from the library.`, 'success'); reload() })
      .catch((e: unknown) => toast(sessionErrorMessage(e, 'The resource could not be removed.'), 'error'))
      .finally(() => { setDeleting(false); setDelTarget(null) })
  }

  // Next says which field is at fault, in the same words as the field's own error — those sit up in the tag
  // bar, which is off-screen on a long description, so the click would otherwise read as Next not working.
  const next = () => {
    const missing: string[] = []
    if (!st.setting || st.setting === 'Select') missing.push('setting')
    if (!(parseInt(st.duration, 10) > 0)) missing.push('duration')
    setShowErr(missing.length > 0)
    if (missing.length) {
      toast(missing.length === 2 ? 'Select a class setting and enter a duration for this stage.'
        : missing[0] === 'setting' ? 'Select a class setting for this stage.' : 'Enter a duration for this stage.', 'error')
      return
    }
    setStep(2)
  }

  const preview = prevOpen ? <PreviewModal v={v} objectives={objectives} prereq={prereq} onClose={closePrev} /> : null
  if (previewOnly) return preview

  const si = STAGES.indexOf(v.stage)
  return (
    <div className="flex flex-col gap-4">
      <StepIndicator step={step} onStep1={() => setStep(1)} />

      {step === 2 && (
        <ReviewStep v={v} isOpen={stageOpen} onToggle={toggleStage} onBack={() => setStep(1)} onPreview={() => setPrevOpen(true)}
          onRemove={(s, id) => { const ss = v.stages[s]; if (ss) onChange({ ...v, stages: { ...v.stages, [s]: { ...ss, files: ss.files.filter((f) => f.id !== id) } } }) }} />
      )}

      <div className={step === 1 ? 'contents' : 'hidden'}>
        {/* Tag bar */}
        <div className="glass rounded-2xl px-4 pb-[18px] pt-4">
          <div className="grid gap-3 md:grid-cols-[minmax(200px,320px)_minmax(160px,220px)_minmax(190px,240px)]">
            <div className="min-w-0">
              <label htmlFor="sr-stage" className="mb-1.5 block text-[13px] font-medium text-fg">Resource Category<Req /></label>
              <Select id="sr-stage" value={v.stage} onChange={(e) => onChange({ ...v, stage: e.target.value })}>
                {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
            <div className="min-w-0">
              <label htmlFor="sr-setting" className="mb-1.5 block text-[13px] font-medium text-fg">Class setting<Req /></label>
              <Select id="sr-setting" value={st.setting} onChange={(e) => patchStage({ setting: e.target.value })} aria-invalid={settingErr || undefined}
                className={cn(settingErr && 'border-bad focus:border-bad')}>
                {SETTINGS.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
              {settingErr && <span className="mt-1 block text-[11.5px] text-bad">Select a class setting</span>}
            </div>
            <div className="min-w-0">
              <label htmlFor="sr-duration" className="mb-1.5 block text-[13px] font-medium text-fg">Duration (minutes)<Req /></label>
              {/* Digits only, max 3, and leading zeros stripped so "0" cannot sit there looking filled in. */}
              <Input id="sr-duration" value={st.duration} inputMode="numeric" placeholder="e.g., 20" aria-invalid={durErr || undefined}
                onChange={(e) => patchStage({ duration: e.target.value.replace(/[^0-9]/g, '').replace(/^0+/, '').slice(0, 3) })}
                className={cn(durErr && 'border-bad focus:border-bad')} />
              {durErr && <span className="mt-1 block text-[11.5px] text-bad">Enter a duration</span>}
            </div>
          </div>
        </div>

        <DescEditor stage={v.stage} value={st.desc} onChange={(desc) => patchStage({ desc })} />

        <div className={cn('grid items-stretch gap-4 transition-[grid-template-columns] duration-300',
          libOpen ? 'min-[1100px]:grid-cols-[minmax(0,1fr)_clamp(340px,44%,560px)]' : 'min-[1100px]:grid-cols-[minmax(0,1fr)_56px]')}>
          <div className="flex min-w-0 flex-col gap-4">
            <PickedTray files={st.files} stage={v.stage} scopeLine={[v.klass, v.subject, v.chapter].filter(Boolean).join(' · ')}
              countKey={countKey} pulseFrom={pulseFrom} onRemove={(id) => patchFiles(st.files.filter((x) => x.id !== id))} />
          </div>
          <LibraryPanel open={libOpen} onToggle={() => setLibOpen(!libOpen)} assetType={assetType} onAssetType={setAssetType}
            count={assetCount(assetType)} q={q} onQ={setQ} sel={libSel} scopeOk={scopeOk} scopeLine={scopeLine} currentChapter={v.chapter}
            lib={lib} busy={libBusy} err={libErr} onRetry={reload} onBrowse={openBrowse} onAdd={openAdd}
            isAdded={isAdded} onPick={addLib} onDeleteItem={setDelTarget} />
        </div>

        <div className="glass flex flex-wrap items-center gap-2.5 rounded-2xl px-4 py-3.5">
          <Button variant="secondary" disabled={si <= 0} onClick={() => { if (si > 0) onChange({ ...v, stage: STAGES[si - 1] }) }}>
            <ArrowLeft className="h-3.5 w-3.5" />Previous
          </Button>
          <div className="flex-1" />
          <Button variant="secondary" disabled={!st.files.length} onClick={() => patchFiles([])} className="hover:border-bad/40 hover:text-bad">Remove all</Button>
          <Button onClick={next}>{v.stage === STAGES[STAGES.length - 1] ? 'Preview and Save' : 'Next'}<ArrowRight className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      {browseOpen && (
        <BrowseDialog assetType={assetType} className={plan.className || v.klass} subjectName={plan.subjectName || v.subject}
          chapters={chapters ?? []} chaptersBusy={chaptersBusy || chapters === null} initial={libSel}
          onClose={() => setBrowseOpen(false)} onApply={(sel) => { setLibSel(sel); setBrowseOpen(false) }} />
      )}
      {addOpen && (
        <AddResourceDialog classCode={classCode} subjectCode={subjectCode} scopeLine={scopeLine} chapters={chapters ?? []}
          initialChapter={libSel?.chapter ?? ''} onClose={() => setAddOpen(false)}
          onAdded={(chapter) => {
            setAddOpen(false)
            toast('Resource added to the library.', 'success')
            if (libSel) reload()
            else setLibSel({ chapterId: chapters?.find((c) => c.name === chapter)?.id ?? '', chapter })
          }} />
      )}
      {delTarget && (
        <ConfirmDialog title="Remove from the library?" confirmLabel="Remove" busy={deleting}
          onClose={() => { if (!deleting) setDelTarget(null) }} onConfirm={removeLibraryItem}
          message={<><b className="font-semibold text-fg">{delTarget.title}</b> will be removed from this class and subject’s Resource Library for everyone who teaches it.</>} />
      )}
      {preview}
    </div>
  )
}
