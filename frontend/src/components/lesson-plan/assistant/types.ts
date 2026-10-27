/* Shared types of the AI Bot Lesson Plan Assistant (port of the `lessonplan` mode of Rapid's ChatBotScreen). */
import type { GenCtx } from '@/services/lessonPlanService'
import type { CourseOutcome, GeneratedElo, LpChapter } from '@/types/lessonPlan'

export type Role = 'user' | 'assistant'
/** One visible chat turn. `busy` marks a transient progress line ("Generating …") that the next reply replaces. */
export interface Msg { id: number; role: Role; content: string; busy?: boolean }

/** Where the generation pipeline stands — drives the deterministic (no model round trip) advancement. */
export type Stage = 'cos' | 'elos' | 'assessment_question' | 'awaiting_assessment_input' | 'fivee' | 'complete'

/** One (class, subject) pair the teacher is assigned to — the flattened `scope` prop. */
export interface ScopeRow { classCode: string; className: string; subjectCode: string; subjectName: string }

/** Generator context with the RESOLVED ids. Every generator call spreads it so the server's scope check passes. */
export interface ResolvedCtx extends GenCtx { board: string; grade: string; subject: string; class_code: string; subject_code: string }

/** The [START_LESSON_PIPELINE] payload, validated. */
export interface LessonInputs {
  class_name: string
  subject_name: string
  chapter_name: string
  co_count: number
  duration_mins: number
  blooms_counts: Record<string, number>
  attitudes: string[]
}

export interface AssessItem { question: string; options: string[]; answer: string; itemType: string; context: string }
export interface AssessBlock { id: string; items: AssessItem[] }
export interface FiveEStep { name: string; stepTime: string; description: string }
export interface FiveE { eloSteps: { elo: string; steps: FiveEStep[] }[] }
export interface Assignment { title: string; purpose: string; instructions: string; submission: string }

export type AssessKey = 'mcq' | 'true_false' | 'short_answer' | 'long_answer' | 'case_study'
export type AssessReqs = Record<AssessKey, number>

export interface Pipeline {
  stage: Stage
  inputs: LessonInputs
  /** Resolved class name — what the generators receive as `grade`. */
  grade: string
  cos: CourseOutcome[]
  elos: GeneratedElo[]
  assessment: AssessBlock[]
  assignments: Assignment[]
  fiveE: FiveE | null
  /** The chapter is not in the class+subject's indexed textbooks: it can be generated but NOT saved. */
  offCurriculum: boolean
  ctx: ResolvedCtx
  /** The indexed textbook chapter it matched (textbook grounding + saved ids), null when none. */
  chapter: LpChapter | null
  /** The accumulated free-form assessment-mix reply while the AI asks for clarification. */
  assessInput?: string
}

/** The parts of a generated plan the preview / export / save need. */
export type PlanParts = Pick<Pipeline, 'inputs' | 'cos' | 'elos' | 'assessment' | 'assignments' | 'fiveE'>

/** Chapters loaded for the class+subject the bot named in [LIST_CHAPTERS]. */
export interface ChaptersCtx { label: string; list: string[]; chapters: LpChapter[]; row: ScopeRow }

/** One send(): the transcript it started from and a guarded `say` that drops results of a reset conversation. */
export interface Turn {
  visible: Msg[]
  say: (content: string, busy?: boolean) => void
  live: () => boolean
}

export interface Box<T> { current: T }

/** Everything the turn handler / pipeline reads and writes, held by the container as refs. */
export interface AssistantDeps {
  rows: ScopeRow[]
  pipe: Box<Pipeline | null>
  /** The last complete plan shown, for a later "download". */
  lesson: Box<Pipeline | null>
  saved: Box<boolean>
  chapters: Box<ChaptersCtx | null>
  /** The class the teacher entered once it is confirmed as one they are assigned to. */
  classOk: Box<string | null>
  onSaved: () => void
}
