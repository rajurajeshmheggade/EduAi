/* Lesson Plan Creator — all wizard state, derived values and lifecycle effects. Actions live in
   planActions.ts (steps 1–3) and designActions.ts (steps 5–7); useCreator() composes them. */
import { useEffect, useRef, useState } from 'react'
import { lessonPlanService, type GenCtx } from '@/services/lessonPlanService'
import type { AssessmentResponse, CourseOutcome, LpChapter, LpScope } from '@/types/lessonPlan'
import { ATTITUDES, FIVE_E_PHASES, INTELLIGENCE_TYPES } from '../data'
import {
  OTHER_CHAPTER, defaultPhaseCfg, pickClass, pickSubject, readDraft, splitDuration,
  type AssessRow, type Busy, type CustomRow, type EditItemState, type Elo, type EloCfgMap, type GenFlags, type Objective,
  type PhaseCfg, type PreviewItem, type RegenTarget, type TabUnit,
} from './model'

export interface CreatorProps {
  scope: LpScope
  defaultClassCode?: string
  defaultSubjectCode?: string
  draft: unknown | null
  draftId: string | null
  onBack: () => void
  onSaved: (id: string, completed: boolean) => void
}

export function useCreatorStore(p: CreatorProps) {
  const { scope } = p
  // A saved draft (__creatorState) seeds every DATA field once, on mount.
  const [init] = useState(() => readDraft(p.draft))

  // ── shared
  const [current, setCurrent] = useState(init.current ?? 1)
  const [doneRaw, setDone] = useState<number[]>(init.done ?? [])
  const [busy, setBusy] = useState<Busy>('')
  const [gen, setGen] = useState<GenFlags>(init.gen ?? { co: false, elo: false, assess: false, le: false })
  const [savedId, setSavedId] = useState<string | null>(null)
  // The sticky stepper condenses once the page scrolls past the top (a sentinel leaves the viewport).
  const [compactStepper, setCompactStepper] = useState(false)

  // ── Step 1 — Basic Setup
  const [board, setBoard] = useState(() => init.board || (scope.boards.includes('CBSE') ? 'CBSE' : scope.boards[0] || 'CBSE'))
  const [classCode, setClassCode] = useState(() => pickClass(scope, init, p.defaultClassCode))
  const [subjectCode, setSubjectCode] = useState(() => pickSubject(scope, pickClass(scope, init, p.defaultClassCode), init, p.defaultSubjectCode))
  const [chapter, setChapter] = useState(init.chapter ?? '')
  const [textbookId, setTextbookId] = useState<string | null>(init.textbookId ?? null)
  const [chapterNumber, setChapterNumber] = useState<number | null>(init.chapterNumber ?? null)
  const [customChapter, setCustomChapter] = useState(!init.textbookId && !!init.chapter)
  // Chapters loaded for `key` (class|subject); a mismatch with the current pair means they are still loading.
  const [chapterRes, setChapterRes] = useState<{ key: string; list: LpChapter[] }>({ key: '', list: [] })
  const [hours, setHours] = useState(init.hours ?? '')
  const [minutes, setMinutes] = useState(init.minutes ?? '')
  const [file, setFile] = useState<File | null>(null)

  // ── Step 2 — objectives (raw COs from the API are threaded into the ELO / assessment / 5E steps)
  const [rawCos, setRawCos] = useState<CourseOutcome[]>(init.rawCos ?? [])
  const [objectives, setObjectives] = useState<Objective[]>(init.objectives ?? [])
  const [deletedStack, setDeletedStack] = useState<string[]>(init.deletedStack ?? [])
  const [editObjId, setEditObjId] = useState<string | null>(null)
  const [editObjText, setEditObjText] = useState('')
  const [customRows, setCustomRows] = useState<CustomRow[]>([{ factor: '', description: '' }])
  // Regenerate popup target while open; regenBusy spins its button during the AI call.
  const [regenModal, setRegenModal] = useState<RegenTarget | null>(null)
  const [regenBusy, setRegenBusy] = useState(false)

  // ── Step 3 — ELO config + generated outcomes
  const [blooms, setBlooms] = useState<string[]>(init.blooms ?? ['Apply', 'Analyse', 'Evaluate', 'Create'])
  const [bloomCounts, setBloomCounts] = useState<Record<string, string>>(init.bloomCounts ?? { Apply: '1', Analyse: '1', Evaluate: '1', Create: '1' })
  const [skills, setSkills] = useState<string[]>(init.skills ?? [])
  const [comps, setComps] = useState<string[]>(init.comps ?? [])
  const [attitudes, setAttitudes] = useState<string[]>(init.attitudes ?? ATTITUDES.slice())
  const [customSkill, setCustomSkill] = useState('')
  const [customComp, setCustomComp] = useState('')
  const [customAtt, setCustomAtt] = useState('')
  const [elos, setElos] = useState<Elo[]>(init.elos ?? [])
  const [editEloId, setEditEloId] = useState<string | null>(null)
  const [editEloText, setEditEloText] = useState('')
  const [ceCo, setCeCo] = useState('')
  const [ceBloom, setCeBloom] = useState('')
  const [ceText, setCeText] = useState('')

  // ── Step 5 — per-ELO assessment: config rows (fed to the AI), generated items, expand state
  const [assessCfg, setAssessCfg] = useState<Record<string, AssessRow[]>>(init.assessCfg ?? {})
  const [assessByElo, setAssessByElo] = useState<Record<string, AssessmentResponse>>(init.assessByElo ?? {})
  const [assessOpen, setAssessOpen] = useState<Record<string, boolean>>(init.assessOpen ?? {})
  const [editItem, setEditItem] = useState<EditItemState | null>(null)
  const [previewItem, setPreviewItem] = useState<PreviewItem | null>(null)
  const [regenItemBusy, setRegenItemBusy] = useState<string | null>(null)

  // ── Step 6 — Learning Experience (5E, per ELO)
  const [leModel, setLeModel] = useState(init.leModel ?? '5E')          // locked to 5E (other models disabled)
  const [pedDone, setPedDone] = useState(init.pedDone ?? false)          // approaches generated → reveal the 5E design
  const [pedApproaches, setPedApproaches] = useState<string[]>(init.pedApproaches ?? [])
  const [pedInput, setPedInput] = useState('')
  const [intelSel, setIntelSel] = useState<string[]>(init.intelSel ?? INTELLIGENCE_TYPES.slice())
  const [activeEloTab, setActiveEloTab] = useState(0)
  const [mergeGroups, setMergeGroups] = useState<string[][]>(init.mergeGroups ?? [])  // each group = ELOs merged into one tab
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergePick, setMergePick] = useState<string[]>([])               // ELO ids pending a merge
  const [previewTab, setPreviewTab] = useState(0)                         // tab in the read-only combined view
  const [elo5eCfg, setElo5eCfg] = useState<EloCfgMap>(init.elo5eCfg ?? {})

  // ── refs
  // Stable callback refs, so the container binds elements without reading ref objects during render. The step
  // sections are found inside the root by their data-step attribute.
  const rootEl = useRef<HTMLDivElement | null>(null)
  const [bindRoot] = useState(() => (el: HTMLDivElement | null) => { rootEl.current = el })
  const stepSentinelRef = useRef<HTMLDivElement | null>(null)
  const [bindSentinel] = useState(() => (el: HTMLDivElement | null) => { stepSentinelRef.current = el })
  const dragRef = useRef<{ eloId: string; phaseKey: string; fromIdx: number } | null>(null)   // resource drag-reorder

  // ── derived
  const cls = scope.classes.find((c) => c.class_code === classCode)
  const subjectOpts = cls?.subjects ?? []
  const className = cls?.class_name ?? ''
  const subjectName = subjectOpts.find((x) => x.subject_code === subjectCode)?.subject_name ?? ''
  // Every generator call carries this: names go into the prompt, codes drive the server's assignment check.
  const ctx: GenCtx = { board, grade: className, subject: subjectName, class_code: classCode, subject_code: subjectCode }
  const totalMins = (parseInt(hours, 10) || 0) * 60 + (parseInt(minutes, 10) || 0)
  const setupOk = !!(board && classCode && subjectCode)
  const chapterOk = !!chapter.trim()                       // Chapter/Unit is required before generating COs
  const durationOk = !!(hours.trim() || minutes.trim())
  const canGenCOs = setupOk && chapterOk && durationOk
  // Step 1 counts as done as soon as board + class + subject are chosen.
  const done = setupOk && !doneRaw.includes(1) ? [1, ...doneRaw] : doneRaw
  const chapterKey = classCode && subjectCode ? `${classCode}|${subjectCode}` : ''
  const chapterOpts = chapterKey && chapterRes.key === chapterKey ? chapterRes.list : []
  const chaptersLoading = !!chapterKey && chapterRes.key !== chapterKey
  const selChapter = (textbookId && chapterOpts.find((c) => c.textbook_id === textbookId && c.chapter_number === chapterNumber)) || null
  // The textbook link actually sent: a chapter present in the loaded list (a restored draft's link is trusted
  // only while the list is still loading), so a stale link never reaches the server.
  const linkedTextbookId = chaptersLoading ? textbookId : selChapter?.textbook_id ?? null
  const linkedChapterNumber = chaptersLoading ? chapterNumber : selChapter?.chapter_number ?? null
  const activeObjectives = objectives.filter((o) => !o.deleted)
  const activeIds = new Set(activeObjectives.map((o) => o.id))
  // Only the COs the teacher kept are sent to the generators.
  const activeCos = rawCos.filter((c) => activeIds.has(c.co_id))
  const coForElo = (e: Elo) => {
    const c = rawCos.find((x) => x.co_id === e.coId)
    return c ? { text: c.co_description, title: c.co_title } : null
  }
  const groupOf = (eloId: string) => mergeGroups.find((g) => g.includes(eloId)) ?? null
  const phaseCfg = (eloId: string, phaseKey: string): PhaseCfg => ({ ...defaultPhaseCfg(), ...(elo5eCfg[eloId]?.[phaseKey] ?? {}) })
  // Does an ELO have any generated resource content? (drives the tab dot)
  const eloHasContent = (e: Elo) => FIVE_E_PHASES.some((ph) => phaseCfg(e.id, ph.key).resources.some((r) => r.content))
  // 5E tab units: standalone ELOs + merged groups (each group → one "Merged: N ELOs" tab).
  const tabUnits: TabUnit[] = []
  const seen = new Set<string>()
  elos.forEach((e) => {
    if (seen.has(e.id)) return
    const g = groupOf(e.id)
    const members = g ? elos.filter((x) => g.includes(x.id)) : [e]
    if (g && members.length > 1) {
      members.forEach((m) => seen.add(m.id))
      tabUnits.push({ type: 'group', key: `g:${members.map((m) => m.id).join('+')}`, elos: members })
    } else { seen.add(e.id); tabUnits.push({ type: 'elo', key: `e:${e.id}`, elos: [e] }) }
  })
  const activeUnit = tabUnits.length ? tabUnits[Math.min(activeEloTab, tabUnits.length - 1)] : null
  const activeElo = activeUnit?.elos[0] ?? null        // the primary ELO (single-ELO unit, or a group's first)
  const previewUnit = tabUnits.length ? tabUnits[Math.min(previewTab, tabUnits.length - 1)] : null

  // ── effects
  const mark = (n: number) => setDone((d) => (d.includes(n) ? d : [...d, n]))

  // BusyLoader locks <body>; the creator scrolls inside AppShell's <main>, so also swallow wheel/touch scrolling.
  useEffect(() => {
    if (!busy) return
    const block = (e: Event) => e.preventDefault()
    window.addEventListener('wheel', block, { passive: false })
    window.addEventListener('touchmove', block, { passive: false })
    return () => { window.removeEventListener('wheel', block); window.removeEventListener('touchmove', block) }
  }, [busy])

  // Current step = the section crossing the middle band of the viewport.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting || !(en.target instanceof HTMLElement)) return
        const n = Number(en.target.dataset.step)
        if (n) setCurrent(n)
      })
    }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 })
    rootEl.current?.querySelectorAll('section[data-step]').forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    const el = stepSentinelRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const obs = new IntersectionObserver((entries) => setCompactStepper(!entries[0].isIntersecting), { threshold: 0 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Chapters of the indexed textbooks for the chosen class + subject (the teacher may also type one).
  useEffect(() => {
    if (!chapterKey) return
    let live = true
    lessonPlanService.chapters(classCode, subjectCode)
      .then((chs) => { if (live) setChapterRes({ key: chapterKey, list: Array.isArray(chs) ? chs.filter((c) => c && c.name) : [] }) })
      .catch(() => { if (live) setChapterRes({ key: chapterKey, list: [] }) })
    return () => { live = false }
  }, [chapterKey, classCode, subjectCode])

  // ── Step 1 setters with their knock-on resets
  // Changing the Time Duration re-splits it equally across the 5 phases of every ELO (and each phase across
  // its resources). New ELOs are split when they are created; a restored draft keeps its per-phase times.
  const resplit = (h: string, m: string) => {
    const total = (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0)
    if (total && elos.length) setElo5eCfg((cfg) => splitDuration(cfg, elos.map((e) => e.id), total))
  }
  const changeHours = (v: string) => { setHours(v); resplit(v, minutes) }
  const changeMinutes = (v: string) => { setMinutes(v); resplit(hours, v) }
  const clearChapter = () => { setChapter(''); setTextbookId(null); setChapterNumber(null); setCustomChapter(false) }
  const selectClass = (code: string) => {
    setClassCode(code)
    const subs = scope.classes.find((c) => c.class_code === code)?.subjects ?? []
    setSubjectCode(subs.length === 1 ? subs[0].subject_code : '')
    clearChapter()
  }
  const selectSubject = (code: string) => { setSubjectCode(code); clearChapter() }
  const pickChapter = (value: string) => {
    if (value === OTHER_CHAPTER) { setCustomChapter(true); setTextbookId(null); setChapterNumber(null); setChapter(''); return }
    const c = chapterOpts.find((x) => x.id === value)
    if (!c) { clearChapter(); return }
    setChapter(c.name); setTextbookId(c.textbook_id); setChapterNumber(c.chapter_number); setCustomChapter(false)
  }
  const typeChapter = (v: string) => { setChapter(v); setTextbookId(null); setChapterNumber(null); setCustomChapter(true) }
  const scrollTo = (n: number) => {
    rootEl.current?.querySelector(`section[data-step="${n}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setCurrent(n)
  }

  return {
    props: p, scope,
    current, done, busy, setBusy, gen, setGen, savedId, setSavedId, compactStepper, mark, scrollTo,
    board, setBoard, classCode, subjectCode, className, subjectName, subjectOpts, selectClass, selectSubject,
    chapter, textbookId, chapterNumber, linkedTextbookId, linkedChapterNumber, customChapter, chapterOpts, chaptersLoading, selChapter, pickChapter, typeChapter,
    hours, changeHours, minutes, changeMinutes, file, setFile, ctx, totalMins, setupOk, chapterOk, durationOk, canGenCOs,
    rawCos, setRawCos, objectives, setObjectives, deletedStack, setDeletedStack, editObjId, setEditObjId, editObjText, setEditObjText,
    customRows, setCustomRows, regenModal, setRegenModal, regenBusy, setRegenBusy, activeObjectives, activeCos, coForElo,
    blooms, setBlooms, bloomCounts, setBloomCounts, skills, setSkills, comps, setComps, attitudes, setAttitudes,
    customSkill, setCustomSkill, customComp, setCustomComp, customAtt, setCustomAtt, elos, setElos,
    editEloId, setEditEloId, editEloText, setEditEloText, ceCo, setCeCo, ceBloom, setCeBloom, ceText, setCeText,
    assessCfg, setAssessCfg, assessByElo, setAssessByElo, assessOpen, setAssessOpen, editItem, setEditItem,
    previewItem, setPreviewItem, regenItemBusy, setRegenItemBusy,
    leModel, setLeModel, pedDone, setPedDone, pedApproaches, setPedApproaches, pedInput, setPedInput, intelSel, setIntelSel,
    activeEloTab, setActiveEloTab, mergeGroups, setMergeGroups, mergeOpen, setMergeOpen, mergePick, setMergePick,
    previewTab, setPreviewTab, elo5eCfg, setElo5eCfg, groupOf, phaseCfg, eloHasContent, tabUnits, activeUnit, activeElo, previewUnit,
    bindRoot, bindSentinel, dragRef,
  }
}

export type CreatorStore = ReturnType<typeof useCreatorStore>
