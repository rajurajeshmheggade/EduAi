export type Role = 'superadmin' | 'orgadmin' | 'teacher' | 'student' | 'counsellor' | 'reviewer' | 'parent'
export type AIModule = 'rag_chatbot' | 'ai_avatar_tutor' | 'ocr_evaluation' | 'capability_analysis' | 'question_generator'
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
  /** Set by the admin; the AI avatar tutor uses a male avatar + voice for 'male', otherwise female. */
  gender?: Gender | null
}

export type Gender = 'female' | 'male' | 'other' | 'undisclosed'

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
  grade_number?: number | null
  /** CBSE / NCERT / State board — admin-set; scopes the Digital Library's DIKSHA catalog for this class. */
  board?: string | null
  /** Draft/publish workflow: DRAFT hides this class's timetable from /my-timetable until an admin publishes it. */
  timetable_status?: 'DRAFT' | 'PUBLISHED'
  timetable_published_at?: string | null
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
  schedule_type: 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  effective_from: string | null
  effective_to: string | null
  is_online: boolean
  online_url: string | null
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


// ───────────── Notifications (cross-module in-app inbox) ─────────────
export interface AppNotification {
  notification_id: string
  notif_type: string
  title: string
  body: string | null
  link: string | null
  is_read: boolean
  created_at: string
}

// ───────────── Timetable change history (#3) & holidays (#10) ─────────────
export interface TimetableChange {
  change_id: string
  class_code: string
  day_of_week: number
  period_number: number
  change_kind: 'UPDATED' | 'CANCELLED' | 'ADDED' | 'RESTORED'
  old_subject_name: string | null
  old_teacher_name: string | null
  old_start_time: string | null
  old_end_time: string | null
  new_subject_name: string | null
  new_teacher_name: string | null
  new_start_time: string | null
  new_end_time: string | null
  reason: string | null
  changed_by_name: string | null
  changed_at: string
  /** Set when the change applies to one date only (dated timetable); null = the weekly pattern changed. */
  session_date?: string | null
}

export interface Holiday {
  holiday_id: string
  name: string
  start_date: string
  end_date: string
  holiday_type: 'PUBLIC' | 'SCHOOL'
  description: string | null
  scope: 'SCHOOL_WIDE' | 'CLASS'
  class_codes: string[]
  is_full_day: boolean
  status: 'DRAFT' | 'PUBLISHED'
}

// ───────────── Date-level timetable (calendar, dated sessions, bell schedule, rooms) ─────────────
/** One concrete period on one date: the weekly pattern with dated changes and holidays applied. */
export interface TimetableSession {
  session_key: string
  session_date: string
  day_of_week: number
  class_code: string
  class_name: string
  period_number: number
  start_time: string
  end_time: string
  subject_code: string | null
  subject_name: string | null
  subject_type: SubjectType | null
  teacher_code: string | null
  teacher_name: string | null
  room_number: string | null
  is_online: boolean
  online_url: string | null
  /** TEMPLATE = weekly period · OVERRIDE = weekly period changed on this date · DATED = added on this date */
  source: 'TEMPLATE' | 'OVERRIDE' | 'DATED'
  status: 'SCHEDULED' | 'CANCELLED' | 'HOLIDAY'
  slot_id: string | null
  entry_id: string | null
  schedule_type: 'WEEKLY' | 'MONTHLY' | 'YEARLY' | null
  /** The weekly period's own teacher (differs from teacher_code when someone covers it on this date). */
  template_teacher_code: string | null
  note: string | null
  holiday_name: string | null
  class_timetable_status: 'DRAFT' | 'PUBLISHED'
  copied_from: string | null
  /** Teacher's own calendar only: false when another teacher covers this period of theirs. */
  is_mine?: boolean
}

export interface BellItem {
  item_kind: 'PERIOD' | 'BREAK'
  period_number: number | null
  label: string | null
  start_time: string
  end_time: string
}

export interface BellSchedule {
  /** false = the built-in bell (8 × 45 min from 09:00, break after period 3) */
  configured: boolean
  default: BellItem[]
  /** ISO weekday ("1"…"7") -> that day's own bell */
  by_day: Record<string, BellItem[]>
}

export type ConflictKind = 'NON_WORKING_DAY' | 'TEACHER_CLASH' | 'CLASS_CLASH' | 'ROOM_CLASH' | 'HOLIDAY' | 'BREAK_OVERLAP'

export interface TimetableConflict {
  kind: ConflictKind
  severity: 'error' | 'warning'
  message: string
  conflict_date: string | null
  day_of_week: number | null
  class_code: string | null
  period_number: number | null
  start_time: string | null
  end_time: string | null
  teacher_code: string | null
  room_number: string | null
  subject_name: string | null
  source: 'TEMPLATE' | 'OVERRIDE' | 'DATED' | null
}

export interface Room {
  room_id: string
  room_code: string
  room_name: string | null
  room_type: 'CLASSROOM' | 'LAB' | 'HALL' | 'OTHER'
  capacity: number | null
  is_active: boolean
}

export interface TimetableCalendar {
  start: string
  end: string
  today: string
  sessions: TimetableSession[]
  holidays: Holiday[]
  working_days: number[]
  bell_schedule: BellSchedule
}

export interface CopyReport {
  dry_run: boolean
  days: number
  non_working_days_skipped: number
  unchanged: number
  copied: { date: string; source_date: string; class_code: string; class_name: string; period_number: number; subject_name: string | null;
    teacher_name: string | null; start_time: string; end_time: string; action: 'ADDED' | 'REPLACED' }[]
  cancelled: { date: string; class_code: string; period_number: number; subject_name: string | null; start_time: string; end_time: string }[]
  skipped: { date: string; source_date?: string; reason: 'OCCUPIED' | 'CONFLICT' | 'HOLIDAY' | 'NON_WORKING_DAY' | 'NOTHING_TO_COPY';
    class_code: string | null; period_number: number | null; subject_name: string | null; message: string; conflicts: TimetableConflict[] }[]
}

/** GET /classroom/my-timetable */
export interface MyTimetable {
  today: number
  today_date: string
  slots: TimetableSlot[]
  holidays: Holiday[]
  recent_changes: TimetableChange[]
  range: { start: string; end: string }
  sessions: TimetableSession[]
  range_holidays: Holiday[]
  working_days: number[]
  bell_schedule: BellSchedule
}
