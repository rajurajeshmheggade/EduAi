import { api } from './apiClient'
import type { LangCode } from '@/i18n/locales'

export type ConsentDecision = 'granted' | 'withdrawn'
export type RequestKind = 'access' | 'correction' | 'erasure' | 'consent_withdrawal' | 'grievance'
export type RequestStatus = 'open' | 'in_progress' | 'completed' | 'rejected'
export type DataClass = 'proctor_snapshots' | 'proctor_events' | 'unsuccessful_applicants' | 'withdrawn_enquiries' | 'audit_log'

export interface AdmissionOverview {
  applicants: { total: number; by_grade: { grade: number; count: number }[] }
  consent: { granted: number; withdrawn: number; pending: number }
  requests: { open: number; overdue: number }
  breaches_open: number
  team: { counsellors: number; reviewers: number }
  consent_version: { version: number; languages: LangCode[] } | null
}
export interface Applicant {
  applicant_id: string; full_name: string; grade_applying: number; status: string; preferred_language: LangCode; created_at: string
  guardians: { full_name: string; relationship: string }[]
  consent: { decision: ConsentDecision; version: number; at: string } | null
}
export interface TeamMember { user_code: string; full_name: string; email: string; phone: string | null; role: 'counsellor' | 'reviewer'; is_active: boolean; created_at: string }
export interface ConsentVersion {
  version: number; is_active: boolean; purposes: string[]; created_by: string | null; created_at: string; granted_count: number
  texts: { version_id: string; language: LangCode; title: string; body: string }[]
}
export interface RetentionPolicy { data_class: DataClass; retain_days: number; default_days: number; minimum_days: number; updated_by: string | null; updated_at: string | null }
export interface DataRequest {
  request_id: string; kind: RequestKind; details: string | null; status: RequestStatus; due_at: string; resolved_at: string | null
  resolution_note: string | null; created_by: string; created_at: string; applicant_id: string | null; applicant_name: string | null; guardian_name: string | null
}
export interface Breach {
  breach_id: string; detected_at: string; nature: string; data_affected: string | null; affected_count: number | null; actions_taken: string | null
  board_notified_at: string | null; principals_notified_at: string | null; status: 'open' | 'reported' | 'closed'; created_by: string
  created_at: string; board_report_due_at: string
}
export interface AuditEntry { log_id: number; actor_code: string; actor_role: string; action: string; entity: string; entity_id: string | null; details: Record<string, unknown>; ip: string | null; created_at: string }

export interface ParentHome {
  school: string
  guardian: { guardian_id: string; full_name: string; relationship: string; preferred_language: LangCode } | null
  children: { applicant_id: string; full_name: string; grade_applying: number; status: string; preferred_language: LangCode
    consent: { decision: ConsentDecision; version: number; at: string; current: boolean } | null }[]
  consent_version: number | null
  consent_languages: LangCode[]
  open_requests: number
}
export interface ConsentText {
  child: { applicant_id: string; full_name: string; grade_applying: number }
  version: number; version_id: string; purposes: string[]; language: LangCode; requested_language: LangCode
  title: string; body: string; draft_translation: boolean
  current: { decision: ConsentDecision; version: number; at: string } | null
}

const B = '/ICMELive/api/v1/admission'
const q = (org?: string | null, extra: Record<string, unknown> = {}) =>
  ({ params: Object.fromEntries(Object.entries({ ...extra, org_code: org }).filter(([, v]) => v !== undefined && v !== null && v !== '')) })

export const admissionService = {
  overview: async (org?: string | null) => (await api.get<AdmissionOverview>(`${B}/overview`, q(org))).data,
  applicants: async (org?: string | null, grade?: number) => (await api.get<{ applicants: Applicant[] }>(`${B}/applicants`, q(org, { grade }))).data.applicants,

  team: async (org?: string | null) => (await api.get<{ members: TeamMember[] }>(`${B}/team`, q(org))).data.members,
  addMember: async (body: { role: 'counsellor' | 'reviewer'; full_name: string; email: string; phone?: string }, org?: string | null) =>
    (await api.post<{ user_code: string; temporary_password: string | null; email: string }>(`${B}/team`, body, q(org))).data,
  updateMember: async (code: string, patch: { is_active?: boolean; reset_password?: boolean }, org?: string | null) =>
    (await api.patch<TeamMember & { temporary_password: string | null }>(`${B}/team/${encodeURIComponent(code)}`, patch, q(org))).data,

  consentTemplates: async (org?: string | null) =>
    (await api.get<{ purposes: string[]; draft_languages: LangCode[]; texts: Record<LangCode, { title: string; body: string }> }>(`${B}/consent-templates`, q(org))).data,
  consentVersions: async (org?: string | null) => (await api.get<{ versions: ConsentVersion[] }>(`${B}/consent-versions`, q(org))).data.versions,
  publishConsent: async (texts: Partial<Record<LangCode, { title: string; body: string }>>, org?: string | null) =>
    (await api.post<{ version: number; languages: LangCode[] }>(`${B}/consent-versions`, { texts }, q(org))).data,

  retention: async (org?: string | null) => (await api.get<{ policies: RetentionPolicy[] }>(`${B}/retention`, q(org))).data.policies,
  setRetention: async (policies: Partial<Record<DataClass, number>>, org?: string | null) =>
    (await api.put<{ policies: RetentionPolicy[] }>(`${B}/retention`, { policies }, q(org))).data.policies,

  requests: async (org?: string | null, status?: string) => (await api.get<{ requests: DataRequest[] }>(`${B}/data-requests`, q(org, { status }))).data.requests,
  updateRequest: async (id: string, body: { status: RequestStatus; resolution_note?: string }, org?: string | null) =>
    (await api.patch(`${B}/data-requests/${id}`, body, q(org))).data,

  breaches: async (org?: string | null) => (await api.get<{ breaches: Breach[] }>(`${B}/breaches`, q(org))).data.breaches,
  logBreach: async (body: { detected_at: string; nature: string; data_affected?: string; affected_count?: number; actions_taken?: string }, org?: string | null) =>
    (await api.post<{ breach_id: string }>(`${B}/breaches`, body, q(org))).data,
  updateBreach: async (id: string, body: Partial<Pick<Breach, 'status' | 'actions_taken' | 'board_notified_at' | 'principals_notified_at'>>, org?: string | null) =>
    (await api.patch(`${B}/breaches/${id}`, body, q(org))).data,

  audit: async (org?: string | null, f: { entity?: string; action?: string } = {}) =>
    (await api.get<{ entries: AuditEntry[] }>(`${B}/audit`, q(org, f))).data.entries,

  // parent portal
  parentHome: async () => (await api.get<ParentHome>(`${B}/parent/home`)).data,
  consentText: async (applicant_id: string, lang: LangCode) => (await api.get<ConsentText>(`${B}/parent/consent`, { params: { applicant_id, lang } })).data,
  giveConsent: async (body: { applicant_id: string; version_id: string; decision: ConsentDecision; confirm?: boolean }) =>
    (await api.post<{ consent_id: string; decision: ConsentDecision; version: number; at: string }>(`${B}/parent/consents`, body)).data,
  parentRequests: async () => (await api.get<{ requests: DataRequest[] }>(`${B}/parent/requests`)).data.requests,
  raiseRequest: async (body: { kind: RequestKind; applicant_id?: string; details?: string }) =>
    (await api.post<{ request_id: string; due_at: string }>(`${B}/parent/requests`, body)).data,
  setParentLanguage: async (language: LangCode) => (await api.put(`${B}/parent/language`, { language })).data,
}
