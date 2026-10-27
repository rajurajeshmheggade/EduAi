/* Lesson Plan Creator — wizard model: state shapes + pure helpers (port of Rapid's LessonPlanCreator.jsx).
   Nothing here touches React state; the store (useCreatorStore) and the action modules build on it. */
import type { LucideIcon } from 'lucide-react'
import { BookOpen, ChartColumn, CircleCheckBig, FileCheck, Lightbulb, Target } from 'lucide-react'
import type { ResourceBlock } from '@/lib/lessonPlan/normalize'
import type { AssessmentResponse, CourseOutcome, LpScope, RawAssessmentItem } from '@/types/lessonPlan'
import { FIVE_E_PHASES } from '../data'

// ───────────────────────────── state shapes
export interface Objective { id: string; category: string; description: string; title?: string; ai: boolean; deleted: boolean }
export interface CustomRow { factor: string; description: string }
export interface Elo {
  id: string; elo: string; bloom: string; skills: string[]; competencies: string[]; num: number; coId?: string; custom?: boolean
}
/** One assessment config row the teacher fills in — each becomes an `assessment_details` entry for the AI. */
export interface AssessRow { noOfItems: number | ''; itemType: string; includeLOTS: boolean }
/** A validated resource block, or a typed failure marker (the card then shows the fallback state, never JSON). */
export type ResContent = ResourceBlock | { error: string }
/** One 5E resource card = one AI block. */
export interface ResourceCard { rid: string; name: string; estTime: string; content: ResContent | null; expanded: boolean; editing?: boolean }
export interface PhaseCfg { time: string; genImages: boolean; resources: ResourceCard[] }
/** eloId → phaseKey → config */
export type EloCfgMap = Record<string, Record<string, PhaseCfg>>
export interface GenFlags { co: boolean; elo: boolean; assess: boolean; le: boolean }
/** An assessment item in render shape (options keyed A, B, …). */
export interface NormItem {
  itemType: string; bloomsLevel: string; question: string; context: string; options: Record<string, string> | null; answer: string
}
export interface EditItemState { eloId: string; idx: number; question: string; answer: string; options: Record<string, string> | null }
export type PreviewItem = NormItem & { n: number }
export type RegenTarget =
  | { kind: 'obj'; item: Objective }
  | { kind: 'elo'; item: Elo }
  | { kind: 'assessItem'; elo: Elo; idx: number; rawItem: RawAssessmentItem }
/** A 5E tab: a standalone ELO, or a merged group of ELOs. */
export interface TabUnit { type: 'elo' | 'group'; key: string; elos: Elo[] }
/** Which step is generating — drives the full-page loader. */
export type Busy = '' | 'co' | 'skills' | 'comps' | 'elo' | 'ped' | '5e' | 'create' | 'draft' | `assess:${string}` | `res:${string}`

/** The wizard DATA stored in the saved plan (plan.__creatorState) so "Edit Draft" resumes where the teacher left off. */
export interface CreatorSnapshot {
  current: number; done: number[]
  board: string; classCode: string; subjectCode: string; className: string; subjectName: string
  textbookId: string | null; chapterNumber: number | null; chapter: string; hours: string; minutes: string
  gen: GenFlags; rawCos: CourseOutcome[]
  assessCfg: Record<string, AssessRow[]>; assessByElo: Record<string, AssessmentResponse>; assessOpen: Record<string, boolean>
  leModel: string; pedDone: boolean; pedApproaches: string[]; intelSel: string[]; mergeGroups: string[][]; elo5eCfg: EloCfgMap
  objectives: Objective[]; deletedStack: string[]; blooms: string[]; bloomCounts: Record<string, string>
  skills: string[]; comps: string[]; attitudes: string[]; elos: Elo[]
}

export const STEPS: { n: number; title: string; desc: string; icon: LucideIcon }[] = [
  { n: 1, title: 'Basic Setup & Content', desc: 'Configure your lesson basics and upload materials', icon: BookOpen },
  { n: 2, title: 'Manage Objectives', desc: 'Select learning objectives', icon: Target },
  { n: 3, title: 'Expected Learning Outcomes', desc: 'Define learning outcomes', icon: FileCheck },
  { n: 4, title: 'Objective Mapping', desc: 'Connect objectives to outcomes', icon: Target },
  { n: 5, title: 'Assessment', desc: 'Create assessment items for ELOs', icon: ChartColumn },
  { n: 6, title: 'Learning Experience', desc: 'Design learning activities', icon: Lightbulb },
  { n: 7, title: 'Review & Create', desc: 'Finalize your lesson plan', icon: CircleCheckBig },
]

export const OTHER_CHAPTER = '__other__'
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const UPLOAD_EXT = /\.(pdf|txt|docx)$/i

// ───────────────────────────── small helpers
export const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export const uniq = <T>(xs: T[]): T[] => Array.from(new Set(xs))
/** Comma / newline separated custom entry → trimmed values. */
export const parseCustom = (v: string) => v.split(/[,\n]/).map((x) => x.trim()).filter(Boolean)
export const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []
export const firstStr = (...vs: unknown[]): string => {
  for (const v of vs) if (typeof v === 'string' && v.trim()) return v
  return ''
}
let SEQ = 0
/** Collision-free ids, also across a restored draft (a plain counter would restart at the same value). */
export const nextId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(++SEQ).toString(36)}`

// ───────────────────────────── assessment
/** A fresh config row starts empty (0 items, no item type) so the teacher fills it in; Bloom comes from the ELO. */
export const defaultAssessRow = (): AssessRow => ({ noOfItems: 0, itemType: '', includeLOTS: true })

/** API item → render shape (options array → { A, B, … }). */
export const normAssessItem = (it: RawAssessmentItem): NormItem => ({
  itemType: it.itemType || 'mcq',
  bloomsLevel: it.bloomsLevel || '',
  question: it.question || '',
  context: it.context || '',
  options: Array.isArray(it.options)
    ? Object.fromEntries(it.options.map((v, k) => [String.fromCharCode(65 + k), String(v)]))
    : (isRec(it.options) ? it.options : null),
  answer: it.answer || '',
})

/** The item list inside an assessment-items reply ({ "0": { eloname, assessment:[…] } }). */
export const rawAssessItems = (res: AssessmentResponse | null | undefined): RawAssessmentItem[] => {
  if (!isRec(res)) return []
  const b = Object.values(res).find((x) => isRec(x) && Array.isArray(x.assessment))
  return b ? b.assessment : []
}
export const assessKey = (res: AssessmentResponse): string | undefined =>
  Object.keys(res).find((k) => isRec(res[k]) && Array.isArray(res[k].assessment))
export const itemsFromAssessRes = (res: AssessmentResponse | null | undefined) => rawAssessItems(res).map(normAssessItem)

// ───────────────────────────── 5E learning experience
/** Default per-phase config: total time · generate-images · resource cards. */
export const defaultPhaseCfg = (): PhaseCfg => ({ time: '30', genImages: false, resources: [] })
export const freshPhases = (): Record<string, PhaseCfg> => Object.fromEntries(FIVE_E_PHASES.map((p) => [p.key, defaultPhaseCfg()]))
export const newResource = (name: string): ResourceCard => ({ rid: nextId('r'), name, estTime: '5', content: null, expanded: true })

/** Split a phase's total time equally across its resources (remainder to the first ones), so each resource's
    "Estimated Time" is always the phase time divided evenly. */
export const allotTimes = (total: string, rs: ResourceCard[]): ResourceCard[] => {
  const n = rs.length
  if (!n) return rs
  const t = Math.max(0, parseInt(total, 10) || 0)
  const base = Math.floor(t / n)
  const rem = t - base * n
  return rs.map((r, i) => ({ ...r, estTime: String(base + (i < rem ? 1 : 0)) }))
}

/** The Basic-Setup Time Duration is split EQUALLY across the 5 phases of every ELO, then each phase's time
    across its resources (allotTimes). */
export const splitDuration = (cfg: EloCfgMap, ids: string[], total: number): EloCfgMap => {
  const n = FIVE_E_PHASES.length
  const base = Math.floor(total / n)
  const rem = total - base * n
  const next: EloCfgMap = { ...cfg }
  ids.forEach((id) => {
    const forElo = { ...(next[id] ?? {}) }
    FIVE_E_PHASES.forEach((ph, i) => {
      const cur = { ...defaultPhaseCfg(), ...(forElo[ph.key] ?? {}) }
      cur.time = String(base + (i < rem ? 1 : 0))
      cur.resources = allotTimes(cur.time, cur.resources)
      forElo[ph.key] = cur
    })
    next[id] = forElo
  })
  return next
}

export const isErrBlock = (c: ResContent | null | undefined): c is { error: string } => !!c && 'error' in c

/** Message on the full-page loader while a given AI step runs. */
export const busyLabel = (b: Busy): string => {
  if (!b) return ''
  if (b === 'co') return 'Generating course outcomes…'
  if (b === 'skills') return 'Generating skills…'
  if (b === 'comps') return 'Generating competencies…'
  if (b === 'elo') return 'Generating learning outcomes…'
  if (b === 'ped') return 'Generating pedagogical approaches…'
  if (b === '5e') return 'Generating the 5E model…'
  if (b === 'create') return 'Saving your lesson plan…'
  if (b === 'draft') return 'Saving your draft…'
  if (b.startsWith('assess')) return 'Generating assessment items…'
  if (b.startsWith('res:')) return 'Generating activity content…'
  return 'Generating…'
}

// ───────────────────────────── draft restore
/** Untrusted saved wizard state → the fields that look right. Accepts Rapid's legacy gradeSel/subjectSel names. */
export function readDraft(d: unknown): Partial<CreatorSnapshot> {
  if (!isRec(d)) return {}
  const s = (v: unknown) => (typeof v === 'string' ? v : undefined)
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined)
  const arr = <T>(v: unknown) => (Array.isArray(v) ? (v as T[]) : undefined)
  const rec = <T>(v: unknown) => (isRec(v) ? (v as T) : undefined)
  return {
    current: num(d.current), done: arr<number>(d.done),
    board: s(d.board), classCode: s(d.classCode), subjectCode: s(d.subjectCode),
    className: s(d.className) ?? s(d.gradeSel), subjectName: s(d.subjectName) ?? s(d.subjectSel),
    textbookId: s(d.textbookId) ?? null, chapterNumber: num(d.chapterNumber) ?? null,
    chapter: s(d.chapter), hours: s(d.hours), minutes: s(d.minutes),
    gen: rec<GenFlags>(d.gen), rawCos: arr<CourseOutcome>(d.rawCos),
    assessCfg: rec(d.assessCfg), assessByElo: rec(d.assessByElo), assessOpen: rec(d.assessOpen),
    leModel: s(d.leModel), pedDone: bool(d.pedDone), pedApproaches: arr<string>(d.pedApproaches), intelSel: arr<string>(d.intelSel),
    mergeGroups: arr<string[]>(d.mergeGroups), elo5eCfg: rec<EloCfgMap>(d.elo5eCfg),
    objectives: arr<Objective>(d.objectives), deletedStack: arr<string>(d.deletedStack),
    blooms: arr<string>(d.blooms), bloomCounts: rec(d.bloomCounts),
    skills: arr<string>(d.skills), comps: arr<string>(d.comps), attitudes: arr<string>(d.attitudes), elos: arr<Elo>(d.elos),
  }
}

/** Initial class: the draft's class, else the repository filter, else the only class the teacher has. */
export function pickClass(scope: LpScope, init: Partial<CreatorSnapshot>, def?: string): string {
  const has = (code?: string) => !!code && scope.classes.some((c) => c.class_code === code)
  if (init.classCode && has(init.classCode)) return init.classCode
  const byName = init.className ? scope.classes.find((c) => c.class_name === init.className) : undefined
  if (byName) return byName.class_code
  if (def && has(def)) return def
  return scope.classes.length === 1 ? scope.classes[0].class_code : ''
}

export function pickSubject(scope: LpScope, classCode: string, init: Partial<CreatorSnapshot>, def?: string): string {
  const subs = scope.classes.find((c) => c.class_code === classCode)?.subjects ?? []
  const has = (code?: string) => !!code && subs.some((x) => x.subject_code === code)
  if (init.subjectCode && has(init.subjectCode)) return init.subjectCode
  const byName = init.subjectName ? subs.find((x) => x.subject_name === init.subjectName) : undefined
  if (byName) return byName.subject_code
  if (def && has(def)) return def
  return subs.length === 1 ? subs[0].subject_code : ''
}
