import { api } from './apiClient'

const B = '/ICMELive/api/v1/nlp'

export interface NlpClass { class_label: string; grade: number | null }

/** Read-only Class → Subject → Chapter chapter library (backend/nlp/), used by Lesson Plans and Online Test
 * AI question generation. Separate from the Digital Library's DIKSHA catalogue — not used there. */
export const nlpCatalogService = {
  async classes(): Promise<NlpClass[]> {
    return (await api.get<{ classes: NlpClass[] }>(`${B}/classes`)).data.classes
  },
  async subjects(classLabel: string): Promise<string[]> {
    return (await api.get<{ subjects: string[] }>(`${B}/subjects`, { params: { class_label: classLabel } })).data.subjects
  },
  async chapters(classLabel: string, subject: string): Promise<string[]> {
    return (await api.get<{ chapters: string[] }>(`${B}/chapters`, { params: { class_label: classLabel, subject } })).data.chapters
  },
  async chapterText(classLabel: string, subject: string, chapter: string): Promise<string> {
    return (await api.get<{ text: string }>(`${B}/chapter-text`, { params: { class_label: classLabel, subject, chapter } })).data.text
  },
}
