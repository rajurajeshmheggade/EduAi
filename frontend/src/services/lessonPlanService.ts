/* Lesson Plan + Session Plan client (/ICMELive/api/v1/lessonplan). One place so the creator steps, the
   repository, the AI Bot assistant and the Session Manager share one client. Generation runs on EduAI's own
   AI provider; school and teacher always come from the bearer token, never the body. */
import axios from 'axios'
import { api } from './apiClient'
import type {
  AssessmentResponse, AssetType, CoWithElos, CourseOutcome, CourseOutcomesResponse, FiveEResourceResponse,
  GenerateSessionBody, GenerateSessionResponse, LaunchContent, LessonPlanRow, LibraryResponse, LpChapter, LpScope,
  ResourceType, SavePlanBody, SessionElosResponse, SessionListResponse, SessionRow, SourceKind, StagePayload,
} from '@/types/lessonPlan'

const B = '/ICMELive/api/v1/lessonplan'
const S = `${B}/sessions`

const post = async <T>(path: string, body: unknown): Promise<T> => (await api.post<T>(`${B}/${path}`, body)).data
const spost = async <T>(path: string, body: unknown): Promise<T> => (await api.post<T>(`${S}/${path}`, body)).data

/** Generator context every step sends: names go into the prompt, codes drive the server's scope check. */
export interface GenCtx { board?: string; grade: string; subject: string; class_code?: string; subject_code?: string }

export const lessonPlanService = {
  // ── scope
  async scope(): Promise<LpScope> { return (await api.get<LpScope>(`${B}/scope`)).data },
  async chapters(classCode: string, subjectCode: string): Promise<LpChapter[]> {
    return (await api.get<{ chapters: LpChapter[] }>(`${B}/chapters`, { params: { class_code: classCode, subject_code: subjectCode } })).data.chapters
  },
  async extractText(file: File): Promise<string> {
    const fd = new FormData()
    fd.append('file', file)
    return (await api.post<{ text: string }>(`${B}/extract-text`, fd)).data.text
  },

  // ── 7-step creator
  courseOutcomes: (b: GenCtx & { chapter: string; co_count: number; reference_text?: string; textbook_id?: string | null; chapter_number?: number | null }) =>
    post<CourseOutcomesResponse>('course-outcomes', b),
  regenerateCourseOutcome: (b: GenCtx & { chapter: string; course_outcome: string; co_title?: string; factor?: string; additional_instructions?: string }) =>
    post<{ course_outcome: CourseOutcome }>('regenerate-course-outcome', b),
  skillsPerCo: (b: GenCtx & { chapter: string; total_outcomes: number; course_outcomes: CourseOutcome[] }) =>
    post<CourseOutcomesResponse>('skills-per-co', b),
  competenciesPerCo: (b: GenCtx & { chapter: string; total_outcomes: number; course_outcomes: CourseOutcome[] }) =>
    post<CourseOutcomesResponse>('competencies-per-co', b),
  elos: (b: GenCtx & { chapter: string; course_outcomes: CourseOutcome[]; blooms_elo_counts: Record<string, number>; skills: string[]; competencies: string[]; attitudes: string[] }) =>
    post<CoWithElos[]>('elos', b),
  regenerateElo: (b: GenCtx & { chapter: string; elo: string; bloom_level: string; co_id?: string; skills?: string[]; competencies?: string[]; additional_instructions?: string }) =>
    post<{ elo: string }>('regenerate-elo', b),
  pedagogicalApproaches: (b: GenCtx & { chapter: string; elos: string[] }) =>
    post<{ approaches: string[] }>('pedagogical-approaches', b),
  assessmentItems: (b: GenCtx & { topic: string; elo: string; course_outcome?: string; Bloom_level?: string; additional_instructions?: string;
    assessment_details: { itemType: string; noOfItems: number; includeLOTS?: boolean; bloomsLevel?: string }[] }) =>
    post<AssessmentResponse>('assessment-items', b),
  fiveEResource: (b: GenCtx & { chapter: string; elo: string; merged_elos?: string[]; phase: string; resource: string; est_time: string;
    generate_images: boolean; course_outcome?: string; pedagogical_approaches: string[]; intelligence_types: string[] }) =>
    post<FiveEResourceResponse>('five-e-resource', b),
  assignments: (b: GenCtx & { chapter: string; elos: string[]; course_outcomes?: CourseOutcome[] }) =>
    post<{ assignments: unknown }>('assignments', b),

  // ── repository
  savePlan: (b: SavePlanBody) => post<{ id: string }>('save-unit-plan', b),
  async listPlans(): Promise<LessonPlanRow[]> { return (await api.get<{ plans: LessonPlanRow[] }>(`${B}/plans`)).data.plans },
  async getPlan(id: string): Promise<LessonPlanRow> { return (await api.get<{ plan: LessonPlanRow }>(`${B}/plans/${encodeURIComponent(id)}`)).data.plan },
  async deletePlan(id: string): Promise<void> { await api.delete(`${B}/plans/${encodeURIComponent(id)}`) },

  // ── AI Bot assistant
  async assistantChat(messages: { role: 'user' | 'assistant'; content: string }[], context?: { chaptersLoaded: boolean; label?: string; chapters?: string[] }): Promise<string> {
    return (await post<{ response: string }>('assistant/chat', { messages, context })).response
  },
  assessmentMix: (text: string) =>
    post<{ assessment_requirements?: Record<string, number>; clarify?: string }>('assistant/assessment-mix', { text }),
}

export const sessionPlanService = {
  /** The parent plan's saved ELOs. status 'S002' + count 0 is the legitimate empty state, not an error. */
  getSessionElos: (lessonPlanId: string) => spost<SessionElosResponse>('elos', { lessonPlanId }),
  listSessions: (b: { lessonPlanId: string; search?: string; status?: string; page?: number; pageSize?: number }) =>
    spost<SessionListResponse>('list', b),
  async getSession(id: string): Promise<SessionRow> { return (await spost<{ session: SessionRow }>('get', { id })).session },
  saveSession: (b: { id?: string; lessonPlanId: string; rowVersion?: number; sessionNo?: number; title: string; durationMins: number;
    instructions?: string; status?: string; elos?: unknown[]; stages: StagePayload[] }) =>
    spost<{ id: string; rowVersion: number; sessionNo: number }>('save', b),
  deleteSession: (id: string) => spost<{ id: string; deleted: number }>('delete', { id }),
  /** Generate on EduAI's AI provider, splice in the live agent blocks and (save:true) persist in one round trip. */
  generateSession: (b: GenerateSessionBody) => spost<GenerateSessionResponse>('generate', b),

  async resourceLibrary(p: { classCode: string; subjectCode: string; chapter?: string; assetType?: AssetType; search?: string; limit?: number }): Promise<LibraryResponse> {
    return (await api.get<LibraryResponse>(`${S}/resource-library`, { params: p })).data
  },
  async resourceContent(sourceKind: SourceKind, resourceId: string): Promise<LaunchContent> {
    return (await api.get<LaunchContent>(`${S}/resource-content`, { params: { sourceKind, resourceId } })).data
  },
  async addResource(p: { classCode: string; subjectCode: string; title: string; resourceType: ResourceType; chapter?: string; url?: string; description?: string; file?: File | null }) {
    const fd = new FormData()
    fd.append('classCode', p.classCode)
    fd.append('subjectCode', p.subjectCode)
    fd.append('title', p.title)
    fd.append('resourceType', p.resourceType)
    if (p.chapter) fd.append('chapter', p.chapter)
    if (p.url) fd.append('url', p.url)
    if (p.description) fd.append('description', p.description)
    if (p.file) fd.append('file', p.file)
    return (await api.post<{ resourceId: string }>(`${S}/resources`, fd)).data
  },
  async deleteResource(id: string) { await api.delete(`${S}/resources/${encodeURIComponent(id)}`) },
}

/** HTTP status of a failed call (0 when it never reached the server). */
export function httpStatus(e: unknown): number {
  return axios.isAxiosError(e) ? (e.response?.status ?? 0) : 0
}

function detailOf(e: unknown): string {
  if (!axios.isAxiosError(e)) return ''
  const d = (e.response?.data as { detail?: unknown } | undefined)?.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map((x: { msg?: string }) => x.msg).filter(Boolean).join('; ')
  return ''
}

/** A failed WRITE (save / generate / delete) in words a teacher can act on. The server's own detail wins. */
export function sessionErrorMessage(e: unknown, fallback = 'The session could not be saved.'): string {
  const detail = detailOf(e)
  if (detail) return detail
  const s = httpStatus(e)
  if (s === 401) return 'Your session expired. Sign in again and try once more.'
  if (s === 403) return 'You don’t have access to this lesson plan.'
  if (s === 409) return 'This session was changed elsewhere. Reopen it and apply your changes again.'
  if (s >= 500) return 'The server had a problem. Please try again in a moment.'
  if (s === 404) return `${fallback} Go back to the repository, reopen the lesson plan and try again.`
  return e instanceof Error ? e.message : fallback
}

/** Why a READ failed, or '' when it is not a failure: a 404 on a collection means "nothing here yet". */
export function sessionReadError(e: unknown, what = 'The sessions could not be loaded.'): string {
  const s = httpStatus(e)
  if (s === 404) return ''
  const detail = detailOf(e)
  if (detail) return detail
  if (s === 403) return 'You don’t have access to the sessions of this lesson plan.'
  if (s === 401) return 'Your session expired. Sign in again and reopen this lesson plan.'
  if (s >= 500) return 'The server had a problem loading these sessions. Please try again in a moment.'
  return e instanceof Error ? e.message : what
}

/** Any failed generator call, for toasts. */
export function aiErrorMessage(e: unknown, fallback: string): string {
  return detailOf(e) || (e instanceof Error ? e.message : '') || fallback
}
