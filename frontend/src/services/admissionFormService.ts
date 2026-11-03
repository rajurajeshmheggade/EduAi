import { api } from './apiClient'
import type { ApplicationStatus, Answers, CredentialStatus, FormDefinition } from '@/lib/admissionForm'

export type FormStatus = 'draft' | 'published' | 'closed' | 'archived'
export interface LinkedTest { test_id: string; title: string; status: string; duration_minutes: number; grade_applying: string; created_by: string }
export interface FormCounts {
  applications: number; drafts: number; test_pending: number; to_review: number; corrections: number; approved: number; rejected: number
  live_credentials: number; open_recovery: number
}
export interface AdmissionForm {
  form_id: string; title: string; description: string | null; academic_year: string | null; grades: number[]; grade_labels: string[]
  status: FormStatus; slug: string | null; application_path: string | null; published_version: number | null; has_unpublished_changes: boolean
  opens_at: string | null; closes_at: string | null; credential_valid_days: number; linked_test_id: string | null; linked_test: LinkedTest | null
  created_by: string; owner_name: string | null; created_at: string; updated_at: string; published_at: string | null; counts: FormCounts
  definition?: FormDefinition; versions?: { version: number; published_by: string; published_at: string }[]
}
export interface FormMeta {
  template: FormDefinition; grades: { value: number; label: string }[]; linkable_tests: LinkedTest[]; ack_message: string
  limits: { sections: number; fields_per_section: number; documents: number; max_mb: number; max_files: number; credential_valid_days: [number, number] }
}
/** The credentials pop-up. `password` exists only in this response: it is never stored or shown again. */
export interface IssuedCredential {
  credential_id: string; application_id: string; username: string; password: string; expires_at: string; purpose: 'new' | 'reissue' | 'correction'
  application_name: string; application_path: string | null; school_name: string
}
export interface CredentialRow {
  credential_id: string; application_id: string; username: string; status: CredentialStatus; purpose: 'new' | 'reissue' | 'correction'
  issued_by: string; issued_by_name: string | null; issued_at: string; expires_at: string; acknowledged_at: string | null
  acknowledged_by: string | null; acknowledged_by_name: string | null; acknowledged_items: string[]; first_login_at: string | null
  last_login_at: string | null; revoked_at: string | null; revoke_reason: string | null; locked_until: string | null
  application: { status: ApplicationStatus; label: string | null; student_name: string | null; reference_no: string | null }
}
export interface RecoveryRequest {
  request_id: string; form_id: string; form_title: string; username: string; contact: string; message: string | null
  status: 'open' | 'resolved' | 'dismissed'; created_at: string; resolved_at: string | null; resolved_by: string | null
  credential_id: string | null; credential_status: CredentialStatus | null; application_id: string | null
  application_status: ApplicationStatus | null; label: string | null; student_name: string | null; can_reissue: boolean
}
export interface ApplicationRow {
  application_id: string; form_id: string; form_title: string; reference_no: string | null; status: ApplicationStatus; status_label: string
  student_name: string | null; date_of_birth: string | null; grade_applying: number | null; grade_label: string; label: string | null
  submitted_at: string | null; updated_at: string; created_at: string; submission_count: number; documents: number
  exam: { status: string; integrity_band: string; band: string | null } | null
}
export interface ApplicationDocument {
  document_id: string; requirement_key: string; requirement_label: string; filename: string; mime: string; size_bytes: number
  sha256: string; uploaded_at: string
}
export interface ApplicationDetail extends Omit<ApplicationRow, 'documents' | 'exam'> {
  answers: Answers; version: number | null; definition: FormDefinition & { title?: string }; documents: ApplicationDocument[]
  history: { from_status: string | null; to_status: ApplicationStatus; actor_code: string; actor_name: string; actor_role: string; note: string | null
    visible_to_applicant: boolean; created_at: string }[]
  comments: { comment_id: string; author_code: string; author_name: string; author_role: string; body: string; created_at: string }[]
  credentials: CredentialRow[]; decided_at: string | null
  exam: { session_id: string; status: string; submit_reason: string | null; integrity_score: number; integrity_band: string; warnings_count: number
    test_title: string; report_status: string | null; composite: number | null; band: string | null; academic_pct: number | null
    report_path: string | null } | null
  actions: Decision[]
}
export type Decision = 'start_review' | 'approve' | 'reject' | 'request_correction'
export interface Branding { org_name: string; display_name: string | null; accent: string | null; logo_url: string | null }
export interface FormBody {
  title: string; description: string | null; academic_year: string | null; grades: number[]; opens_at: string | null; closes_at: string | null
  credential_valid_days: number; linked_test_id: string | null; definition: FormDefinition
}

const B = '/ICMELive/api/v1/admission'
const q = (org?: string | null, extra: Record<string, unknown> = {}) =>
  ({ params: Object.fromEntries(Object.entries({ ...extra, org_code: org }).filter(([, v]) => v !== undefined && v !== null && v !== '')) })

export const admissionFormService = {
  meta: async (org?: string | null) => (await api.get<FormMeta>(`${B}/form-meta`, q(org))).data,
  list: async (org?: string | null, signal?: AbortSignal) => (await api.get<{ forms: AdmissionForm[] }>(`${B}/forms`, { ...q(org), signal })).data.forms,
  create: async (body: { title: string; academic_year?: string | null; grades: number[] }, org?: string | null) =>
    (await api.post<AdmissionForm>(`${B}/forms`, body, q(org))).data,
  get: async (id: string, org?: string | null) => (await api.get<AdmissionForm>(`${B}/forms/${id}`, q(org))).data,
  update: async (id: string, body: FormBody, org?: string | null) => (await api.put<AdmissionForm>(`${B}/forms/${id}`, body, q(org))).data,
  remove: async (id: string, org?: string | null) => (await api.delete(`${B}/forms/${id}`, q(org))).data,
  publish: async (id: string, org?: string | null) =>
    (await api.post<{ form: AdmissionForm; credential: IssuedCredential | null }>(`${B}/forms/${id}/publish`, null, q(org))).data,
  close: async (id: string, org?: string | null) => (await api.post<AdmissionForm>(`${B}/forms/${id}/close`, null, q(org))).data,
  reopen: async (id: string, org?: string | null) => (await api.post<AdmissionForm>(`${B}/forms/${id}/reopen`, null, q(org))).data,

  credentials: async (formId: string, org?: string | null) =>
    (await api.get<{ credentials: CredentialRow[] }>(`${B}/forms/${formId}/credentials`, q(org))).data.credentials,
  newCredential: async (formId: string, label: string | null, org?: string | null) =>
    (await api.post<IssuedCredential>(`${B}/forms/${formId}/credentials`, { label }, q(org))).data,
  acknowledge: async (credentialId: string, copied: ('username' | 'password' | 'all')[], org?: string | null) =>
    (await api.post<{ acknowledged_at: string; message: string }>(`${B}/credentials/${credentialId}/acknowledge`, { copied }, q(org))).data,
  revoke: async (credentialId: string, org?: string | null) => (await api.post(`${B}/credentials/${credentialId}/revoke`, null, q(org))).data,
  reissue: async (credentialId: string, recoveryRequestId: string | null, org?: string | null) =>
    (await api.post<IssuedCredential>(`${B}/credentials/${credentialId}/reissue`, { recovery_request_id: recoveryRequestId }, q(org))).data,
  recovery: async (formId: string | null, status: 'open' | 'resolved' | 'dismissed' | null, org?: string | null) =>
    (await api.get<{ requests: RecoveryRequest[] }>(`${B}/recovery-requests`, q(org, { form_id: formId, status: status ?? undefined }))).data.requests,
  dismissRecovery: async (id: string, org?: string | null) => (await api.post(`${B}/recovery-requests/${id}/dismiss`, null, q(org))).data,

  applications: async (p: { form_id?: string | null; status?: string | null; include_drafts?: boolean }, org?: string | null, signal?: AbortSignal) =>
    (await api.get<{ applications: ApplicationRow[] }>(`${B}/applications`, { ...q(org, p), signal })).data.applications,
  application: async (id: string, org?: string | null) => (await api.get<ApplicationDetail>(`${B}/applications/${id}`, q(org))).data,
  decide: async (id: string, action: Decision, note: string | null, org?: string | null) =>
    (await api.post<{ application: ApplicationDetail; credential: IssuedCredential | null }>(`${B}/applications/${id}/decision`, { action, note }, q(org))).data,
  comment: async (id: string, body: string, org?: string | null) => (await api.post(`${B}/applications/${id}/comments`, { body }, q(org))).data,
  documentLink: async (id: string, documentId: string, org?: string | null) =>
    (await api.post<{ url: string; expires_in: number }>(`${B}/applications/${id}/documents/${documentId}/link`, null, q(org))).data,
  zipLink: async (id: string, org?: string | null) =>
    (await api.post<{ url: string; expires_in: number }>(`${B}/applications/${id}/documents/zip-link`, null, q(org))).data,

  branding: async (org?: string | null) => (await api.get<Branding>(`${B}/branding`, q(org))).data,
  saveBranding: async (body: { display_name: string | null; accent: string | null }, org?: string | null) =>
    (await api.put<Branding>(`${B}/branding`, body, q(org))).data,
  uploadLogo: async (file: File, org?: string | null) => {
    const fd = new FormData()
    fd.append('file', file)
    return (await api.post<Branding>(`${B}/branding/logo`, fd, q(org))).data
  },
  deleteLogo: async (org?: string | null) => (await api.delete<Branding>(`${B}/branding/logo`, q(org))).data,
}

/** Absolute URL of the standalone application (the API returns the path only). */
export const applicationUrl = (path: string | null | undefined) => (path ? new URL(path, window.location.origin).toString() : '')
