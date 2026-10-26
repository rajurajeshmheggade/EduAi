import { api } from './apiClient'
import type { AttendanceDay, AttendanceRegister, AttendanceStatus, CreatedMember, Homework, HomeworkSubmission, Member, StudentAttendance, StudentHomework, TeacherClass, TimetableSlot } from '@/types'

const B = '/ICMELive/api/v1/classroom'

export interface StudentBody {
  full_name: string
  user_code?: string
  email?: string
  roll_number?: string
  phone?: string
  guardian_name?: string
  guardian_phone?: string
  password?: string
}

const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null)) as Partial<T>

export const classroomService = {
  async myClasses(): Promise<TeacherClass[]> {
    return (await api.get<{ classes: TeacherClass[] }>(`${B}/my-classes`)).data.classes
  },
  async students(classCode: string) {
    return (await api.get<{ class_code: string; class_name: string; is_class_teacher: boolean; students: Member[] }>(
      `${B}/classes/${encodeURIComponent(classCode)}/students`)).data
  },
  async createStudent(classCode: string, body: StudentBody): Promise<CreatedMember> {
    return (await api.post<CreatedMember>(`${B}/classes/${encodeURIComponent(classCode)}/students`, clean(body))).data
  },
  async importStudents(classCode: string, file: File) {
    const fd = new FormData()
    fd.append('file', file)
    return (await api.post<{ created: CreatedMember[]; errors: { row: number; error: string }[] }>(
      `${B}/classes/${encodeURIComponent(classCode)}/students/import`, fd)).data
  },
  async updateStudent(classCode: string, code: string, patch: Partial<StudentBody> & { is_active?: boolean; reset_password?: boolean }) {
    return (await api.patch<Member & { temporary_password: string | null }>(
      `${B}/classes/${encodeURIComponent(classCode)}/students/${encodeURIComponent(code)}`, patch)).data
  },

  async day(p: { class_code: string; subject_code: string; attendance_date: string; session_slot: string }): Promise<AttendanceDay> {
    return (await api.get<AttendanceDay>(`${B}/attendance`, { params: p })).data
  },
  async save(body: {
    class_code: string; subject_code: string; attendance_date: string; session_slot: string
    records: { student_user_code: string; status: AttendanceStatus; remarks?: string | null }[]
  }) {
    return (await api.post<{ saved: number }>(`${B}/attendance`, body)).data
  },
  /** `org_code` is only used by the platform super-admin managing another institution. */
  async register(p: { class_code: string; subject_code: string; month: string; org_code?: string }): Promise<AttendanceRegister> {
    return (await api.get<AttendanceRegister>(`${B}/attendance/register`, { params: p })).data
  },
  /** Excel / CSV attendance export over a date range; returns the file and the server's filename. */
  async exportAttendance(p: {
    start: string; end: string; class_code?: string; subject_code?: string
    report: 'register' | 'summary' | 'defaulters'; fmt: 'xlsx' | 'csv'; org_code?: string
  }): Promise<{ blob: Blob; filename: string }> {
    try {
      const r = await api.get<Blob>(`${B}/attendance/export`, { params: p, responseType: 'blob' })
      const m = /filename="([^"]+)"/.exec(String(r.headers['content-disposition'] ?? ''))
      return { blob: r.data, filename: m?.[1] ?? `attendance-${p.start}-${p.end}.${p.fmt}` }
    } catch (e) {
      // Blob responses hide the JSON error body; unwrap it so errorMessage() can show the server's detail.
      const data = (e as { response?: { data?: unknown } }).response?.data
      if (data instanceof Blob) {
        try { (e as { response: { data: unknown } }).response.data = JSON.parse(await data.text()) } catch { /* not JSON */ }
      }
      throw e
    }
  },

  async myAttendance(month?: string): Promise<StudentAttendance> {
    return (await api.get<StudentAttendance>(`${B}/my-attendance`, { params: month ? { month } : {} })).data
  },

  /** Teacher: periods I teach · Student: my class's week. `today` is the ISO weekday (1 = Monday). */
  async myTimetable(): Promise<{ today: number; slots: TimetableSlot[] }> {
    return (await api.get<{ today: number; slots: TimetableSlot[] }>(`${B}/my-timetable`)).data
  },

  async homework(classCode: string, subject?: string): Promise<Homework[]> {
    const params = { class_code: classCode, ...(subject ? { subject_code: subject } : {}) }
    return (await api.get<{ homework: Homework[] }>(`${B}/homework`, { params })).data.homework
  },
  async createHomework(body: { class_code: string; subject_code: string; title: string; instructions: string; due_date: string; attachment?: File | null }) {
    const fd = new FormData()
    Object.entries(body).forEach(([k, v]) => { if (v != null && v !== '') fd.append(k, v as string | Blob) })
    return (await api.post<Homework>(`${B}/homework`, fd)).data
  },
  async deleteHomework(id: string) {
    return (await api.delete(`${B}/homework/${id}`)).data
  },
  async submissions(id: string): Promise<HomeworkSubmission[]> {
    return (await api.get<{ submissions: HomeworkSubmission[] }>(`${B}/homework/${id}/submissions`)).data.submissions
  },
  async review(id: string, student: string, remarks: string) {
    return (await api.post(`${B}/homework/${id}/submissions/${encodeURIComponent(student)}/review`, { remarks })).data
  },
  async myHomework(): Promise<{ homework: StudentHomework[]; pending: number }> {
    return (await api.get<{ homework: StudentHomework[]; pending: number }>(`${B}/my-homework`)).data
  },
  async submitHomework(id: string, notes: string, file?: File | null) {
    const fd = new FormData()
    if (notes.trim()) fd.append('notes', notes.trim())
    if (file) fd.append('file', file)
    return (await api.post(`${B}/my-homework/${id}/submit`, fd)).data
  },
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}

/** Local-date helpers (avoid UTC shifting the day). */
export const isoDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const isoMonth = (d = new Date()) => isoDay(d).slice(0, 7)
export const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
export const shiftMonth = (m: string, delta: number) => {
  const d = new Date(`${m}-01T00:00:00`)
  d.setMonth(d.getMonth() + delta)
  return isoMonth(d)
}
