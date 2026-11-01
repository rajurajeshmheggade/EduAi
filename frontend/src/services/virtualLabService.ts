import { api } from './apiClient'
import type { DikshaItem } from './dikshaService'

/** DIKSHA Virtual Labs (Classes 6–12): teacher assigns an experiment, student performs it and keeps a lab record. */
const BASE = '/ICMELive/api/v1/virtual-labs'

export type LabRole = 'simulation' | 'manual' | 'theory' | 'procedure' | 'video' | 'self_check' | 'reading' | 'other'

export interface LabCollection {
  collection_id: string
  class_number: number
  medium: 'English' | 'Hindi'
  subject: string
  /** As written on DIKSHA's page (Hindi medium in Devanagari). */
  label: string
}

export interface LabTarget { class_code: string; class_name: string; grade_number: number | null; subject_code: string; subject_name: string; student_count: number }

export interface LabCatalog {
  enabled: boolean
  source: { name: string; url: string }
  classes: number[]
  mediums: string[]
  collections: LabCollection[]
  embed_noncommercial: boolean
  targets: LabTarget[]
}

export interface CollectionInfo extends Pick<DikshaItem, 'source_id' | 'name' | 'description' | 'cover_url' | 'classes' | 'subjects' | 'mediums'
  | 'license' | 'author' | 'creator' | 'attributions' | 'copyright' | 'copyright_year' | 'organisation' | 'official_url'> {
  class_number?: number
  medium?: string
  subject?: string
  label?: string
}

export interface LabSummary {
  lab_id: string
  name: string
  position: number
  summary: string | null
  keywords: string[]
  roles: Partial<Record<LabRole, number>>
  has_simulation: boolean
  authors: string[]
  licenses: string[]
}

export interface LabResource extends DikshaItem { role: LabRole; role_label: string }
export interface Lab extends LabSummary { resources: LabResource[]; collection?: CollectionInfo }

export interface WorksheetQuestion {
  id: string
  type: 'mcq' | 'short'
  prompt: string
  options: string[]
  /** Correct option (teacher; student only after submitting). */
  answer?: number | null
  model_answer?: string | null
  explanation?: string | null
  marks: number
}

export interface Worksheet {
  aim: string
  materials: string[]
  steps: string[]
  observation_columns: string[]
  observation_rows: number
  questions: WorksheetQuestion[]
  conclusion_prompt: string | null
  record_marks: number
}

export type WindowState = 'open' | 'late' | 'scheduled' | 'closed' | 'overdue'

export interface LabAssignment {
  assignment_id: string
  class_code: string
  class_name: string
  subject_code: string
  subject_name: string
  teacher_code: string
  teacher_name: string | null
  collection_id: string
  lab_id: string
  title: string
  instructions: string | null
  max_marks: number
  min_minutes: number
  available_from: string | null
  due_at: string | null
  allow_late: boolean
  status: 'active' | 'closed'
  created_at: string
  window: { state: WindowState; can_work: boolean }
  lab_name: string
  lab_class: number | null
  has_simulation: boolean
  lab_roles: Partial<Record<LabRole, number>>
}

export interface TeacherLabAssignment extends LabAssignment { students: number; started: number; submitted: number; reviewed: number; average_pct: number | null; proctor_flags: number }

export type AttemptStatus = 'not_started' | 'in_progress' | 'submitted' | 'reviewed'

export interface LabFeedback {
  engine: string | null
  mcq: { id: string; correct: boolean; marks: number; max: number }[]
  questions: { id: string; marks: number; max: number; feedback: string | null }[]
  record: { marks: number; max: number; feedback: string | null } | null
  overall: string | null
  checks: { rows_filled: number; rows_expected: number; steps_done: number; steps_total: number; answered: number; questions: number; conclusion_words: number }
}

export interface LabResult {
  auto_score: number | null
  auto_max: number | null
  feedback: LabFeedback | null
  suggested_marks: number | null
  marks: number | null
  reviewed_at: string | null
}

export type Answer = number | string
export interface LabWork { steps_done: number[]; observations: string[][]; answers: Record<string, Answer>; conclusion: string | null }

export interface LabAttempt extends LabWork {
  status: Exclude<AttemptStatus, 'not_started'>
  started_at: string
  active_seconds: number
  launches: number
  submitted_at: string | null
  is_late: boolean
  returned_count: number
  updated_at: string
  teacher_feedback: string | null
  result: LabResult | null
  /** Running count from the light on-device camera/mic check (see LiveCameraCheck) — no detail, just a count. */
  proctor_flag_count: number
}

export interface StudentLabView { assignment: LabAssignment; lab: Lab; worksheet: Worksheet; attempt: LabAttempt | null }

export interface MyLab extends LabAssignment {
  my: { status: AttemptStatus; active_seconds: number; submitted_at: string | null; is_late: boolean; marks: number | null
    auto_score: number | null; auto_max: number | null; returned: boolean }
}

export interface RosterRow {
  student_code: string
  full_name: string
  roll_number: string | null
  status: AttemptStatus
  started_at: string | null
  active_seconds: number | null
  launches: number | null
  submitted_at: string | null
  is_late: boolean | null
  auto_score: number | null
  auto_max: number | null
  suggested_marks: number | null
  marks: number | null
  returned_count: number | null
  proctor_flag_count: number | null
}

export interface AssignmentDetail extends LabAssignment {
  lab: Lab
  worksheet: Worksheet
  roster: RosterRow[]
  stats: { students: number; started: number; submitted: number; reviewed: number; late: number; average_minutes: number | null; average_pct: number | null }
}

export interface AttemptDetail {
  student: { student_code: string; full_name: string; roll_number: string | null }
  attempt: LabAttempt & { result: LabResult }
  worksheet: Worksheet
  max_marks: number
  min_minutes: number
  title: string
}

export interface AssignInput {
  collection_id: string
  lab_id: string
  medium?: string
  class_code: string
  subject_code: string
  title?: string
  instructions?: string
  worksheet: Worksheet
  min_minutes: number
  available_from?: string | null
  due_at?: string | null
  allow_late: boolean
}

export interface ChatMessage { role: 'user' | 'assistant'; content: string }

const num = (v: unknown) => (v == null ? null : Number(v))

export const virtualLabService = {
  catalog: () => api.get<LabCatalog>(`${BASE}/catalog`).then((r) => r.data),
  collection: (id: string, medium?: string) =>
    api.get<{ collection: CollectionInfo; labs: LabSummary[]; intro: DikshaItem[] }>(`${BASE}/collections/${id}`, { params: { medium } }).then((r) => r.data),
  lab: (collectionId: string, labId: string, medium?: string) =>
    api.get<{ collection: CollectionInfo; lab: Lab; assigned: { assignment_id: string; class_code: string; class_name: string; subject_code: string; title: string; due_at: string | null; status: string }[] }>(
      `${BASE}/collections/${collectionId}/labs/${labId}`, { params: { medium } }).then((r) => r.data),
  draftWorksheet: (collectionId: string, labId: string, medium?: string) =>
    api.post<{ worksheet: Worksheet; engine: string; max_marks: number }>(`${BASE}/collections/${collectionId}/labs/${labId}/worksheet`, null, { params: { medium } }).then((r) => r.data),

  assign: (body: AssignInput) =>
    api.post<{ assignment_id: string; title: string; class_name: string; student_count: number; max_marks: number }>(`${BASE}/assignments`, body).then((r) => r.data),
  assignments: () => api.get<{ assignments: TeacherLabAssignment[] }>(`${BASE}/assignments`).then((r) =>
    r.data.assignments.map((a) => ({ ...a, max_marks: Number(a.max_marks), average_pct: num(a.average_pct) }))),
  assignment: (id: string) => api.get<AssignmentDetail>(`${BASE}/assignments/${id}`).then((r) => ({
    ...r.data, max_marks: Number(r.data.max_marks),
    roster: r.data.roster.map((x) => ({ ...x, auto_score: num(x.auto_score), auto_max: num(x.auto_max), suggested_marks: num(x.suggested_marks), marks: num(x.marks) })),
  })),
  update: (id: string, patch: { title?: string; instructions?: string; due_at?: string; clear_due?: boolean; allow_late?: boolean; min_minutes?: number; status?: 'active' | 'closed' }) =>
    api.patch<LabAssignment>(`${BASE}/assignments/${id}`, patch).then((r) => r.data),
  remove: (id: string) => api.delete(`${BASE}/assignments/${id}`),
  attempt: (id: string, student: string) => api.get<AttemptDetail>(`${BASE}/assignments/${id}/attempts/${encodeURIComponent(student)}`).then((r) => ({
    ...r.data, max_marks: Number(r.data.max_marks),
    attempt: { ...r.data.attempt, result: normResult(r.data.attempt.result)! },
  })),
  review: (id: string, student: string, body: { marks?: number; feedback?: string; return_for_redo?: boolean }) =>
    api.post<{ status: string }>(`${BASE}/assignments/${id}/attempts/${encodeURIComponent(student)}/review`, body).then((r) => r.data),

  myLabs: () => api.get<{ labs: MyLab[]; counts: { to_do: number; submitted: number; reviewed: number } }>(`${BASE}/my`).then((r) => ({
    ...r.data, labs: r.data.labs.map((l) => ({ ...l, max_marks: Number(l.max_marks), my: { ...l.my, marks: num(l.my.marks), auto_score: num(l.my.auto_score), auto_max: num(l.my.auto_max) } })),
  })),
  myLab: (id: string) => api.get<StudentLabView>(`${BASE}/my/${id}`).then((r) => normView(r.data)),
  start: (id: string) => api.post<StudentLabView>(`${BASE}/my/${id}/start`).then((r) => normView(r.data)),
  activity: (id: string, seconds: number, launched = false) =>
    api.post<{ active_seconds: number; launches: number; min_seconds: number }>(`${BASE}/my/${id}/activity`, { seconds, launched }).then((r) => r.data),
  saveWork: (id: string, work: LabWork) => api.put<{ saved_at: string }>(`${BASE}/my/${id}/work`, work).then((r) => r.data),
  proctorFlag: (id: string) => api.post<{ flag_count: number }>(`${BASE}/my/${id}/proctor-flag`).then((r) => r.data),
  submit: (id: string, work: LabWork) => api.post<StudentLabView>(`${BASE}/my/${id}/submit`, work).then((r) => normView(r.data)),
  ask: (id: string, question: string, history: ChatMessage[]) =>
    api.post<{ answer: string; engine: string }>(`${BASE}/my/${id}/ask`, { question, history }).then((r) => r.data),
}

function normResult(r: LabResult | null): LabResult | null {
  return r && { ...r, auto_score: num(r.auto_score), auto_max: num(r.auto_max), suggested_marks: num(r.suggested_marks), marks: num(r.marks) }
}

function normView(v: StudentLabView): StudentLabView {
  return { ...v, assignment: { ...v.assignment, max_marks: Number(v.assignment.max_marks) },
    attempt: v.attempt && { ...v.attempt, result: normResult(v.attempt.result) } }
}
