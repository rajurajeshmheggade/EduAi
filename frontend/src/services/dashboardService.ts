import { api } from './apiClient'
import type { AssessmentType, Numeric, Tally, TeacherClass, TimetableSlot } from '@/types'

export interface DashAssessment {
  eval_test_id: string
  assessment_type: AssessmentType
  test_title: string
  class_name: string
  subject_name: string
  status: string
  due_at: string | null
  is_assigned: boolean
  class_students: number
  submitted: number
  evaluated: number
  average_percentage: Numeric | null
  scripts: number
  total_questions: number
  reasons?: string[]
}

export interface TeacherDash {
  today: string
  weekday: number
  kpis: { classes: number; students: number; periods_today: number; attendance_pending: number; homework_to_review: number; active_assessments: number; needs_attention: number }
  classes: TeacherClass[]
  today_slots: (TimetableSlot & { attendance_marked: boolean })[]
  homework_to_review: { homework_id: string; title: string; class_code: string; subject_code: string; due_date: string; to_review: number; submitted: number }[]
  active_assessments: DashAssessment[]
  attention: DashAssessment[]
  recent_results: DashAssessment[]
  attendance_month: ({ class_code: string; subject_code: string; sessions: number } & Tally)[]
}

export interface StudentDash {
  today: string
  weekday: number
  threshold: number
  class_code: string
  kpis: { attendance_month: number | null; attendance_overall: number | null; homework_pending: number; to_do: number; average_score: number | null; results: number }
  attendance_month: Tally
  attendance_by_subject: ({ subject_code: string; subject_name: string } & Tally)[]
  today_slots: TimetableSlot[]
  homework: { homework_id: string; title: string; subject_name: string; due_date: string }[]
  upcoming: { eval_test_id: string; assessment_type: 'ONLINE_TEST' | 'ASSIGNMENT'; title: string; subject_name: string; due_at: string | null; opens_at: string | null; in_progress: boolean; duration_minutes: number | null }[]
  results: { eval_test_id: string; assessment_type: AssessmentType; title: string; subject_name: string; obtained: Numeric; max: Numeric; percentage: number; grade: string; date: string | null }[]
  subjects: { subject_code: string; subject_name: string }[]
}

export interface AdminDash {
  attendance_trend: { date: string; marks: number; percentage: number | null }[]
  class_attendance: ({ class_code: string; class_name: string } & Tally)[]
  assessments: { online_tests: number; assignments: number; offline_exams: number; open_now: number; evaluated: number; teacher_reviewed: number; average_percentage: Numeric | null }
  recent_members: { full_name: string; user_role: 'teacher' | 'student'; class_code: string | null; created_at: string }[]
}

const B = '/ICMELive/api/v1/dashboard'
export const dashboardService = {
  teacher: async () => (await api.get<TeacherDash>(`${B}/teacher`)).data,
  student: async () => (await api.get<StudentDash>(`${B}/student`)).data,
  admin: async (org?: string | null) => (await api.get<AdminDash>(`${B}/admin`, { params: org ? { org_code: org } : {} })).data,
}
