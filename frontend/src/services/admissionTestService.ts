import { api } from './apiClient'

/** Admission tests (teacher authoring, launch, live monitor, results, reports). Org admins read only. */
const BASE = '/ICMELive/api/v1/admission'

export type AdmQType = 'MCQ' | 'MULTI' | 'NUMERICAL' | 'SHORT' | 'DESCRIPTIVE' | 'SJT' | 'REFLECTIVE' | 'IDEAS'
export type SectionKind = 'ACADEMIC' | 'APTITUDE' | 'LANGUAGE' | 'HQ'
export type HqDimension = 'IQ' | 'EQ' | 'SQ' | 'AQ' | 'CQ'
export type AgeBand = '6-8' | '9-11' | '12-14' | '15-17'

export interface AdmSection { key: string; title: string; kind: SectionKind }
export interface RubricItem { criterion: string; marks: number }

export interface AdmQuestion {
  question_id: string
  test_id: string
  section: string
  qtype: AdmQType
  prompt: string
  options: string[]
  answer_key: { option?: number; options?: number[]; value?: number; tolerance?: number; accept?: string[]; regex?: string | null; points?: number[] } | null
  rubric: RubricItem[]
  model_answer: string | null
  marks: number
  topic: string | null
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' | null
  hq_dimension: HqDimension | null
  origin: 'IMPORTED' | 'HQ_BANK' | 'AI_DRAFT' | 'MANUAL'
  source_eval_test_id: string | null
  source_master_q_id: string | null
  source_label: string | null
  hq_item_id: string | null
  status: 'DRAFT' | 'APPROVED'
  display_order: number
}

export type QuestionInput = Pick<AdmQuestion, 'section' | 'qtype' | 'prompt' | 'options' | 'answer_key' | 'rubric' | 'model_answer' | 'marks'
  | 'topic' | 'difficulty' | 'hq_dimension' | 'status'>

export type Preset = 'strict' | 'standard' | 'lenient'
export interface ProctoringConfig { preset: Preset; require_camera: boolean; require_screen_share: boolean; rules: Record<string, boolean> }
export interface ScoringConfig { w_academic: number; w_hq: number; bands: { strong: number; recommended: number; borderline: number } }

export interface AdmTest {
  test_id: string
  title: string
  grade_applying: string
  instructions: string | null
  duration_minutes: number
  sections: AdmSection[]
  shuffle: { questions: boolean; options: boolean }
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  created_by: string
  owner_name: string | null
  published_at: string | null
  created_at: string
  updated_at: string
  proctoring_config: ProctoringConfig
  scoring_config: ScoringConfig
  age_band: AgeBand
  question_count: number
  drafts: number
  academic_marks: number
  sessions: number
  completed: number
  questions?: AdmQuestion[]
}

export type TestInput = Pick<AdmTest, 'title' | 'grade_applying' | 'instructions' | 'duration_minutes'> &
  Partial<Pick<AdmTest, 'sections' | 'shuffle' | 'proctoring_config' | 'scoring_config'>>

export interface FlagMeta { code: string; label: string; severity: 'Info' | 'Low' | 'Med' | 'High' | 'Crit'; points: number; cap: number; warn: string; pause: boolean; server: boolean }
export interface TestMeta {
  flags: FlagMeta[]
  presets: Record<Preset, { points: number; durations: number; max_warnings: number; critical_limit: number; auto_submit_below: number }>
  proctoring: ProctoringConfig
  scoring: ScoringConfig
  age_bands: AgeBand[]
  tunables: { evidence_retention_days: number; calibration_seconds: number; max_answer_chars: number; exam_token_ttl_minutes: number }
}

export interface BankQuestion {
  master_q_id: string
  eval_test_id: string
  sl_no: string
  question_type: 'MCQ' | 'SHORT_ANSWER' | 'DESCRIPTIVE' | 'NUMERICAL'
  question_text: string
  mcq_options: string[]
  correct_option: string | null
  max_marks: number
  model_answer_text: string
  key_rubric_points: string[]
  test_title: string
  assessment_type: 'ASSIGNMENT' | 'ONLINE_TEST'
  class_code: string
  class_name: string
  subject_code: string
  subject_name: string
  chapter_title: string | null
  source_label: string
}
export interface BankSource { eval_test_id: string; test_title: string; assessment_type: 'ASSIGNMENT' | 'ONLINE_TEST'; class_code: string; class_name: string; subject_code: string; subject_name: string }
export interface BankFilters { class_code?: string; subject_code?: string; assessment_type?: string; qtype?: string; q?: string; chapter?: string; page?: number }

export interface HqItem { item_id: string; age_band: AgeBand; qtype: 'SJT' | 'REFLECTIVE' | 'IDEAS'; prompt: string; options: string[]; answer_key: { points: number[] } | null; hq_dimension: HqDimension }

export interface Candidate {
  candidate_id: string
  full_name: string
  email: string | null
  phone: string | null
  dob: string
  grade_applying: string
  guardian_name: string | null
  guardian_email: string | null
  guardian_phone: string | null
  accommodations: { extra_time_minutes?: number; disable_voice_flag?: boolean }
  created_by: string
  created_at: string
  age: number
  minor: boolean
  sessions: { session_id: string; test_id: string; status: SessionStatus; submit_reason: SubmitReason | null; launched_at: string }[]
}
export type CandidateInput = Pick<Candidate, 'full_name' | 'email' | 'phone' | 'dob' | 'grade_applying' | 'guardian_name' | 'guardian_email' | 'guardian_phone' | 'accommodations'>
export interface CsvPreview { rows: { line: number; name: string | null; dob: string | null; grade_applying: string | null; minor: boolean | null; error: string | null }[]; valid: number; invalid: number; created: number }

export type SessionStatus = 'LAUNCHED' | 'CONFIRMED' | 'CHECKED' | 'IN_PROGRESS' | 'SUBMITTED' | 'ENDED' | 'LOCKED'
export type SubmitReason = 'MANUAL' | 'TIME_UP' | 'AUTO_VIOLATION' | 'ENDED_BY_TEACHER'
export interface GuardianConsent { guardian_name: string; relationship: string; method: 'in_person' | 'signed_form' | 'otp' }
export interface Launch { session_id: string; exam_token: string; expires_at: string; candidate_name: string }

export interface LiveSession {
  session_id: string
  test_id: string
  test_title: string
  candidate_name: string
  status: SessionStatus
  submit_reason: SubmitReason | null
  answered: number
  total: number
  seconds_left: number | null
  chips: { fullscreen?: boolean; visible?: boolean; faces?: number | null; camera_live?: boolean; screen_live?: boolean; online?: boolean; mic_live?: boolean }
  last_heartbeat_at: string | null
  heartbeat_stale: boolean
  integrity_score: number
  integrity_band: 'High' | 'Moderate' | 'Low'
  warnings: number
  max_warnings: number
  dob_locked: boolean
  latest_flags: { code: string; label: string; severity: string; at: string }[]
}
export interface LiveAlert { session_id: string; candidate_name: string; code: string; label: string; severity: string; at: string }

export interface ResultRow {
  session_id: string
  test_id: string
  test_title: string
  candidate_name: string
  grade_applying: string
  status: SessionStatus
  submit_reason: SubmitReason
  submit_label: string
  started_at: string | null
  submitted_at: string
  integrity_score: number
  integrity_band: 'High' | 'Moderate' | 'Low'
  warnings_count: number
  report_status: 'PENDING' | 'RUNNING' | 'READY' | 'FAILED' | null
  composite: number | null
  band: string | null
  academic_pct: number | null
  hq_composite: number | null
  hq_band: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReportJson = any
export interface ReportResponse { status: 'PENDING' | 'RUNNING' | 'READY' | 'FAILED'; error: string | null; generated_at: string | null; version: number
  report: ReportJson | null; photo_url: string | null; evidence_urls: Record<string, string>; url_minutes: number
  evidence?: { event_id: number; code: string; label: string; t_offset_s: number; kind: string }[] }

const params = (p: Record<string, unknown>) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== '' && v !== null))

export const admissionTestService = {
  meta: () => api.get<TestMeta>(`${BASE}/test-meta`).then((r) => r.data),
  tests: (org?: string) => api.get<{ tests: AdmTest[] }>(`${BASE}/tests`, { params: params({ org_code: org }) }).then((r) => r.data.tests),
  test: (id: string, org?: string) => api.get<AdmTest>(`${BASE}/tests/${id}`, { params: params({ org_code: org }) }).then((r) => r.data),
  createTest: (body: TestInput) => api.post<AdmTest>(`${BASE}/tests`, body).then((r) => r.data),
  updateTest: (id: string, body: TestInput) => api.put<AdmTest>(`${BASE}/tests/${id}`, body).then((r) => r.data),
  publish: (id: string) => api.post<AdmTest>(`${BASE}/tests/${id}/publish`).then((r) => r.data),
  unpublish: (id: string) => api.post<AdmTest>(`${BASE}/tests/${id}/unpublish`).then((r) => r.data),
  archive: (id: string) => api.post<AdmTest>(`${BASE}/tests/${id}/archive`).then((r) => r.data),

  bank: (f: BankFilters) => api.get<{ questions: BankQuestion[]; total: number; page: number; page_size: number; sources: BankSource[] }>(
    `${BASE}/question-bank`, { params: params({ ...f }) }).then((r) => r.data),
  importQuestions: (id: string, master_q_ids: string[], section: string) =>
    api.post<{ imported: AdmQuestion[]; skipped: number; needs_review: number }>(`${BASE}/tests/${id}/questions/import`, { master_q_ids, section }).then((r) => r.data),
  hqBank: (age_band: AgeBand) => api.get<{ items: HqItem[]; age_band: AgeBand; age_bands: AgeBand[] }>(`${BASE}/hq-bank`, { params: { age_band } }).then((r) => r.data),
  addFromBank: (id: string, body: { item_ids?: string[]; age_band?: AgeBand }) =>
    api.post<{ added: AdmQuestion[]; skipped: number }>(`${BASE}/tests/${id}/questions/from-hq-bank`, body).then((r) => r.data),
  draft: (id: string, body: { kind: 'HQ' | 'ACADEMIC'; section: string; topic?: string; count: number; age_band?: AgeBand }) =>
    api.post<{ drafted: AdmQuestion[]; rejected: number; engine: string }>(`${BASE}/tests/${id}/questions/draft`, body).then((r) => r.data),
  addQuestion: (id: string, q: QuestionInput) => api.post<AdmQuestion>(`${BASE}/tests/${id}/questions`, q).then((r) => r.data),
  updateQuestion: (qid: string, q: QuestionInput) => api.put<AdmQuestion>(`${BASE}/questions/${qid}`, q).then((r) => r.data),
  deleteQuestion: (qid: string) => api.delete(`${BASE}/questions/${qid}`),
  reorder: (id: string, question_ids: string[]) => api.put<{ questions: AdmQuestion[] }>(`${BASE}/tests/${id}/questions/order`, { question_ids }).then((r) => r.data),

  candidates: (org?: string) => api.get<{ candidates: Candidate[] }>(`${BASE}/candidates`, { params: params({ org_code: org }) }).then((r) => r.data.candidates),
  createCandidate: (c: CandidateInput) => api.post<Candidate>(`${BASE}/candidates`, c).then((r) => r.data),
  updateCandidate: (id: string, c: CandidateInput) => api.put<Candidate>(`${BASE}/candidates/${id}`, c).then((r) => r.data),
  deleteCandidate: (id: string) => api.delete<{ deleted: boolean; sessions: number; files: number }>(`${BASE}/candidates/${id}`).then((r) => r.data),
  importCandidates: (file: File, commit: boolean) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<CsvPreview>(`${BASE}/candidates/import`, fd, { params: { commit } }).then((r) => r.data)
  },

  live: (testId?: string, since?: string) => api.get<{ sessions: LiveSession[]; alerts: LiveAlert[]; server_time: string }>(`${BASE}/live`,
    { params: params({ test_id: testId, since }) }).then((r) => r.data),
  endSession: (sessionId: string) => api.post(`${BASE}/sessions/${sessionId}/end`).then((r) => r.data),
  results: (testId?: string, org?: string) => api.get<{ results: ResultRow[] }>(`${BASE}/results`, { params: params({ test_id: testId, org_code: org }) }).then((r) => r.data.results),
  resultsCsv: (testId?: string, org?: string) => api.get<Blob>(`${BASE}/results.csv`, { params: params({ test_id: testId, org_code: org }), responseType: 'blob' }).then((r) => r.data),
  report: (sessionId: string, org?: string) => api.get<ReportResponse>(`${BASE}/reports/${sessionId}`, { params: params({ org_code: org }) }).then((r) => r.data),
  regenerate: (sessionId: string) => api.post<{ status: string }>(`${BASE}/reports/${sessionId}/regenerate`).then((r) => r.data),

  launch: (body: { test_id: string; candidate_id: string; device_id: string; guardian_consent?: GuardianConsent | null }) =>
    api.post<Launch>(`${BASE}/launches`, body).then((r) => r.data),
}

export const QTYPE_LABEL: Record<AdmQType, string> = {
  MCQ: 'Multiple choice', MULTI: 'Multiple answers', NUMERICAL: 'Numerical', SHORT: 'Short answer', DESCRIPTIVE: 'Descriptive',
  SJT: 'Situational judgement', REFLECTIVE: 'Reflective', IDEAS: 'Ideas',
}
