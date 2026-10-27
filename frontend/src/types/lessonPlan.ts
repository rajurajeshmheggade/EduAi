/* Lesson Plan (unit plan) + Session Plan types — the shapes the /ICMELive/api/v1/lessonplan API returns
   (ported from the Rapid / SARAS teacher console). */

// ───────────────────────────── scope
export interface LpSubject { subject_code: string; subject_name: string }
export interface LpClass { class_code: string; class_name: string; subjects: LpSubject[] }
export interface LpScope { classes: LpClass[]; boards: string[] }
export interface LpChapter { id: string; name: string; textbook_id: string; chapter_number: number; textbook_title: string }

// ───────────────────────────── generator responses
export interface CourseOutcome {
  co_id: string
  co_title: string
  co_description: string
  factor: string
  skills?: string[]
  competencies?: string[]
}
export interface CourseOutcomesResponse {
  board: string; grade: string; subject: string; chapter: string; total_outcomes: number; course_outcomes: CourseOutcome[]
}
export interface GeneratedElo {
  elo: string; bloom_level: string; co_id: string; Elo_id: string; skills: string[]; competencies: string[]
}
export interface CoWithElos extends CourseOutcome { elos: GeneratedElo[] }
export interface RawAssessmentItem {
  question?: string
  itemType?: string
  answer?: string
  bloomsLevel?: string
  options?: string[] | Record<string, string> | null
  context?: string | null
}
/** `{ "0": { eloname, assessment:[…] } }` */
export type AssessmentResponse = Record<string, { eloname: string; assessment: RawAssessmentItem[] }>
export interface FiveEResourceResponse { block: unknown; phase: string; resource: string }

// ───────────────────────────── saved plan JSON (what the Lesson Plan View renders)
export interface PlanAssessmentItem {
  itemType: string
  bloomsLevel?: string
  question: string
  options?: Record<string, string> | null
  answer?: string
  context?: string
}
export interface PlanAssessmentBlock { id: string; name: string; fullText: string; bloomLevel?: string; items: PlanAssessmentItem[] }
export interface PlanStep {
  id: string; name: string; stepTime: string; description?: string; resources: string[]
  resourceTimeAllocations?: Record<string, unknown>
}
export interface FiveEDesign {
  eloSteps: { elo: string; steps: PlanStep[] }[]
  /** keyed `${eloText}_${stepId}` → { [resourceName]: markdown } */
  generatedContentData: Record<string, Record<string, string>>
}
export interface PlanAssignment { title: string; purpose?: string; instructions?: string; submission?: string }
export interface PlanFiveEPhase { phase: string; color?: string; tint?: string; activities: { title?: string; description?: string }[] }
export interface PlanContent {
  grade?: string
  subject?: string
  topic?: string
  board?: string
  duration?: string
  plannedDate?: string
  executionPeriod?: string
  coreObjectives: { text: string; factor?: string }[]
  assessment: PlanAssessmentBlock[]
  elos: { id: string; text: string }[]
  fiveEDesign?: FiveEDesign
  fiveE?: PlanFiveEPhase[]
  assignments?: PlanAssignment[]
  pedagogicalApproaches?: string[]
  intelligenceTypes?: string[]
  /** The wizard's full state, so "Edit Draft" reopens the creator where the teacher left off. */
  __creatorState?: unknown
}

export type PlanSource = 'manual' | 'ai_bot'
export interface LessonPlanRow {
  id: string
  title: string
  classCode: string | null
  className: string
  subjectCode: string | null
  subjectName: string
  chapterName: string
  textbookId: string | null
  chapterNumber: number | null
  board: string | null
  durationMins: number
  isCompleted: boolean
  source: PlanSource
  createdAt: string
  updatedAt: string | null
  sessionCount: number
  plan: Partial<PlanContent>
}
export interface SavePlanBody {
  id?: string
  classCode: string | null
  className: string
  subjectCode: string | null
  subjectName: string
  chapterName: string
  textbookId?: string | null
  chapterNumber?: number | null
  unitPlanTitle: string
  board?: string | null
  durationMins: number
  plan: Partial<PlanContent>
  isCompleted: boolean
  source: PlanSource
}

// ───────────────────────────── sessions
export type SourceKind = 'resource' | 'textbook' | 'test' | 'question' | 'activity'
export type CardKind = 'video' | 'worksheet' | 'slides' | 'reference' | 'test' | 'question' | 'activity'

export interface SessionElo { elo: string; eloId?: string | null; bloomLevel?: string | null; coId?: string | null }
export interface SessionResourceRow {
  id: string
  resourceId: string | null
  sourceKind: SourceKind
  title: string
  resourceType: string | null
  url: string | null
  chapterName: string | null
  meta: string | null
  sortOrder: number
}
export interface SessionStageRow {
  id: string
  stage: string
  sortOrder: number
  classSetting: string | null
  durationMins: number
  description: string | null
  resources: SessionResourceRow[]
}
export interface AgentItem {
  title: string; url: string; snippet?: string | null; source?: string | null; date?: string | null
  thumbnail?: string | null; videoId?: string | null; width?: number | null; height?: number | null
}
export interface AgentStatus { status: 'ok' | 'empty' | 'unavailable' | 'not_configured'; provider: string; count: number; message?: string | null }
export type AgentKey = 'currentAffairs' | 'educationalVideos' | 'images' | 'educationalDocuments'

/** Generated session content — model output, so every field is optional and read defensively. */
export interface SessionContent {
  title?: string
  overview?: string
  prerequisiteKnowledge?: string
  specificObjectives?: unknown[]
  keyVocabulary?: { term?: string; definition?: string; example?: string }[]
  materials?: { name?: string; quantity?: string; notes?: string }[]
  stages?: {
    stage?: string; classSetting?: string; durationMins?: number; teacherNotes?: string
    steps?: unknown[]; questions?: unknown[]; resources?: { title?: string; name?: string; howToUse?: string }[]
  }[]
  assessment?: { type?: string; description?: string; successCriteria?: unknown[] }
  differentiation?: { extensions?: string; support?: string }
  realWorldExamples?: { example?: string; explanation?: string }[]
  discussionQuestions?: { question?: string; purpose?: string }[]
  homework?: string
  learningOutcomes?: unknown[]
  additionalSections?: Partial<Record<AgentKey, AgentItem[]>>
  error?: string
}

export interface SessionRow {
  id: string
  lessonPlanId: string
  sessionNo: number
  title: string
  durationMins: number
  instructions: string | null
  elos: SessionElo[]
  content: SessionContent
  agents: Partial<Record<AgentKey, AgentStatus>>
  status: 'draft' | 'completed'
  rowVersion: number
  classCode: string | null
  className: string
  subjectCode: string | null
  subjectName: string
  chapterName: string
  createdAt: string
  updatedAt: string | null
  resourceCount: number
  stageCount: number
  stages: SessionStageRow[]
}
export interface SessionListResponse {
  lessonPlanId: string; planTitle: string; className: string; subjectName: string; chapterName: string
  sessions: SessionRow[]; total: number; page: number; pageSize: number
}
export interface SessionElosResponse {
  lessonPlanId: string; chapterName: string; className: string; subjectName: string
  elos: SessionElo[]; count: number; status: 'S001' | 'S002'; message: string | null
}
export interface StageResourcePayload {
  resourceId: string | null; sourceKind: SourceKind; title: string; resourceType: string; url: string
  chapterName: string; meta: string; sortOrder: number
}
export interface StagePayload {
  stage: string; sortOrder: number; classSetting: string; durationMins: number; description: string
  resources: StageResourcePayload[]
}
export interface GenerateSessionBody {
  lessonPlanId: string
  id?: string
  rowVersion?: number
  title: string
  durationMins: number
  instructions: string
  elos: string[]
  stages: StagePayload[]
  includeAgents?: boolean
  save?: boolean
}
export interface GenerateSessionResponse {
  id: string | null; rowVersion: number; content: SessionContent; agents: Partial<Record<AgentKey, AgentStatus>>
}

// ───────────────────────────── resource library
export type AssetType = 'Resources' | 'Tests' | 'Questions' | 'Activities' | 'Video Catalogue'
export interface LibraryItem {
  resourceId: string
  sourceKind: SourceKind
  title: string
  kind: CardKind
  resourceType: string
  chapter: string
  url: string
  meta: string
  origin: string
  canDelete?: boolean
}
export interface LibraryResponse {
  assetType: AssetType; total: number; counts: Partial<Record<AssetType, number>>; groups: { chapter: string; items: LibraryItem[] }[]
}
export type ResourceType = 'Video' | 'Audio' | 'PDF' | 'Document' | 'Presentation' | 'Image' | 'Activity' | 'Link'

/** One question in the Launch window's wire shape. */
export interface WireQuestion {
  n: number; type: string; section: string; marks: number; html: string
  options: { html: string; correct: boolean }[]
  statements: { html: string; answer: boolean }[]
  pairs: { left: string; right: string }[]
  ar: { assertion: string; reason: string; answer: string }[]
  blanks: string[]; answer: string; hint: string
}
/** Pushed into the Launch window for a test / question / activity; always a payload, never a rejection. */
export type LaunchContent =
  | { mode: 'test'; title: string; meta: string; paper: WireQuestion[]; arOptions: string[]; arInstruction: string; key: boolean }
  | { mode: 'question'; title: string; meta: string; html: string; q: WireQuestion | null; arOptions: string[]; arInstruction: string; key: boolean }
  | { mode: 'activity'; title: string; meta: string; desc: string; files: { title: string; type: string; url: string }[] }
  | { mode: 'error'; message: string }
