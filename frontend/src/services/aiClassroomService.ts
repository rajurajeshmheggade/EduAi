import { api } from './apiClient'

/** AI Classroom's chapter-library reader (students): Class -> Subject -> Chapter PDFs from backend/nlp/, with
 * an AI assistant grounded in the page currently open. Separate from the textbook-upload classroom
 * (curriculumService/ragAvatarService) — this one reads the same curated filesystem catalogue Lesson Plans use. */
const B = '/ICMELive/api/v1/ai-classroom/nlp'

export interface NlpClass { class_label: string; grade: number | null }
export interface NlpChapter { chapter: string; has_text: boolean; has_pdf: boolean }
export interface ChatTurn { role: 'user' | 'assistant'; content: string }

export const aiClassroomService = {
  classes: () => api.get<{ classes: NlpClass[] }>(`${B}/classes`).then((r) => r.data.classes),
  subjects: (classLabel: string) => api.get<{ subjects: string[] }>(`${B}/subjects`, { params: { class_label: classLabel } }).then((r) => r.data.subjects),
  chapters: (classLabel: string, subject: string) =>
    api.get<{ chapters: NlpChapter[] }>(`${B}/chapters`, { params: { class_label: classLabel, subject } }).then((r) => r.data.chapters),
  chapterPdf: (classLabel: string, subject: string, chapter: string) =>
    api.get<Blob>(`${B}/chapter-pdf`, { params: { class_label: classLabel, subject, chapter }, responseType: 'blob' }).then((r) => r.data),
  ask: (classLabel: string, subject: string, chapter: string, page: number, question: string, history: ChatTurn[]) =>
    api.post<{ answer: string; engine: string }>(`${B}/ask`, { class_label: classLabel, subject, chapter, page, question, history }).then((r) => r.data),
  explain: (classLabel: string, subject: string, chapter: string, page: number) =>
    api.post<{ explanation: string; engine: string }>(`${B}/explain`, { class_label: classLabel, subject, chapter, page }).then((r) => r.data),
}
