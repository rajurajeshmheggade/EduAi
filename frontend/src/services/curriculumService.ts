import { api } from './apiClient'
import type { Job, TeachingGuide, Textbook } from '@/types'

const B = '/ICMELive/api/v1/curriculum'

export const curriculumService = {
  async listTextbooks(subject: string): Promise<Textbook[]> {
    const { data } = await api.get<{ textbooks: Textbook[] }>(`${B}/textbooks/${encodeURIComponent(subject)}`)
    return data.textbooks
  },

  async upload(args: { file: File; title: string; subject: string; year?: string | null; cycle?: string | null; klass?: string | null },
               onProgress?: (pct: number) => void) {
    const fd = new FormData()
    fd.append('file', args.file)
    fd.append('title', args.title)
    fd.append('subject_code', args.subject)
    if (args.year) fd.append('year_code', args.year)
    if (args.cycle) fd.append('cycle_code', args.cycle)
    if (args.klass) fd.append('class_code', args.klass)
    const { data } = await api.post<{ textbook_id: string; job_id: string }>(`${B}/upload-textbook`, fd, {
      onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)),
    })
    return data
  },

  async job(jobId: string): Promise<Job> {
    return (await api.get<Job>(`${B}/jobs/${jobId}`)).data
  },

  async publish(textbookId: string, published: boolean) {
    return (await api.post(`${B}/textbooks/${textbookId}/publish`, { published })).data
  },

  async generateGuide(body: { textbook_id: string; chapter_number: number; duration_minutes: number; institution_level?: string }) {
    return (await api.post<TeachingGuide>(`${B}/generate-teaching-guide`, body, { timeout: 120_000 })).data
  },

  async listGuides(textbookId: string): Promise<TeachingGuide[]> {
    return (await api.get<{ guides: TeachingGuide[] }>(`${B}/guides/${textbookId}`)).data.guides
  },

  async updateGuide(guideId: string, patch: Partial<Pick<TeachingGuide, 'lesson_plan_markdown'>>) {
    return (await api.put<TeachingGuide>(`${B}/guides/${guideId}`, patch)).data
  },

  async exportGuidePdf(guideId: string): Promise<Blob> {
    return (await api.get(`${B}/guides/${guideId}/export.pdf`, { responseType: 'blob' })).data
  },
}
