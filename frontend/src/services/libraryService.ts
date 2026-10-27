import { api } from './apiClient'
import type { PublishedExternal } from './dikshaService'

export type Board = 'NCERT_CBSE' | 'KARNATAKA_STATE'
export type Language = 'English' | 'Kannada' | 'Hindi'
export type AccessMode = 'official_link' | 'in_app_reader'
export type LicenseStatus = 'verified' | 'permission_required' | 'unknown'
export type VerificationStatus = 'verified' | 'pending' | 'rejected'
/** What the server actually permits for a reader right now. */
export type EffectiveAccess = 'in_app_file' | 'in_app_embed' | 'official_link' | 'unavailable'

export interface Chapter { title: string; page: number | null }

export interface Book {
  book_id: string
  board: Board
  board_label: string
  class_number: number
  subject_name: string
  language: Language
  title: string
  academic_year: string | null
  publisher: string | null
  source_name: string
  source_url: string
  access_mode: AccessMode
  license_status: LicenseStatus
  license_notice: string | null
  in_app_reader_allowed: boolean
  download_allowed: boolean
  verification_status: VerificationStatus
  link_status: 'unchecked' | 'ok' | 'broken'
  last_verified_at: string | null
  chapters: Chapter[]
  is_active: boolean
  scope: 'platform' | 'institution'
  has_file: boolean
  access: EffectiveAccess
  created_at: string
  updated_at: string
  file_bytes?: number | null
  /** Teacher catalog: active publications in classes this teacher teaches. */
  published_to?: { publication_id: string; class_code: string; class_name: string; subject_code: string }[]
  /** Admin catalog. */
  active_publications?: number
}

export interface StudentBook extends Book {
  subjects: { subject_code: string; subject_name: string; teacher_name: string | null }[]
  published_at: string
}

export interface BookAccess {
  book_id: string; title: string; subject_name: string; class_number: number; board_label: string; language: Language
  publisher: string | null; academic_year: string | null
  mode: EffectiveAccess; source_name: string; source_url: string; license_status: LicenseStatus; license_notice: string | null
  download_allowed: boolean; link_status: 'unchecked' | 'ok' | 'broken'; chapters: Chapter[]; file_url?: string
}

export interface PublishTarget {
  class_code: string; class_name: string; grade_number: number | null; year_code: string
  subject_code: string; subject_name: string; is_class_teacher: boolean; student_count: number
}

export interface Publication {
  publication_id: string; book_id: string; class_code: string; class_name: string; subject_code: string; class_subject_name: string | null
  year_code: string; status: 'published' | 'unpublished'; published_at: string; unpublished_at: string | null
  teacher_code: string; teacher_name: string | null; unpublished_by: string | null
  title: string; board: string; class_number: number | null; language: string | null; subject_name: string | null; source_name: string
  /** 'school' = school catalog book; 'diksha' = reference to DIKSHA content */
  source: 'school' | 'diksha'; source_id: string | null; source_kind: 'textbook' | 'resource' | null
  source_status: 'available' | 'unavailable' | null; source_context: { textbook_id: string; textbook_name: string; path: string[] } | null
  can_unpublish?: boolean
  events?: { action: 'published' | 'republished' | 'unpublished'; actor_code: string; actor_name: string | null; actor_role: string; created_at: string }[]
}

export interface LibraryMeta {
  boards: { code: Board; label: string }[]
  classes: number[]
  languages: Language[]
  access_modes: Record<AccessMode, string>
  license_statuses: Record<LicenseStatus, string>
  verification_statuses: Record<VerificationStatus, string>
}

export interface BookFilters { board?: string; class_number?: number | ''; subject?: string; language?: string; q?: string }
export type BookBody = Omit<Book, 'book_id' | 'board_label' | 'scope' | 'has_file' | 'access' | 'created_at' | 'updated_at' | 'link_status'
  | 'last_verified_at' | 'published_to' | 'active_publications' | 'file_bytes'> & { scope?: 'platform' | 'institution' }

const B = '/ICMELive/api/v1/library'
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null))
const withOrg = (org?: string | null, extra: Record<string, unknown> = {}) => ({ params: clean({ ...extra, org_code: org }) })

export const libraryService = {
  meta: async () => (await api.get<LibraryMeta>(`${B}/meta`)).data,
  subjects: async (board?: string, class_number?: number | '', org?: string | null) =>
    (await api.get<{ subjects: string[] }>(`${B}/subjects`, withOrg(org, { board, class_number }))).data.subjects,
  books: async (f: BookFilters & { page?: number; page_size?: number; verification_status?: string; scope?: string }, org?: string | null) =>
    (await api.get<{ books: Book[]; total: number; page: number; page_size: number }>(`${B}/books`, withOrg(org, { ...f }))).data,
  access: async (id: string, org?: string | null) => (await api.get<BookAccess>(`${B}/books/${id}/access`, withOrg(org))).data,

  // teacher
  targets: async () => (await api.get<{ targets: PublishTarget[] }>(`${B}/targets`)).data.targets,
  publish: async (body: { book_ids: string[]; class_code: string; subject_code: string }) =>
    (await api.post<{ published: string[]; already_published: string[]; year_code: string; student_count: number }>(`${B}/publications`, body)).data,
  myPublications: async (status?: string) => (await api.get<{ publications: Publication[] }>(`${B}/publications/mine`, { params: clean({ status }) })).data.publications,
  unpublish: async (id: string) => (await api.post(`${B}/publications/${id}/unpublish`)).data,

  // student
  studentBooks: async (f: { subject?: string; language?: string; q?: string }) =>
    (await api.get<{ class_code: string | null; class_name: string | null; year_code: string | null; books: StudentBook[]
      /** DIKSHA textbooks / resources published to the class (references to source content) */
      external: PublishedExternal[]
      subjects: { subject_code: string; subject_name: string }[]; languages: string[] }>(`${B}/student/books`, { params: clean(f) })).data,

  // admin
  createBook: async (body: BookBody, org?: string | null) => (await api.post<Book>(`${B}/books`, body, withOrg(org))).data,
  updateBook: async (id: string, patch: Partial<BookBody>, org?: string | null) => (await api.patch<Book>(`${B}/books/${id}`, patch, withOrg(org))).data,
  uploadFile: async (id: string, file: File, org?: string | null) => {
    const fd = new FormData(); fd.append('file', file)
    return (await api.post<Book>(`${B}/books/${id}/file`, fd, withOrg(org))).data
  },
  deleteBook: async (id: string, org?: string | null) => (await api.delete(`${B}/books/${id}`, withOrg(org))).data,
  removeFile: async (id: string, org?: string | null) => (await api.delete<Book>(`${B}/books/${id}/file`, withOrg(org))).data,
  checkLink: async (id: string, org?: string | null) => (await api.post<Book>(`${B}/books/${id}/check-link`, null, withOrg(org))).data,
  importCsv: async (csv_text: string, scope: 'platform' | 'institution', org?: string | null) =>
    (await api.post<{ created: number; skipped_existing: number; errors: string[] }>(`${B}/books/import`, { csv_text, scope }, withOrg(org))).data,
  publications: async (org?: string | null, status?: string) =>
    (await api.get<{ publications: Publication[] }>(`${B}/publications`, withOrg(org, { status }))).data.publications,
}
