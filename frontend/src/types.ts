export type Role = 'superadmin' | 'orgadmin' | 'teacher' | 'student'
export type AIModule = 'rag_chatbot' | 'ai_avatar_tutor' | 'ocr_evaluation' | 'capability_analysis'
export type SubjectType = 'THEORY' | 'LAB' | 'COACHING_TEST'

export interface UserProfile {
  user_id: string
  user_code: string
  full_name: string
  email: string
  role: Role
  org_code: string
  org_name: string | null
  institution_level: 'school' | 'college' | 'coaching'
  standalone_mode: boolean
  year_code: string | null
  cycle_code: string | null
  class_code: string | null
  roll_number?: string | null
  qualification?: string | null
  allowed_subjects: string[]
  home_route: string
  /** Bootstrap / temporary password: the user should set their own (FRD v3 FR-SA-01). */
  must_change_password?: boolean
  /** AI modules enabled for the institution by the platform owner. */
  ai_modules?: AIModule[]
}

export interface AuthResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  user: UserProfile
}

export interface Chapter {
  chapter_number: number
  chapter_title: string
  first_page: number
  last_page: number
  chunk_count: number
}

export type VectorStatus = 'pending' | 'processing' | 'indexed' | 'failed'

export interface Textbook {
  textbook_id: string
  subject_code: string
  title: string
  total_pages: number
  vector_status: VectorStatus
  is_published_to_students: boolean
  pdf_url: string
  chapters: Chapter[]
  created_at: string
}

export interface Job {
  job_id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress: number
  detail: { stage?: string; chunks_done?: number; chunks_total?: number; chunks?: number }
  error: string | null
}

export interface Citation {
  chunk_id: string
  textbook_id: string
  page_number: number
  chapter_number: number | null
  chapter_title: string | null
  similarity: number
  snippet: string
}

export interface TeachingGuide {
  guide_id: string
  textbook_id: string
  chapter_number: number
  chapter_title: string
  institution_level: 'school' | 'college' | 'coaching'
  duration_minutes: number
  lesson_plan_markdown: string
  analogies_and_hooks: {
    opening_hook?: string
    analogy?: string
    learning_objectives?: string[]
    delivery_script?: { minutes: string; step: string; script: string }[]
  }
  board_work_blueprint: { step: number; board: string }[]
  common_misconceptions: { misconception: string; clarification: string }[]
  formative_questions: { question: string; expected_answer: string }[]
  generated_by_model: string
  created_at: string
}

// ───────────── Institution admin & attendance ─────────────
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused'

export interface Tally {
  present: number
  absent: number
  late: number
  excused: number
  total: number
  /** (present + late) / (total − excused) × 100; null when nothing countable */
  percentage: number | null
}

export interface Member {
  user_id: string
  user_code: string
  full_name: string
  email: string
  user_role: Role
  class_code: string | null
  roll_number: string | null
  phone: string | null
  guardian_name: string | null
  guardian_phone: string | null
  allowed_subjects: string[]
  is_active: boolean
  created_at: string
  qualification?: string | null
}

export interface CreatedMember {
  user_id: string
  user_code: string
  full_name: string
  email: string
  role: Role
  class_code: string | null
  temporary_password: string | null
}

export interface ClassSubject {
  subject_code: string
  subject_name: string
  subject_type?: SubjectType
  teacher_code: string | null
  teacher_name?: string | null
  is_mine?: boolean
}

export interface SchoolClass {
  class_id: string
  class_code: string
  class_name: string
  year_code: string
  cycle_code: string
  class_teacher_code: string | null
  class_teacher_name: string | null
  is_active: boolean
  student_count: number
  subjects: ClassSubject[]
  room_number?: string | null
}

export interface TeacherClass {
  class_code: string
  class_name: string
  year_code: string
  cycle_code: string
  is_class_teacher: boolean
  student_count: number
  subjects: ClassSubject[]
}

export interface Organization {
  org_code: string
  org_name: string
  institution_level: 'school' | 'college' | 'coaching'
  city: string | null
  contact_email: string | null
  contact_phone?: string | null
  is_active: boolean
  attendance_threshold?: number
  current_year_code?: string
  current_cycle_code?: string
  teachers?: number
  students?: number
  classes?: number
  admins?: number
  board_or_affiliation?: string | null
  address?: string | null
  max_students?: number | null
  ai_modules?: AIModule[]
  created_at: string
}

export interface AdminOverview {
  organization: Organization
  counts: { teachers: number; students: number; classes: number; classes_without_teacher: number; subjects_without_teacher: number }
  attendance_today: Tally
  attendance_month: Tally
}

export interface DayRosterRow {
  student_user_code: string
  full_name: string
  roll_number: string | null
  status: AttendanceStatus | null
  remarks: string | null
}

export interface AttendanceDay {
  class_code: string
  subject_code: string
  attendance_date: string
  session_slot: string
  is_marked: boolean
  summary: Tally
  students: DayRosterRow[]
}

export interface RegisterRow extends Tally {
  student_user_code: string
  full_name: string
  roll_number: string | null
  days: Record<string, AttendanceStatus[]>
  is_defaulter: boolean
}

export interface AttendanceRegister {
  class_code: string
  class_name: string
  subject_code: string
  month: string
  days: string[]
  marked_days: string[]
  sessions_held: number
  threshold: number
  students: RegisterRow[]
  day_totals: Record<string, Tally>
  class_average: number | null
  defaulters: string[]
}

export interface StudentSubjectAttendance {
  subject_code: string
  subject_name: string
  month: Tally
  overall: Tally
  is_below_threshold: boolean
  records: { date: string; session_slot: string; status: AttendanceStatus; remarks: string | null }[]
  trend: ({ month: string } & Tally)[]
}

export interface StudentAttendance {
  class_code: string
  month: string
  threshold: number
  summary: Tally
  overall: Tally
  subjects: StudentSubjectAttendance[]
  months: string[]
}

// ───────────── Timetable (FR-AD-07) & homework (FR-TE-04 / FR-ST-04) ─────────────
export interface TimetableSlot {
  slot_id: string
  class_code: string
  class_name: string
  subject_code: string
  subject_name: string
  subject_type: SubjectType
  teacher_code: string | null
  teacher_name: string | null
  /** ISO weekday: 1 = Monday … 7 = Sunday */
  day_of_week: number
  period_number: number
  start_time: string
  end_time: string
  room_number: string | null
}

export type HomeworkStatus = 'PENDING' | 'SUBMITTED' | 'REVIEWED'

export interface Homework {
  homework_id: string
  class_code: string
  subject_code: string
  subject_name: string
  title: string
  instructions: string
  attachment_name: string | null
  attachment_url: string | null
  due_date: string
  assigned_by: string
  assigned_by_name: string | null
  created_at: string
  students: number
  submitted: number
  reviewed: number
}

export interface HomeworkSubmission {
  student_user_code: string
  full_name: string
  roll_number: string | null
  status: HomeworkStatus
  submission_notes: string | null
  file_name: string | null
  file_url: string | null
  teacher_remarks: string | null
  submitted_at: string | null
  reviewed_at: string | null
}

export interface StudentHomework {
  homework_id: string
  subject_code: string
  subject_name: string
  title: string
  instructions: string
  attachment_name: string | null
  attachment_url: string | null
  due_date: string
  assigned_by_name: string | null
  created_at: string
  status: HomeworkStatus
  submission_notes: string | null
  file_name: string | null
  file_url: string | null
  teacher_remarks: string | null
  submitted_at: string | null
  is_overdue: boolean
}

export * from './types/evaluation'
