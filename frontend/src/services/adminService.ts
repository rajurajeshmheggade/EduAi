import { api } from './apiClient'
import type { AdminOverview, AIModule, CreatedMember, Member, Organization, SchoolClass, SubjectType, Tally, TimetableSlot } from '@/types'

const B = '/ICMELive/api/v1/admin'

/** `org` is only sent by the platform super-admin to act on a specific institution. */
const q = (org?: string | null) => (org ? { params: { org_code: org } } : {})

export interface OrgCreateBody {
  org_code: string
  org_name: string
  institution_level: 'school' | 'college' | 'coaching'
  city?: string
  contact_email?: string
  contact_phone?: string
  board_or_affiliation?: string
  address?: string
  max_students?: number
  ai_modules?: AIModule[]
  admin: AdminBody
}

export interface AdminBody { full_name: string; email: string; user_code: string; password?: string }

export interface SlotBody {
  class_code: string
  subject_code: string
  teacher_code?: string | null
  day_of_week: number
  period_number: number
  start_time: string
  end_time: string
  room_number?: string | null
}

export const adminService = {
  async organizations(): Promise<Organization[]> {
    return (await api.get<{ organizations: Organization[] }>(`${B}/organizations`)).data.organizations
  },
  async createOrganization(body: OrgCreateBody) {
    return (await api.post<{ org_code: string; org_name: string; admin: CreatedMember }>(`${B}/organizations`, body)).data
  },
  async orgAdmins(org: string): Promise<Member[]> {
    return (await api.get<{ admins: Member[] }>(`${B}/organizations/${encodeURIComponent(org)}/admins`)).data.admins
  },
  async createOrgAdmin(org: string, body: AdminBody) {
    return (await api.post<CreatedMember>(`${B}/organizations/${encodeURIComponent(org)}/admins`, body)).data
  },
  async overview(org?: string | null): Promise<AdminOverview> {
    return (await api.get<AdminOverview>(`${B}/overview`, q(org))).data
  },
  async settings(org?: string | null): Promise<Organization> {
    return (await api.get<Organization>(`${B}/settings`, q(org))).data
  },
  async updateSettings(patch: Partial<Organization>, org?: string | null): Promise<Organization> {
    return (await api.put<Organization>(`${B}/settings`, patch, q(org))).data
  },

  async teachers(org?: string | null): Promise<Member[]> {
    return (await api.get<{ teachers: Member[] }>(`${B}/teachers`, q(org))).data.teachers
  },
  async createTeacher(body: { user_code: string; full_name: string; email: string; phone?: string; qualification?: string; password?: string }, org?: string | null) {
    return (await api.post<CreatedMember>(`${B}/teachers`, body, q(org))).data
  },
  async updateTeacher(code: string, patch: { is_active?: boolean; reset_password?: boolean; full_name?: string; phone?: string }, org?: string | null) {
    return (await api.patch<Member & { temporary_password: string | null }>(`${B}/teachers/${encodeURIComponent(code)}`, patch, q(org))).data
  },

  async classes(org?: string | null): Promise<SchoolClass[]> {
    return (await api.get<{ classes: SchoolClass[] }>(`${B}/classes`, q(org))).data.classes
  },
  async createClass(body: { class_code: string; class_name: string; class_teacher_code?: string | null; room_number?: string | null }, org?: string | null) {
    return (await api.post<SchoolClass>(`${B}/classes`, body, q(org))).data
  },
  async updateClass(code: string, body: { class_name: string; class_teacher_code: string | null; is_active: boolean; room_number?: string | null }, org?: string | null) {
    return (await api.put<SchoolClass>(`${B}/classes/${encodeURIComponent(code)}`, body, q(org))).data
  },
  async setClassSubject(code: string, subject: string, body: { subject_name: string; teacher_code: string | null; subject_type?: SubjectType }, org?: string | null) {
    return (await api.put<SchoolClass>(`${B}/classes/${encodeURIComponent(code)}/subjects/${encodeURIComponent(subject)}`, body, q(org))).data
  },
  async removeClassSubject(code: string, subject: string, org?: string | null) {
    return (await api.delete<SchoolClass>(`${B}/classes/${encodeURIComponent(code)}/subjects/${encodeURIComponent(subject)}`, q(org))).data
  },

  async students(classCode?: string | null, org?: string | null): Promise<Member[]> {
    const params: Record<string, string> = {}
    if (classCode) params.class_code = classCode
    if (org) params.org_code = org
    return (await api.get<{ students: Member[] }>(`${B}/students`, { params })).data.students
  },

  async attendanceSummary(month: string, org?: string | null) {
    const params: Record<string, string> = { month }
    if (org) params.org_code = org
    return (await api.get<{ month: string; threshold: number; overall: Tally; rows: ({ class_code: string; subject_code: string; sessions: number; is_below_threshold: boolean } & Tally)[] }>(
      `${B}/attendance/summary`, { params })).data
  },

  async timetable(filter: { class_code?: string; teacher_code?: string }, org?: string | null): Promise<TimetableSlot[]> {
    const params: Record<string, string> = { ...filter }
    if (org) params.org_code = org
    return (await api.get<{ slots: TimetableSlot[] }>(`${B}/timetable`, { params })).data.slots
  },
  async saveSlot(body: SlotBody, org?: string | null): Promise<TimetableSlot> {
    return (await api.put<TimetableSlot>(`${B}/timetable`, body, q(org))).data
  },
  async deleteSlot(slotId: string, org?: string | null) {
    return (await api.delete(`${B}/timetable/${slotId}`, q(org))).data
  },
}
