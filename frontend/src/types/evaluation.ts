// ───────────── AI evaluation engine (FR-EV-01..13) ─────────────
export type EvalScope = 'SUBJECT_LEVEL' | 'CHAPTER_LEVEL'
export type EvalStatus = 'DRAFT' | 'READY' | 'PROCESSING' | 'EVALUATED' | 'PUBLISHED'
export type ScriptStatus = 'IN_PROGRESS' | 'UPLOADED' | 'QUEUED' | 'OCR_IN_PROGRESS' | 'EVALUATED' | 'REVIEWED' | 'FAILED'
export type AssessmentType = 'OFFLINE_EXAM' | 'ONLINE_TEST' | 'ASSIGNMENT'
export type QuestionType = 'MCQ' | 'SHORT_ANSWER' | 'DESCRIPTIVE' | 'NUMERICAL'
export type SubmissionMode = 'TEACHER_FOLDER_UPLOAD' | 'STUDENT_PDF_UPLOAD' | 'ONLINE_TEST_UI'
export interface AssessmentWindow { open: boolean; reason?: string; late?: boolean; opens_at?: string }
/** Postgres NUMERIC arrives as a string; use `num()` before arithmetic. */
export type Numeric = number | string

export interface EvalTest {
  eval_test_id: string
  class_code: string
  class_name: string
  subject_code: string
  subject_name: string
  evaluation_scope: EvalScope
  chapter_number: number | null
  chapter_title: string | null
  test_title: string
  exam_date: string | null
  pass_percentage: Numeric
  total_max_marks: Numeric
  total_questions: number
  status: EvalStatus
  created_by: string
  created_at: string
  scripts: number
  evaluated: number
  average_percentage: Numeric | null
  assessment_type: AssessmentType
  instructions: string | null
  duration_minutes: number | null
  available_from: string | null
  due_at: string | null
  allow_late: boolean
  results_release: 'INSTANT' | 'ON_PUBLISH'
  is_assigned: boolean
  assigned_at: string | null
  class_students: number
  submitted: number
  window?: AssessmentWindow | null
  question_paper_name?: string | null
  model_answer_name?: string | null
  question_paper_url?: string | null
  model_answer_url?: string | null
  last_job_id?: string | null
}

export interface MasterDraft {
  sl_no: string
  question_type: QuestionType
  mcq_options: string[]
  correct_option: string | null
  question_text: string
  max_marks: number | null
  model_answer_text: string
  key_rubric_points: string[]
}

export interface MasterQuestion extends Omit<MasterDraft, 'max_marks'> {
  master_q_id: string
  display_order: number
  max_marks: Numeric
  has_embedding: boolean
}

export interface EvalScript {
  script_id: string
  student_user_code: string | null
  student_name: string | null
  roll_number: string | null
  uploaded_pdf_filename: string
  page_count: number
  match_method: 'name' | 'code' | 'roll' | 'fuzzy' | 'manual' | null
  match_score: Numeric | null
  processing_status: ScriptStatus
  error: string | null
  total_obtained_marks: Numeric
  total_max_marks: Numeric
  percentage: Numeric
  attempted_questions_count: number
  unanswered_questions_count: number
  ocr_method: 'text_layer' | 'vision' | 'typed' | null
  submission_mode: SubmissionMode
  submitted_at: string | null
  is_late: boolean
}

export interface ScriptsView {
  scripts: EvalScript[]
  roster: { user_code: string; full_name: string; roll_number: string | null }[]
  students_without_script: string[]
  uploaded?: { file: string; student_user_code?: string | null; match_method?: string | null; replaced?: boolean; error?: string }[]
}

export interface ScoreRow {
  script_id: string
  student_user_code: string | null
  student_name: string | null
  roll_number: string | null
  uploaded_pdf_filename: string
  total_obtained_marks: Numeric
  total_max_marks: Numeric
  percentage: Numeric
  attempted_questions_count?: number
  unanswered_questions_count?: number
  overall_ai_feedback?: string | null
  grade?: string
}

export interface QuestionAnalytics {
  sl_no: string
  question_text: string
  max_marks: number
  total_candidates: number
  attempted_count: number
  unanswered_count: number
  attempt_rate: number | null
  not_answered_by_any_student: boolean
  avg_marks_scored: number | null
  avg_percentage: number | null
  full_marks_count: number
  common_missing_points: { point: string; students: number }[]
}

export interface SubmissionProgress {
  enrolled: number
  submitted: number
  in_progress: number
  not_submitted: number
  late: number
  evaluating: number
  not_submitted_students: { user_code: string; full_name: string; roll_number: string | null }[]
  in_progress_students: string[]
  due_at: string | null
}

export interface EvalDashboard {
  test: EvalTest
  submission: SubmissionProgress
  overview: {
    class_students: number
    scripts_uploaded: number
    unmatched_scripts: number
    failed_scripts: number
    in_progress: number
    total_students_evaluated: number
    total_max_marks: number
    class_average_marks: number | null
    class_average_percentage: number | null
    median_percentage: number | null
    highest_marks: Numeric | null
    lowest_marks: Numeric | null
    pass_percentage: number
    passed: number
    pass_rate: number | null
  }
  top_scoring_students: ScoreRow[]
  low_scoring_students: ScoreRow[]
  question_analytics: QuestionAnalytics[]
  unanswered_by_all: string[]
  most_skipped: QuestionAnalytics[]
  score_distribution: { range: string; students: number }[]
  grade_distribution: Record<string, number>
}

export interface SlnoResult {
  slno_result_id: string
  sl_no: string
  question_type: QuestionType
  mcq_options: string[]
  correct_option: string | null
  question_text: string
  model_answer_text: string
  key_rubric_points: string[]
  is_attempted: boolean
  student_ocr_text: string | null
  page_numbers: number[]
  semantic_similarity: Numeric
  ai_awarded_marks: Numeric
  awarded_marks: Numeric
  max_marks: Numeric
  why_marks_given: string
  missing_points: string[]
  feedback: string
  teacher_override: boolean
  teacher_comment: string | null
}

export interface EvalReport {
  summary: {
    eval_test_id: string
    test_title: string
    evaluation_scope: EvalScope
    chapter_title: string | null
    subject_code: string
    exam_date: string | null
    student_user_code: string | null
    student_name: string | null
    roll_number: string | null
    uploaded_pdf_filename: string
    script_url: string | null
    page_count: number
    ocr_method: string | null
    processing_status: ScriptStatus
    total_obtained_marks: number
    total_max_marks: number
    percentage: number
    grade: string | null
    passed: boolean | null
    rank: number | null
    out_of: number
    percentile: number | null
    attempted_questions_count: number
    unanswered_questions_count: number
    overall_ai_feedback: string | null
    error: string | null
    assessment_type: AssessmentType
    submission_mode: SubmissionMode | null
    submitted_at: string | null
    is_late: boolean
  }
  slno_wise_report: SlnoResult[]
}

export interface RegisterRowEval {
  rank_no: number | null
  script_id: string
  student_user_code: string | null
  student_name: string | null
  roll_number: string | null
  uploaded_pdf_filename: string
  attempted_questions: number
  unanswered_questions: number
  obtained_marks: Numeric
  max_marks: Numeric
  percentage: Numeric
  processing_status: ScriptStatus | 'NOT_SUBMITTED'
  grade: string | null
  result: 'Pass' | 'Fail' | null
  submission_mode: SubmissionMode | null
  submitted_at: string | null
  is_late: boolean
}

export const num = (v: Numeric | null | undefined): number => (v == null ? 0 : typeof v === 'number' ? v : Number(v))

// ───────────── Student side of online tests & assignments (FRD v3.2) ─────────────
export type MyAssessmentStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'EVALUATING' | 'EVALUATED' | 'FAILED'

export interface RunnerQuestion {
  sl_no: string
  question_type: QuestionType
  question_text: string
  mcq_options: string[]
  max_marks: Numeric
}

export interface StudentAssessment {
  eval_test_id: string
  assessment_type: 'ONLINE_TEST' | 'ASSIGNMENT'
  test_title: string
  subject_code: string
  subject_name: string | null
  class_name: string | null
  evaluation_scope: EvalScope
  chapter_title: string | null
  instructions: string | null
  duration_minutes: number | null
  available_from: string | null
  due_at: string | null
  allow_late: boolean
  results_release: 'INSTANT' | 'ON_PUBLISH'
  total_max_marks: Numeric
  total_questions: number
  question_paper_url: string | null
  window: AssessmentWindow
  my: {
    status: MyAssessmentStatus
    started_at: string | null
    deadline: string | null
    seconds_left: number | null
    submitted_at: string | null
    is_late: boolean
    file_name: string | null
    file_url: string | null
    submitted_by_teacher: boolean
    error: string | null
  }
  result_available: boolean
  result_pending_publish: boolean
  score: { obtained: Numeric; max: Numeric; percentage: Numeric; grade: string } | null
  questions?: RunnerQuestion[]
  answers?: Record<string, string>
  flagged?: string[]
}
