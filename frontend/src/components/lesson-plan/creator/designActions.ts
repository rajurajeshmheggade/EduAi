/* Lesson Plan Creator — actions for steps 5–7 (assessment, 5E learning experience, build + save). */
import { toast } from '@/components/ui/toast'
import { cleanAiText, parseBlock } from '@/lib/lessonPlan/normalize'
import { aiErrorMessage, lessonPlanService } from '@/services/lessonPlanService'
import type { FiveEDesign, PlanContent, PlanStep, RawAssessmentItem } from '@/types/lessonPlan'
import { FIVE_E_PHASES, INTELLIGENCE_TYPES } from '../data'
import {
  allotTimes, assessKey, defaultAssessRow, defaultPhaseCfg, freshPhases, isErrBlock, isRec, itemsFromAssessRes, newResource,
  rawAssessItems, uniq, type AssessRow, type CreatorSnapshot, type Elo, type NormItem, type PhaseCfg, type ResourceCard,
} from './model'
import type { CreatorStore } from './useCreatorStore'

export function designActions(s: CreatorStore) {
  const { ctx, busy, setBusy } = s
  const chapter = s.chapter.trim()

  /* ── Step 5 — per-ELO assessment config (rows chosen by the teacher, fed to the AI) */
  const rowsFor = (id: string): AssessRow[] => s.assessCfg[id] ?? [defaultAssessRow()]
  const toggleAssessOpen = (id: string) => s.setAssessOpen((o) => ({ ...o, [id]: !o[id] }))
  const addAssessRow = (elo: Elo) => s.setAssessCfg((c) => ({ ...c, [elo.id]: [...(c[elo.id] ?? [defaultAssessRow()]), defaultAssessRow()] }))
  const removeAssessRow = (elo: Elo, i: number) => s.setAssessCfg((c) => {
    const rows = c[elo.id] ?? [defaultAssessRow()]
    return { ...c, [elo.id]: rows.length > 1 ? rows.filter((_, k) => k !== i) : rows }
  })
  const updateAssessRow = <K extends keyof AssessRow>(elo: Elo, i: number, field: K, v: AssessRow[K]) => s.setAssessCfg((c) => ({
    ...c, [elo.id]: (c[elo.id] ?? [defaultAssessRow()]).map((r, k) => (k === i ? { ...r, [field]: v } : r)),
  }))
  const clampItems = (v: number | '') => Math.max(1, Math.min(10, Number(v) || 1))

  // Generate items for ONE ELO from its rows (each row → an assessment_details entry for the AI).
  const generateAssessForElo = async (elo: Elo) => {
    if (busy) return
    const rows = rowsFor(elo.id)
    const label = elo.num ? `ELO ${elo.num}` : 'this outcome'
    setBusy(`assess:${elo.id}`)
    toast(`Generating assessment items for ${label}…`)
    try {
      const res = await lessonPlanService.assessmentItems({
        ...ctx, topic: chapter, elo: elo.elo, course_outcome: s.coForElo(elo)?.text ?? '',
        assessment_details: rows.map((r) => ({ itemType: r.itemType, noOfItems: clampItems(r.noOfItems), includeLOTS: !!r.includeLOTS, bloomsLevel: elo.bloom })),
        Bloom_level: elo.bloom,
      })
      s.setAssessByElo((m) => ({ ...m, [elo.id]: res }))
      s.setAssessOpen((o) => ({ ...o, [elo.id]: true }))
      s.setGen((g) => ({ ...g, assess: true }))
      s.mark(5)
      toast(`✓ Assessment items generated for ${elo.num ? `ELO ${elo.num}` : 'outcome'}`)
    } catch (e) { toast(`✗ ${aiErrorMessage(e, 'Could not generate assessment')}`) }
    finally { setBusy('') }
  }

  // ── per-item actions on generated items (preview / edit / regenerate / delete)
  const mutateAssessItems = (eloId: string, fn: (arr: RawAssessmentItem[]) => RawAssessmentItem[]) => s.setAssessByElo((m) => {
    const res = m[eloId]
    if (!res) return m
    const key = assessKey(res)
    if (key == null) return m
    return { ...m, [eloId]: { ...res, [key]: { ...res[key], assessment: fn(res[key].assessment.slice()) } } }
  })
  const deleteAssessItem = (eloId: string, idx: number) => mutateAssessItems(eloId, (arr) => arr.filter((_, i) => i !== idx))
  const patchAssessItem = (eloId: string, idx: number, patch: Partial<RawAssessmentItem>) =>
    mutateAssessItems(eloId, (arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  const replaceAssessItem = (eloId: string, idx: number, item: RawAssessmentItem) =>
    mutateAssessItems(eloId, (arr) => arr.map((it, i) => (i === idx ? item : it)))
  const startEditItem = (eloId: string, idx: number, it: NormItem) =>
    s.setEditItem({ eloId, idx, question: it.question, answer: it.answer, options: it.options ? { ...it.options } : null })
  // Editing an MCQ covers its options too — question + answer alone left most of the item uneditable.
  const saveEditItem = () => {
    const ed = s.editItem
    if (!ed) return
    const patch: Partial<RawAssessmentItem> = { question: ed.question, answer: ed.answer }
    const opts = ed.options
    if (opts) {
      const raw = rawAssessItems(s.assessByElo[ed.eloId])[ed.idx]
      patch.options = Array.isArray(raw?.options) ? Object.keys(opts).map((k) => opts[k]) : { ...opts }
    }
    patchAssessItem(ed.eloId, ed.idx, patch)
    s.setEditItem(null)
    toast('Item updated')
  }
  const askRegenItem = (elo: Elo, idx: number) => {
    if (s.regenItemBusy === `${elo.id}:${idx}`) return
    s.setRegenModal({ kind: 'assessItem', elo, idx, rawItem: rawAssessItems(s.assessByElo[elo.id])[idx] ?? {} })
  }
  const regenAssessItem = async (elo: Elo, idx: number, rawItem: RawAssessmentItem, extra: string) => {
    s.setRegenItemBusy(`${elo.id}:${idx}`)
    s.setRegenBusy(true)            // spins the popup's Regenerate button until the AI call returns
    try {
      const res = await lessonPlanService.assessmentItems({
        ...ctx, topic: chapter, elo: elo.elo, course_outcome: s.coForElo(elo)?.text ?? '',
        assessment_details: [{ itemType: rawItem.itemType || 'mcq', noOfItems: 1, includeLOTS: true, bloomsLevel: elo.bloom }],
        Bloom_level: elo.bloom, additional_instructions: extra.trim() || undefined,
      })
      const fresh = rawAssessItems(res)[0]
      if (!fresh) throw new Error('No item returned')
      replaceAssessItem(elo.id, idx, fresh)
      toast('✓ Item regenerated')
    } catch (e) { toast(`✗ ${aiErrorMessage(e, 'Could not regenerate the item')}`) }
    finally { s.setRegenItemBusy(null); s.setRegenBusy(false); s.setRegenModal(null) }
  }

  /* ── Step 6 — Learning Experience (5E, per ELO) */
  const updPhase = (eloId: string, phaseKey: string, fn: (cur: PhaseCfg) => PhaseCfg) => s.setElo5eCfg((c) => {
    const forElo = { ...(c[eloId] ?? {}) }
    forElo[phaseKey] = fn({ ...defaultPhaseCfg(), ...(forElo[phaseKey] ?? {}) })
    return { ...c, [eloId]: forElo }
  })
  // Editable phase time (pre-filled by the equal split); re-splits it evenly across the phase's resources.
  // For a merged tab the edit applies to every ELO in the group.
  const setPhaseTime = (eloIds: string[], phaseKey: string, v: string) =>
    eloIds.forEach((id) => updPhase(id, phaseKey, (cur) => ({ ...cur, time: v, resources: allotTimes(v, cur.resources) })))
  const setPhaseImages = (eloId: string, phaseKey: string, v: boolean) => updPhase(eloId, phaseKey, (cur) => ({ ...cur, genImages: v }))
  const mutResources = (eloId: string, phaseKey: string, fn: (rs: ResourceCard[]) => ResourceCard[]) =>
    updPhase(eloId, phaseKey, (cur) => ({ ...cur, resources: fn(cur.resources.slice()) }))
  // Add / remove a resource CARD (duplicates allowed) — the phase time is re-split across the resulting set.
  const addPhaseResource = (eloId: string, phaseKey: string, name: string) =>
    updPhase(eloId, phaseKey, (cur) => ({ ...cur, resources: allotTimes(cur.time, [...cur.resources, newResource(name)]) }))
  const removePhaseResource = (eloId: string, phaseKey: string, rid: string) =>
    updPhase(eloId, phaseKey, (cur) => ({ ...cur, resources: allotTimes(cur.time, cur.resources.filter((r) => r.rid !== rid)) }))
  const patchResource = (eloId: string, phaseKey: string, rid: string, patch: Partial<ResourceCard>) =>
    mutResources(eloId, phaseKey, (rs) => rs.map((r) => (r.rid === rid ? { ...r, ...patch } : r)))
  const toggleResExpanded = (eloId: string, phaseKey: string, rid: string) =>
    mutResources(eloId, phaseKey, (rs) => rs.map((r) => (r.rid === rid ? { ...r, expanded: !r.expanded } : r)))
  const moveResource = (eloId: string, phaseKey: string, fromIdx: number, toIdx: number) => mutResources(eloId, phaseKey, (rs) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= rs.length || toIdx >= rs.length) return rs
    const [it] = rs.splice(fromIdx, 1)
    rs.splice(toIdx, 0, it)
    return rs
  })
  const addPedFromInput = () => {
    const parts = s.pedInput.split(/[,\n]+/).map((x) => x.trim()).filter(Boolean)
    if (parts.length) s.setPedApproaches((xs) => uniq([...xs, ...parts]))
    s.setPedInput('')
  }
  const removePed = (a: string) => s.setPedApproaches((xs) => xs.filter((x) => x !== a))
  const toggleIntel = (t: string) => s.setIntelSel((xs) => (xs.includes(t) ? xs.filter((x) => x !== t) : [...xs, t]))

  const generatePedagogical = async () => {
    if (busy) return
    if (!s.elos.length) { toast('Generate learning outcomes first'); return }
    setBusy('ped')
    toast('Generating pedagogical approaches…')
    try {
      const res: unknown = await lessonPlanService.pedagogicalApproaches({ ...ctx, chapter, elos: s.elos.map((e) => e.elo) })
      const list: unknown[] = isRec(res) && Array.isArray(res.approaches) ? res.approaches : Array.isArray(res) ? res : []
      // Layer 2 — each approach is model output; anything that can't be validated is dropped rather than
      // rendered as a chip of raw JSON.
      s.setPedApproaches(uniq(list.map((a) => cleanAiText(a, { field: 'approach' })).filter(Boolean)))
      s.setIntelSel(INTELLIGENCE_TYPES.slice())
      s.setElo5eCfg((prev) => {
        const next = { ...prev }
        s.elos.forEach((e) => { if (!next[e.id]) next[e.id] = freshPhases() })
        return next
      })
      s.setPedDone(true)
      s.setActiveEloTab(0)
      toast('✓ Pedagogical approaches generated')
    } catch (e) { toast(`✗ ${aiErrorMessage(e, 'Could not generate pedagogical approaches')}`) }
    finally { setBusy('') }
  }

  // Other ELOs merged into this design (the backend addresses them together).
  const mergedTextsFor = (eloId: string): string[] => {
    const g = s.groupOf(eloId)
    return g ? g.filter((id) => id !== eloId).map((id) => s.elos.find((e) => e.id === id)?.elo ?? '').filter(Boolean) : []
  }
  // One AI block per resource card, stored on that card — always through the normalization chokepoint.
  const genOneResource = async (elo: Elo, phaseKey: string, res: ResourceCard, genImages: boolean) => {
    const api = await lessonPlanService.fiveEResource({
      ...ctx, chapter, elo: elo.elo, merged_elos: mergedTextsFor(elo.id),
      phase: phaseKey, resource: res.name, est_time: res.estTime, generate_images: genImages,
      course_outcome: s.coForElo(elo)?.text ?? '', pedagogical_approaches: s.pedApproaches, intelligence_types: s.intelSel,
    })
    patchResource(elo.id, phaseKey, res.rid, { content: parseBlock(api, { phase: phaseKey, resource: res.name }), expanded: true })
  }
  // Per-resource (re)generate — the rotate button on each resource card.
  const regenResource = async (elo: Elo, phaseKey: string, res: ResourceCard) => {
    if (busy) return
    setBusy(`res:${res.rid}`)
    toast(`Generating “${res.name}”…`)
    try {
      await genOneResource(elo, phaseKey, res, s.phaseCfg(elo.id, phaseKey).genImages)
      toast(`✓ Generated “${res.name}”`)
    } catch (e) { toast(`✗ ${aiErrorMessage(e, 'Could not generate content')}`) }
    finally { setBusy('') }
  }
  // "Generate 5E Model & Saving" — one AI block per configured resource, across all ELOs.
  const generate5EAll = async () => {
    if (busy) return
    if (!s.elos.length) { toast('Generate learning outcomes first'); return }
    const tuples: { elo: Elo; phaseKey: string; res: ResourceCard; genImages: boolean }[] = []
    s.elos.forEach((e) => FIVE_E_PHASES.forEach((p) => {
      const pc = s.phaseCfg(e.id, p.key)
      pc.resources.forEach((r) => tuples.push({ elo: e, phaseKey: p.key, res: r, genImages: !!pc.genImages }))
    }))
    if (!tuples.length) { toast('Add at least one resource to a phase first'); return }
    setBusy('5e')
    toast(`Generating ${tuples.length} resource block${tuples.length > 1 ? 's' : ''}…`)
    try {
      for (const t of tuples) await genOneResource(t.elo, t.phaseKey, t.res, t.genImages)
      toast('✓ 5E content generated & saved')
    } catch (e) { toast(`✗ ${aiErrorMessage(e, 'Could not generate 5E content')}`) }
    finally { setBusy('') }
  }
  // "Generate Learning Experience" — reveal the read-only combined view (blank sections are fine; it never
  // blocks on missing content). Deliberately no scroll: generating should not yank the page down.
  const generateLE = () => {
    if (busy) return
    if (!s.elos.length) { toast('Generate learning outcomes first'); return }
    s.setGen((g) => ({ ...g, le: true }))
    s.mark(6)
    toast('✓ Learning experience ready')
  }
  const pickForMerge = (id: string) => s.setMergePick((p) => (p.includes(id) ? p : [...p, id]))
  const unpickForMerge = (id: string) => s.setMergePick((p) => p.filter((x) => x !== id))
  const mergePicked = () => {
    const pick = s.mergePick
    if (pick.length < 2) return
    s.setMergeGroups((gs) => [...gs, [...pick]])
    s.setActiveEloTab(0); s.setMergePick([]); s.setMergeOpen(false)
    toast(`Merged ${pick.length} ELOs`)
  }
  const unmerge = (eloId: string) => { s.setMergeGroups((gs) => gs.filter((g) => !g.includes(eloId))); s.setActiveEloTab(0) }

  /* ── Step 7 — build the plan JSON + save */
  const buildPlanContent = (): PlanContent => {
    // One assessment block per ELO — doubles as the Expected-Learning-Outcomes list + the Assessment items.
    const assessment = s.elos.map((e) => ({
      id: e.id, name: `ELO ${e.num}`, fullText: e.elo, bloomLevel: e.bloom,
      items: itemsFromAssessRes(s.assessByElo[e.id]).map((it) => ({
        itemType: it.itemType, bloomsLevel: it.bloomsLevel, question: it.question, options: it.options, answer: it.answer,
        ...(it.context ? { context: it.context } : {}),
      })),
    }))
    // 5E design (resource-centric) → eloSteps + generatedContentData keyed `${eloText}_${stepId}` → { [resource]: content }.
    const eloSteps: FiveEDesign['eloSteps'] = []
    const generatedContentData: FiveEDesign['generatedContentData'] = {}
    s.elos.forEach((e) => {
      const steps: PlanStep[] = FIVE_E_PHASES.map((ph, idx) => {
        const pc = s.phaseCfg(e.id, ph.key)            // every phase kept — empty ones show as blank blocks
        const stepId = `s${idx + 1}`
        const seen: Record<string, number> = {}
        const resNames: string[] = []
        const contentMap: Record<string, string> = {}
        pc.resources.forEach((r) => {
          const n = (seen[r.name] ?? 0) + 1
          seen[r.name] = n
          const disp = n > 1 ? `${r.name} (${n})` : r.name     // keep duplicates distinct
          resNames.push(disp)
          // Only validated content (with a body) is persisted; an errored block saves as blank, so corruption
          // is never written to the DB.
          const c = r.content
          if (c && !isErrBlock(c) && c.body) contentMap[disp] = (c.title ? `${c.title}\n\n` : '') + c.body
        })
        if (Object.keys(contentMap).length) generatedContentData[`${e.elo}_${stepId}`] = contentMap
        return { id: stepId, name: ph.key, stepTime: pc.time ? `${pc.time} min` : '', resources: resNames, resourceTimeAllocations: {} }
      })
      eloSteps.push({ elo: e.elo, steps })
    })
    return {
      coreObjectives: s.activeObjectives.map((o) => ({ text: o.description, factor: o.category })),
      assessment,
      elos: s.elos.map((e) => ({ id: e.id, text: e.elo })),
      fiveEDesign: { eloSteps, generatedContentData },
      fiveE: [],            // the resource-centric 5E Design Model replaces the old activity list
      assignments: [],
      pedagogicalApproaches: s.pedApproaches,
      intelligenceTypes: s.intelSel,
    }
  }

  // The full wizard DATA (not transient UI), stored in plan.__creatorState so "Edit Draft" resumes here.
  const snapshotState = (): CreatorSnapshot => ({
    current: s.current, done: s.done, board: s.board, classCode: s.classCode, subjectCode: s.subjectCode,
    className: s.className, subjectName: s.subjectName, textbookId: s.textbookId, chapterNumber: s.chapterNumber,
    chapter: s.chapter, hours: s.hours, minutes: s.minutes, gen: s.gen,
    rawCos: s.rawCos, assessCfg: s.assessCfg, assessByElo: s.assessByElo, assessOpen: s.assessOpen,
    leModel: s.leModel, pedDone: s.pedDone, pedApproaches: s.pedApproaches, intelSel: s.intelSel, mergeGroups: s.mergeGroups,
    elo5eCfg: s.elo5eCfg, objectives: s.objectives, deletedStack: s.deletedStack, blooms: s.blooms, bloomCounts: s.bloomCounts,
    skills: s.skills, comps: s.comps, attitudes: s.attitudes, elos: s.elos,
  })

  // Create (isCompleted) and Save-as-Draft share one payload; only the completion flag differs.
  const persist = async (isCompleted: boolean) => {
    if (busy) return
    if (isCompleted && !s.gen.le) { toast('Generate the Learning Experience (Step 6) to finish.'); return }
    if (!isCompleted && !s.gen.co) { toast('Generate course outcomes first'); return }
    const title = chapter || `${s.subjectName || 'Lesson'} Lesson Plan`
    // The plan JSON stored in the DB (what the Lesson Plan View renders back).
    const fullPlan: Partial<PlanContent> = {
      grade: s.className, subject: s.subjectName, topic: title, board: s.board, duration: String(s.totalMins || 240),
      __creatorState: snapshotState(), ...buildPlanContent(),
    }
    setBusy(isCompleted ? 'create' : 'draft')
    try {
      const res = await lessonPlanService.savePlan({
        id: s.props.draftId ?? s.savedId ?? undefined,
        classCode: s.classCode, className: s.className, subjectCode: s.subjectCode, subjectName: s.subjectName,
        chapterName: chapter, textbookId: s.linkedTextbookId, chapterNumber: s.linkedChapterNumber,
        unitPlanTitle: title, board: s.board, durationMins: s.totalMins, plan: fullPlan, isCompleted, source: 'manual',
      })
      s.setSavedId(res.id)        // a second "Save as Draft" updates the same row
      toast(isCompleted ? '✓ Lesson plan saved' : '✓ Draft saved')
      setBusy('')
      s.props.onSaved(res.id, isCompleted)
    } catch (e) {
      toast(`✗ ${aiErrorMessage(e, 'Could not save')}`, 'error')
      setBusy('')
    }
  }

  return {
    rowsFor, toggleAssessOpen, addAssessRow, removeAssessRow, updateAssessRow, generateAssessForElo,
    deleteAssessItem, startEditItem, saveEditItem, askRegenItem, regenAssessItem,
    setPhaseTime, setPhaseImages, addPhaseResource, removePhaseResource, patchResource, toggleResExpanded, moveResource,
    addPedFromInput, removePed, toggleIntel, generatePedagogical, regenResource, generate5EAll, generateLE,
    pickForMerge, unpickForMerge, mergePicked, unmerge,
    createPlan: () => persist(true), saveDraft: () => persist(false),
  }
}
