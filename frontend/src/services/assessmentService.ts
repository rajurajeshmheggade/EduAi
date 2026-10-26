import { api } from './apiClient'
import type { EvalReport, StudentAssessment } from '@/types'

const B = '/ICMELive/api/v1/assessments'

/** Student side of teacher-assigned online tests and assignments (FRD v3.2). */
export const assessmentService = {
  async list(type?: 'ONLINE_TEST' | 'ASSIGNMENT'): Promise<{ assessments: StudentAssessment[]; pending: number }> {
    return (await api.get(`${B}/my`, { params: type ? { assessment_type: type } : {} })).data
  },
  async get(id: string): Promise<StudentAssessment> {
    return (await api.get<StudentAssessment>(`${B}/my/${id}`)).data
  },
  async start(id: string): Promise<StudentAssessment> {
    return (await api.post<StudentAssessment>(`${B}/my/${id}/start`)).data
  },
  async autosave(id: string, answers: Record<string, string>, flagged: string[]) {
    return (await api.put<{ saved: number; seconds_left: number }>(`${B}/my/${id}/answers`, { answers, flagged })).data
  },
  async submit(id: string, answers: Record<string, string>, flagged: string[]): Promise<StudentAssessment> {
    return (await api.post<StudentAssessment>(`${B}/my/${id}/submit`, { answers, flagged })).data
  },
  async upload(id: string, file: File, onProgress?: (pct: number) => void): Promise<StudentAssessment> {
    const fd = new FormData()
    fd.append('file', file)
    return (await api.post<StudentAssessment>(`${B}/my/${id}/upload`, fd, {
      timeout: 300_000, onUploadProgress: (e) => { if (e.total) onProgress?.(Math.round((e.loaded / e.total) * 100)) },
    })).data
  },
  async report(id: string): Promise<EvalReport> {
    return (await api.get<EvalReport>(`${B}/my/${id}/report`)).data
  },
}

/** "in 2 d 4 h", "in 35 min", "3 h ago" — relative to now. */
export function relTime(iso: string | null): string {
  if (!iso) return ''
  const diff = new Date(iso).getTime() - Date.now()
  const abs = Math.abs(diff) / 60_000
  const txt = abs < 60 ? `${Math.max(1, Math.round(abs))} min` : abs < 1440 ? `${Math.round(abs / 60)} h` : `${Math.floor(abs / 1440)} d ${Math.round((abs % 1440) / 60)} h`
  return diff >= 0 ? `in ${txt}` : `${txt} ago`
}

export const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
