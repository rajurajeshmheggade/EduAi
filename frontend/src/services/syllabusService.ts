import { api } from './apiClient'

export interface SyllabusTopic { topic_id: string; title: string }
export interface SyllabusChapter { chapter_id: string; number: number; title: string; description: string | null; topics: SyllabusTopic[] }
export interface Syllabus { class_code: string; subject_code: string; chapters: SyllabusChapter[]; chapter_count: number; topic_count: number }
export type SyllabusCounts = Record<string, { chapters: number; topics: number }>

const enc = encodeURIComponent
const base = (cls: string, subj: string) => `/ICMELive/api/v1/admin/classes/${enc(cls)}/subjects/${enc(subj)}/syllabus`
const q = (org?: string | null) => (org ? { params: { org_code: org } } : {})

/** Admin syllabus editor: every mutation returns the full, renumbered syllabus. */
export function syllabusApi(cls: string, subj: string, org?: string | null) {
  const b = base(cls, subj)
  return {
    get: async () => (await api.get<Syllabus>(b, q(org))).data,
    addChapter: async (body: { title: string; description?: string | null; topics?: string[] }) => (await api.post<Syllabus>(`${b}/chapters`, body, q(org))).data,
    updateChapter: async (id: string, body: { title?: string; description?: string | null }) => (await api.patch<Syllabus>(`${b}/chapters/${id}`, body, q(org))).data,
    deleteChapter: async (id: string) => (await api.delete<Syllabus>(`${b}/chapters/${id}`, q(org))).data,
    moveChapter: async (id: string, direction: 'up' | 'down') => (await api.post<Syllabus>(`${b}/chapters/${id}/move`, { direction }, q(org))).data,
    addTopics: async (id: string, titles: string[]) => (await api.post<Syllabus>(`${b}/chapters/${id}/topics`, { titles }, q(org))).data,
    updateTopic: async (id: string, title: string) => (await api.patch<Syllabus>(`${b}/topics/${id}`, { title }, q(org))).data,
    deleteTopic: async (id: string) => (await api.delete<Syllabus>(`${b}/topics/${id}`, q(org))).data,
    moveTopic: async (id: string, direction: 'up' | 'down') => (await api.post<Syllabus>(`${b}/topics/${id}/move`, { direction }, q(org))).data,
    importText: async (text: string, mode: 'append' | 'replace') => (await api.post<Syllabus>(`${b}/import`, { text, mode }, q(org))).data,
    copyFrom: async (from_class_code: string, mode: 'append' | 'replace') => (await api.post<Syllabus>(`${b}/copy`, { from_class_code, mode }, q(org))).data,
  }
}

export const syllabusCounts = async (cls: string, org?: string | null) =>
  (await api.get<{ subjects: SyllabusCounts }>(`/ICMELive/api/v1/admin/classes/${enc(cls)}/syllabus-summary`, q(org))).data.subjects
