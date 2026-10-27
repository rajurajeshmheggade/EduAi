/* Lesson Plan Creator — actions for steps 1–3 (setup + COs, objectives, skills / competencies / ELOs). */
import { toast } from '@/components/ui/toast'
import { cleanAiText } from '@/lib/lessonPlan/normalize'
import { aiErrorMessage, lessonPlanService } from '@/services/lessonPlanService'
import type { CourseOutcome } from '@/types/lessonPlan'
import {
  MAX_UPLOAD_BYTES, UPLOAD_EXT, defaultAssessRow, firstStr, freshPhases, isRec, nextId, parseCustom, splitDuration, strList, uniq,
  type CustomRow, type Elo, type Objective,
} from './model'
import type { CreatorStore } from './useCreatorStore'

/** regenerate-course-outcome reply → the CO object, whatever wrapper it came in. */
const coFromRegen = (res: unknown): Record<string, unknown> => {
  if (!isRec(res)) return {}
  if (isRec(res.course_outcome)) return res.course_outcome
  if (Array.isArray(res.course_outcomes) && isRec(res.course_outcomes[0])) return res.course_outcomes[0]
  return res
}

export function planActions(s: CreatorStore) {
  const { ctx, busy, setBusy } = s
  const chapter = s.chapter.trim()

  /* ── Step 1 — upload + generate COs */
  const clearFile = () => s.setFile(null)
  const pickFile = (f: File | null) => {
    if (!f) { clearFile(); return }
    if (!UPLOAD_EXT.test(f.name)) { toast('✗ Only PDF, TXT and DOCX files are supported'); clearFile(); return }
    if (f.size > MAX_UPLOAD_BYTES) { toast('✗ The file is larger than 10MB'); clearFile(); return }
    s.setFile(f)
  }

  const generateCOs = async () => {
    if (!s.setupOk) { toast('Select board, class and subject first'); return }
    if (!s.chapterOk) { toast('Select a chapter/unit first'); return }
    if (!s.durationOk) { toast('Add a time duration before generating COs'); return }
    if (busy) return
    setBusy('co')
    // An uploaded document grounds the plan: its text is the reference for the Course Outcomes, which the
    // rest of the plan is built on.
    let referenceText: string | undefined
    if (s.file) {
      try { toast('Reading your document…'); referenceText = await lessonPlanService.extractText(s.file) }
      catch (e) { toast(`✗ ${aiErrorMessage(e, 'Could not read the uploaded file')}`); setBusy(''); return }
      if (!referenceText?.trim()) { toast('No readable text was found in the uploaded file'); setBusy(''); return }
    }
    toast('Generating course outcomes…')
    try {
      const res = await lessonPlanService.courseOutcomes({
        ...ctx, chapter, co_count: 4, reference_text: referenceText,
        textbook_id: s.linkedTextbookId, chapter_number: s.linkedChapterNumber,
      })
      const list = Array.isArray(res?.course_outcomes) ? res.course_outcomes : []
      const cos = list.map((c, i) => ({ ...c, co_id: c.co_id || `CO${i + 1}` }))
      if (!cos.length) throw new Error('No course outcomes returned')
      s.setRawCos(cos)
      s.setObjectives(cos.map((c) => ({ id: c.co_id, category: c.factor, description: c.co_description, title: c.co_title, ai: true, deleted: false })))
      s.setDeletedStack([])
      s.setGen((g) => ({ ...g, co: true }))
      toast('✓ Course outcomes generated')
      window.setTimeout(() => s.scrollTo(2), 150)
    } catch (e) { toast(`✗ ${aiErrorMessage(e, 'Could not generate course outcomes')}`) }
    finally { setBusy('') }
  }

  /* ── Step 2 — objective ops */
  const startEditObj = (o: Objective) => { s.setEditObjId(o.id); s.setEditObjText(o.description) }
  const saveEditObj = (id: string) => {
    const text = s.editObjText
    if (!text.trim()) { toast('Description cannot be empty'); return }
    s.setObjectives((xs) => xs.map((o) => (o.id === id ? { ...o, description: text } : o)))
    // Keep the CO sent to the later generators in step with the edit.
    s.setRawCos((rs) => rs.map((rc) => (rc.co_id === id ? { ...rc, co_description: text } : rc)))
    s.setEditObjId(null)
  }
  const deleteObj = (id: string) => {
    s.setObjectives((xs) => xs.map((o) => (o.id === id ? { ...o, deleted: true } : o)))
    s.setDeletedStack((st) => [...st, id])
  }
  const undoDelete = () => {
    const last = s.deletedStack[s.deletedStack.length - 1]
    if (!last) return
    s.setObjectives((xs) => xs.map((o) => (o.id === last ? { ...o, deleted: false } : o)))
    s.setDeletedStack((st) => st.slice(0, -1))
  }
  // Opens the Additional-Instructions popup; the real regenerate runs on confirm.
  const regenObj = (o: Objective) => s.setRegenModal({ kind: 'obj', item: o })
  const doRegenObj = async (o: Objective, extra: string) => {
    s.setRegenBusy(true)
    try {
      const res: unknown = await lessonPlanService.regenerateCourseOutcome({
        ...ctx, chapter, course_outcome: o.description, co_title: o.title, factor: o.category,
        additional_instructions: extra.trim() || undefined,
      })
      const c = coFromRegen(res)
      const desc = firstStr(c.co_description, c.description, c.text)
      if (!desc) throw new Error('No content returned')
      const factor = firstStr(c.factor) || o.category
      const title = firstStr(c.co_title) || o.title
      s.setObjectives((xs) => xs.map((x) => (x.id === o.id ? { ...x, description: desc, category: factor, title } : x)))
      s.setRawCos((rs) => rs.map((rc) => (rc.co_id === o.id ? { ...rc, co_description: desc, factor, co_title: title || rc.co_title } : rc)))
      toast('✓ Objective regenerated')
    } catch (e) { toast(`✗ ${aiErrorMessage(e, 'Could not regenerate the objective')}`) }
    finally { s.setRegenBusy(false); s.setRegenModal(null) }
  }

  const updateCustomRow = (i: number, field: keyof CustomRow, v: string) =>
    s.setCustomRows((rs) => rs.map((r, k) => (k === i ? { ...r, [field]: v } : r)))
  const saveCustomRow = (i: number) => {
    const r = s.customRows[i]
    if (!r || !r.description.trim() || !r.factor.trim()) return
    s.setObjectives((xs) => [...xs, { id: nextId('custom_'), category: r.factor, description: r.description, ai: false, deleted: false }])
    s.setCustomRows((rs) => rs.map((x, k) => (k === i ? { factor: '', description: '' } : x)))
    toast('Objective saved')
  }
  const addCustomRow = () => s.setCustomRows((rs) => [...rs, { factor: '', description: '' }])
  const removeCustomRow = (i: number) => s.setCustomRows((rs) => (rs.length > 1 ? rs.filter((_, k) => k !== i) : rs))
  const continueObjectives = () => {
    if (!s.activeObjectives.length) { toast('Add at least one objective'); return }
    s.mark(2)
    s.scrollTo(3)
  }

  /* ── Step 3 — Bloom / skills / competencies / attitudes */
  const toggleBloom = (label: string) => s.setBlooms((b) => (b.includes(label) ? b.filter((x) => x !== label) : [...b, label]))
  const setBloomCount = (label: string, raw: string) => {
    const v = raw.replace(/[^1-5]/g, '').slice(0, 1)
    s.setBloomCounts((c) => ({ ...c, [label]: v }))
  }
  const toggleAttitude = (a: string) => s.setAttitudes((xs) => (xs.includes(a) ? xs.filter((x) => x !== a) : [...xs, a]))
  const removeAttitude = (a: string) => s.setAttitudes((xs) => xs.filter((x) => x !== a))
  const removeSkill = (v: string) => s.setSkills((xs) => xs.filter((x) => x !== v))
  const removeComp = (v: string) => s.setComps((xs) => xs.filter((x) => x !== v))
  // Commit typed values as chips (Enter / comma / blur), then clear the box.
  const addCustomSkill = () => { const p = parseCustom(s.customSkill); if (p.length) { s.setSkills((xs) => uniq([...xs, ...p])); s.setCustomSkill('') } }
  const addCustomComp = () => { const p = parseCustom(s.customComp); if (p.length) { s.setComps((xs) => uniq([...xs, ...p])); s.setCustomComp('') } }
  const addCustomAtt = () => { const p = parseCustom(s.customAtt); if (p.length) { s.setAttitudes((xs) => uniq([...xs, ...p])); s.setCustomAtt('') } }

  // The per-CO reply carries skills / competencies on each CO; fold them back into rawCos by co_id.
  const mergeCos = (cos: CourseOutcome[]) => s.setRawCos((rs) => rs.map((r) => {
    const m = cos.find((c) => c.co_id === r.co_id)
    return m ? { ...r, ...m } : r
  }))
  const generateChips = async (kind: 'skills' | 'comps') => {
    if (busy) return
    if (!s.activeCos.length) { toast('Generate course outcomes first'); return }
    const isSkills = kind === 'skills'
    const noun = isSkills ? 'skills' : 'competencies'
    setBusy(kind)
    toast(`Generating ${noun}…`)
    try {
      const body = { ...ctx, chapter, total_outcomes: s.activeCos.length, course_outcomes: s.activeCos }
      const res = isSkills ? await lessonPlanService.skillsPerCo(body) : await lessonPlanService.competenciesPerCo(body)
      const cos = Array.isArray(res?.course_outcomes) ? res.course_outcomes : []
      if (cos.length) mergeCos(cos)
      // Keep chips already present (manual or earlier) + this generation + anything typed in the box.
      const have = isSkills ? s.skills : s.comps
      const typed = parseCustom(isSkills ? s.customSkill : s.customComp)
      const all = uniq([...have, ...cos.flatMap((c) => strList(isSkills ? c.skills : c.competencies)), ...typed])
      if (!all.length) throw new Error(`No ${noun} were returned`)
      if (isSkills) { s.setSkills(all); s.setCustomSkill('') } else { s.setComps(all); s.setCustomComp('') }
      toast(`✓ ${isSkills ? 'Skills' : 'Competencies'} generated`)
    } catch (e) { toast(`✗ ${aiErrorMessage(e, `Could not generate ${noun}`)}`) }
    finally { setBusy('') }
  }

  /* ── Step 3 — ELOs */
  const generateELOs = async () => {
    if (busy) return
    if (!s.activeCos.length) { toast('Generate course outcomes first'); return }
    const counts: Record<string, number> = {}
    s.blooms.forEach((b) => { const n = parseInt(s.bloomCounts[b] ?? '', 10) || 0; if (n > 0) counts[b] = n })
    if (!Object.keys(counts).length) { toast('Pick at least one Bloom level with a count'); return }
    setBusy('elo')
    toast('Generating learning outcomes…')
    try {
      const res = await lessonPlanService.elos({
        ...ctx, chapter, course_outcomes: s.activeCos, blooms_elo_counts: counts, skills: s.skills, competencies: s.comps, attitudes: s.attitudes,
      })
      const flat: Elo[] = []
      const ids = new Set<string>()
      ;(Array.isArray(res) ? res : []).forEach((co) => (Array.isArray(co?.elos) ? co.elos : []).forEach((e) => {
        let id = firstStr(e?.Elo_id) || `elo_${flat.length + 1}`
        while (ids.has(id)) id = `${id}_${flat.length + 1}`   // ids key every per-ELO map, so they must be unique
        ids.add(id)
        // Layer 2 — the ELO text is model output; it passes the plain-text chokepoint before it enters state.
        flat.push({
          id, elo: cleanAiText(e?.elo, { field: 'elo' }), bloom: firstStr(e?.bloom_level),
          skills: strList(e?.skills), competencies: strList(e?.competencies), num: flat.length + 1,
          coId: firstStr(e?.co_id, co?.co_id) || undefined,
        })
      }))
      if (!flat.length) throw new Error('No learning outcomes returned')
      s.setElos(flat)
      // One assessment config row per ELO, the first ELO expanded, no stale generated items.
      s.setAssessCfg(Object.fromEntries(flat.map((e) => [e.id, [defaultAssessRow()]])))
      s.setAssessByElo({})
      s.setAssessOpen({ [flat[0].id]: true })
      // Reset Step 6 (Learning Experience) so it re-derives from the new ELO set.
      s.setPedDone(false); s.setPedApproaches([]); s.setActiveEloTab(0); s.setPreviewTab(0); s.setMergeGroups([]); s.setMergePick([])
      s.setElo5eCfg(s.totalMins ? splitDuration({}, flat.map((e) => e.id), s.totalMins) : {})
      s.setGen((g) => ({ ...g, elo: true, assess: false, le: false }))
      s.mark(3); s.mark(4)
      toast('✓ Expected learning outcomes generated')
    } catch (e) { toast(`✗ ${aiErrorMessage(e, 'Could not generate learning outcomes')}`) }
    finally { setBusy('') }
  }
  // Seed the editor with the VALIDATED text — an old draft can still hold a raw payload, and the edit box must
  // not put it back on screen.
  const startEditElo = (e: Elo) => { s.setEditEloId(e.id); s.setEditEloText(cleanAiText(e.elo, { field: 'elo', op: 'edit' })) }
  const saveEditElo = (id: string) => {
    const text = s.editEloText
    if (!text.trim()) { toast('Outcome cannot be empty'); return }
    s.setElos((xs) => xs.map((e) => (e.id === id ? { ...e, elo: text } : e)))
    s.setEditEloId(null)
  }
  const deleteElo = (id: string) => s.setElos((xs) => xs.filter((e) => e.id !== id))
  const regenElo = (e: Elo) => s.setRegenModal({ kind: 'elo', item: e })
  const doRegenElo = async (e: Elo, extra: string) => {
    s.setRegenBusy(true)
    try {
      const res: unknown = await lessonPlanService.regenerateElo({
        ...ctx, chapter, elo: e.elo, bloom_level: e.bloom, co_id: e.coId, skills: e.skills, competencies: e.competencies,
        additional_instructions: extra.trim() || undefined,
      })
      // The reply may be a string, an ELO object, an array or a wrapper; the chokepoint handles every shape and
      // can never hand back raw model text.
      const text = cleanAiText(isRec(res) ? (res.elos || res.elo_obj || res) : res, { field: 'elo', op: 'regenerate' })
      if (!text.trim()) throw new Error('No content returned')
      s.setElos((xs) => xs.map((x) => (x.id === e.id ? { ...x, elo: text } : x)))
      toast('✓ Learning outcome regenerated')
    } catch (err) { toast(`✗ ${aiErrorMessage(err, 'Could not regenerate the learning outcome')}`) }
    finally { s.setRegenBusy(false); s.setRegenModal(null) }
  }
  const addCustomElo = () => {
    if (!s.ceCo || !s.ceBloom || !s.ceText.trim()) { toast('Select CO, Bloom level and enter a description'); return }
    const id = nextId('ce_')
    const num = Math.max(0, ...s.elos.map((x) => x.num)) + 1
    const text = s.ceText.trim()
    const bloom = s.ceBloom
    const coId = s.ceCo
    s.setElos((xs) => [...xs, { id, elo: text, bloom, skills: [], competencies: [], num, coId, custom: true }])
    // Seed Step-5/6 config for the new ELO and force a re-generate before the plan can be finalized.
    s.setAssessCfg((c) => ({ ...c, [id]: [defaultAssessRow()] }))
    s.setElo5eCfg((c) => (s.totalMins ? splitDuration(c, [id], s.totalMins) : { ...c, [id]: freshPhases() }))
    s.setGen((g) => ({ ...g, le: false }))
    s.setCeCo(''); s.setCeBloom(''); s.setCeText('')
    toast('Custom learning outcome added')
  }

  return {
    pickFile, clearFile, generateCOs,
    startEditObj, saveEditObj, deleteObj, undoDelete, regenObj, doRegenObj,
    updateCustomRow, saveCustomRow, addCustomRow, removeCustomRow, continueObjectives,
    toggleBloom, setBloomCount, toggleAttitude, removeAttitude, removeSkill, removeComp,
    addCustomSkill, addCustomComp, addCustomAtt,
    generateSkills: () => generateChips('skills'), generateComps: () => generateChips('comps'),
    generateELOs, startEditElo, saveEditElo, deleteElo, regenElo, doRegenElo, addCustomElo,
  }
}
