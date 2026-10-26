import { api } from './apiClient'
import type { AssessmentType, EvalDashboard, EvalReport, EvalScope, EvalTest, Job, MasterDraft, MasterQuestion, RegisterRowEval, ScriptsView } from '@/types'

const B = '/ICMELive/api/v1/evaluation'
const A = '/ICMELive/api/v1/admin'
const scope = (org?: string | null) => (org ? { org_code: org } : {})

export interface EvalJob extends Job {
  detail: Job['detail'] & { done?: number; failed?: number; total?: number; errors?: { file: string; error: string }[] }
}

export type StudentEvalTest = EvalTest & { script_id: string; total_obtained_marks: number | string; percentage: number | string; grade: string }

export const evaluationService = {
  async tests(filter: { class_code?: string; subject_code?: string; assessment_type?: AssessmentType } = {}): Promise<EvalTest[]> {
    return (await api.get<{ tests: EvalTest[] }>(`${B}/tests`, { params: filter })).data.tests
  },
  async create(body: {
    class_code: string; subject_code: string; evaluation_scope: EvalScope; test_title: string; exam_date?: string | null
    pass_percentage: number; textbook_id?: string | null; chapter_number?: number | null; chapter_title?: string | null
    assessment_type: AssessmentType; instructions?: string | null; duration_minutes?: number | null
    available_from?: string | null; due_at?: string | null; allow_late?: boolean; results_release?: 'INSTANT' | 'ON_PUBLISH'
  }): Promise<EvalTest> {
    return (await api.post<EvalTest>(`${B}/tests`, body)).data
  },
  async get(id: string, org?: string | null): Promise<EvalTest & { masters: MasterQuestion[] }> {
    return (await api.get<EvalTest & { masters: MasterQuestion[] }>(`${B}/tests/${id}`, { params: scope(org) })).data
  },
  async updateSettings(id: string, patch: Partial<Pick<EvalTest, 'test_title' | 'instructions' | 'duration_minutes' | 'available_from' |
    'due_at' | 'allow_late' | 'results_release'>> & { pass_percentage?: number; exam_date?: string | null }): Promise<EvalTest> {
    return (await api.patch<EvalTest>(`${B}/tests/${id}`, patch)).data
  },
  /** Make an online test / assignment visible to the class (or withdraw it). */
  async setAssigned(id: string, assigned: boolean): Promise<EvalTest> {
    return (await api.post<EvalTest>(`${B}/tests/${id}/assign`, { assigned })).data
  },
  async remove(id: string) {
    return (await api.delete(`${B}/tests/${id}`)).data
  },
  async parseMasters(id: string, questionPaper: File, modelAnswers: File) {
    const fd = new FormData()
    fd.append('question_paper', questionPaper)
    fd.append('model_answers', modelAnswers)
    return (await api.post<{ items: MasterDraft[]; warnings: string[]; parser: 'ai' | 'rules' }>(
      `${B}/tests/${id}/masters/parse`, fd, { timeout: 300_000 })).data
  },
  async saveMasters(id: string, items: MasterDraft[], resetEvaluations = false) {
    return (await api.put<EvalTest & { masters: MasterQuestion[] }>(`${B}/tests/${id}/masters`, { items },
      { params: resetEvaluations ? { reset_evaluations: true } : {}, timeout: 120_000 })).data
  },
  async scripts(id: string): Promise<ScriptsView> {
    return (await api.get<ScriptsView>(`${B}/tests/${id}/scripts`)).data
  },
  async uploadScripts(id: string, files: File[], onProgress?: (pct: number) => void): Promise<ScriptsView> {
    const fd = new FormData()
    files.forEach((f) => fd.append('files', f, f.name))
    return (await api.post<ScriptsView>(`${B}/tests/${id}/scripts`, fd, {
      timeout: 600_000, onUploadProgress: (e) => { if (e.total) onProgress?.(Math.round((e.loaded / e.total) * 100)) },
    })).data
  },
  async assign(id: string, scriptId: string, studentCode: string | null): Promise<ScriptsView> {
    return (await api.patch<ScriptsView>(`${B}/tests/${id}/scripts/${scriptId}`, { student_user_code: studentCode })).data
  },
  async deleteScript(id: string, scriptId: string): Promise<ScriptsView> {
    return (await api.delete<ScriptsView>(`${B}/tests/${id}/scripts/${scriptId}`)).data
  },
  async evaluate(id: string, body: { script_ids?: string[]; re_evaluate?: boolean } = {}) {
    return (await api.post<{ job_id: string; scripts: number }>(`${B}/tests/${id}/evaluate`, body)).data
  },
  async job(jobId: string): Promise<EvalJob> {
    return (await api.get<EvalJob>(`${B}/jobs/${jobId}`)).data
  },
  async dashboard(id: string, org?: string | null): Promise<EvalDashboard> {
    return (await api.get<EvalDashboard>(`${B}/tests/${id}/dashboard`, { params: scope(org) })).data
  },
  async report(id: string, scriptId: string, org?: string | null): Promise<EvalReport> {
    return (await api.get<EvalReport>(`${B}/tests/${id}/scripts/${scriptId}/report`, { params: scope(org) })).data
  },
  async override(id: string, resultId: string, body: { awarded_marks: number; teacher_comment?: string; feedback?: string; reset_to_ai?: boolean }): Promise<EvalReport> {
    return (await api.patch<EvalReport>(`${B}/tests/${id}/results/${resultId}`, body)).data
  },
  async publish(id: string, published: boolean): Promise<EvalTest> {
    return (await api.post<EvalTest>(`${B}/tests/${id}/publish`, { published })).data
  },
  async register(id: string): Promise<{ test: EvalTest; rows: RegisterRowEval[] }> {
    return (await api.get<{ test: EvalTest; rows: RegisterRowEval[] }>(`${B}/tests/${id}/register`)).data
  },
  async registerCsv(id: string): Promise<Blob> {
    return (await api.get(`${B}/tests/${id}/register.csv`, { responseType: 'blob' })).data
  },

  // Student (FR-EV-11)
  async myTests(): Promise<StudentEvalTest[]> {
    return (await api.get<{ tests: StudentEvalTest[] }>(`${B}/my-tests`)).data.tests
  },
  async myReport(id: string): Promise<EvalReport> {
    return (await api.get<EvalReport>(`${B}/my-tests/${id}`)).data
  },

  // Admin (FR-EV-13)
  async adminScores(params: { class_code?: string; subject_code?: string; eval_test_id?: string; assessment_type?: AssessmentType }, org?: string | null) {
    return (await api.get<{ tests: EvalTest[]; test?: EvalTest; rows?: RegisterRowEval[] }>(`${A}/evaluation-scores`,
      { params: { ...params, ...scope(org) } })).data
  },
  async adminScoresCsv(testId: string, org?: string | null): Promise<Blob> {
    return (await api.get(`${A}/evaluation-scores.csv`, { params: { eval_test_id: testId, ...scope(org) }, responseType: 'blob' })).data
  },
}
