/* Session Resources — the editor's value model and the pure helpers around it (ported from the bottom of
   Rapid's SessionResources.jsx). Kept out of the component module so the screens and the Session Manager
   can import them without pulling the whole picker in; SessionResources.tsx re-exports them. */
import { SETTINGS, STAGES, STAGE_DESC } from '@/components/lesson-plan/data'
import type { CardKind, LessonPlanRow, SessionRow, SourceKind, StagePayload } from '@/types/lessonPlan'
import { sanitizeHtml } from './sanitizeHtml'

/** One resource picked into a stage. */
export interface PickedResource {
  /** Row identity inside the editor (resKey + timestamp, or 'r' + the saved row id). */
  id: string
  resourceId: string | null
  sourceKind: SourceKind
  name: string
  /** The card kind — drives the thumbnail and the badge. */
  type: CardKind
  /** The real ResourceType stored on the row. */
  resourceType: string
  url: string
  chapter: string
  meta: string
}

export interface StageValue {
  /** HTML from the Description editor. */
  desc: string
  setting: string
  /** Digits only, as typed. */
  duration: string
  files: PickedResource[]
}

export interface ResourcesValue {
  klass: string
  subject: string
  chapter: string
  /** The session name (preview / launch header). */
  name?: string
  duration: string
  /** The Resource Category being edited. */
  stage: string
  stages: Record<string, StageValue>
}

/** Card kinds → label + the light tint the cards use (Rapid's KINDS, as Tailwind tints). */
export const KINDS: Record<CardKind, { label: string; tint: string; fg: string }> = {
  video: { label: 'Video', tint: 'bg-pink-50', fg: 'text-pink-600' },
  worksheet: { label: 'Worksheet', tint: 'bg-orange-50', fg: 'text-orange-600' },
  slides: { label: 'Slides', tint: 'bg-violet-50', fg: 'text-violet-600' },
  reference: { label: 'Reference', tint: 'bg-blue-50', fg: 'text-blue-600' },
  test: { label: 'Test', tint: 'bg-emerald-50', fg: 'text-emerald-600' },
  question: { label: 'Question', tint: 'bg-yellow-50', fg: 'text-yellow-700' },
  activity: { label: 'Activity', tint: 'bg-sky-50', fg: 'text-sky-600' },
}
export const isCardKind = (k: unknown): k is CardKind => typeof k === 'string' && Object.prototype.hasOwnProperty.call(KINDS, k)

export const blankStage = (s: string): StageValue => ({ desc: STAGE_DESC[s] || '', setting: SETTINGS[0], duration: '', files: [] })

const blankStages = (): Record<string, StageValue> => Object.fromEntries(STAGES.map((s) => [s, blankStage(s)]))

/** A blank Session Resources value for a plan. Class/subject/chapter come from the saved lesson plan row. */
export function defaultResources(plan: Pick<LessonPlanRow, 'className' | 'subjectName' | 'chapterName'> | null | undefined): ResourcesValue {
  return {
    klass: String(plan?.className ?? '').trim(),
    subject: String(plan?.subjectName ?? '').trim(),
    chapter: String(plan?.chapterName ?? '').trim(),
    duration: '',
    stage: STAGES[0],
    stages: blankStages(),
  }
}

/** The same ResourceType → card-kind mapping the server applies, for rows read back from the DB. */
export function kindOfType(resourceType: unknown): CardKind {
  switch (String(resourceType || '').toLowerCase()) {
    case 'video': case 'audio': return 'video'
    case 'presentation': case 'image': return 'slides'
    case 'document': return 'worksheet'
    case 'activity': return 'activity'
    case 'test': return 'test'
    case 'question': return 'question'
    default: return 'reference'
  }
}

const SOURCE_KINDS: SourceKind[] = ['resource', 'textbook', 'test', 'question', 'activity']
const asSourceKind = (v: unknown): SourceKind => (SOURCE_KINDS as string[]).includes(String(v)) ? (v as SourceKind) : 'resource'

/** Rebuild the Session Resources value from a SAVED session row, so Preview opens on exactly what was
 *  stored. Nothing is seeded — a stage the session never touched stays blank. */
export function resourcesFromSession(plan: Pick<LessonPlanRow, 'className' | 'subjectName' | 'chapterName'> | null | undefined,
  session: SessionRow | null | undefined): ResourcesValue {
  const base = defaultResources(plan)
  const stages = blankStages()
  const rows = session && Array.isArray(session.stages) ? session.stages : []
  rows.forEach((row) => {
    if (!row || !STAGES.includes(row.stage)) return
    const key = row.stage
    stages[key] = {
      desc: row.description || STAGE_DESC[key] || '',
      setting: row.classSetting || SETTINGS[0],
      duration: row.durationMins ? String(row.durationMins) : '',
      files: (Array.isArray(row.resources) ? row.resources : []).map((r) => {
        const src = String(r.sourceKind || '').toLowerCase()
        const rt = String(r.resourceType || '').toLowerCase()
        return {
          id: 'r' + r.id,
          resourceId: r.resourceId || null,
          sourceKind: asSourceKind(r.sourceKind),
          name: r.title || 'Untitled resource',
          // The card kind follows the SOURCE catalogue first: a Test's stored resourceType is its test TYPE
          // and a question's is "Question", neither of which is a card kind on its own.
          type: isCardKind(src) ? src : isCardKind(rt) ? rt : kindOfType(r.resourceType),
          resourceType: r.resourceType || '',
          url: r.url || '',
          chapter: r.chapterName || '',
          meta: r.meta || '',
        }
      }),
    }
  })
  return {
    ...base,
    // The saved row carries its own class / subject / chapter; prefer them when present.
    klass: String(session?.className || base.klass).trim(),
    subject: String(session?.subjectName || base.subject).trim(),
    chapter: String(session?.chapterName || base.chapter).trim(),
    name: (session && session.title) || '',
    duration: session && session.durationMins ? String(session.durationMins) : '',
    stage: STAGES[0],
    stages,
  }
}

/** Flatten the editor value into the { stages:[…] } payload /sessions/save and /sessions/generate take. */
export function stagesPayload(value: ResourcesValue | null | undefined): StagePayload[] {
  const bag = value?.stages ?? {}
  return STAGES.map((stage, i) => {
    const s = bag[stage] ?? blankStage(stage)
    const files = s.files || []
    return {
      stage,
      sortOrder: i,
      classSetting: s.setting && s.setting !== 'Select' ? s.setting : '',
      durationMins: parseInt(s.duration, 10) || 0,
      // Stored exactly as the editor wrote it, minus anything outside the formatting allow-list.
      description: sanitizeHtml(s.desc || ''),
      resources: files.map((f, fi) => ({
        resourceId: f.resourceId || null,
        sourceKind: f.sourceKind || 'resource',
        title: f.name,
        resourceType: f.resourceType || '',
        url: f.url || '',
        chapterName: f.chapter || '',
        meta: f.meta || '',
        sortOrder: fi,
      })),
    }
  }).filter((s) => s.resources.length > 0 || (s.description || '').replace(/<[^>]*>/g, '').trim().length > 0 || s.durationMins > 0)
}
