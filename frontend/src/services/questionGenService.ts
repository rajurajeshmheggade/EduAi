import { api } from './apiClient'
import type {
  AssessmentResult, BankItem, BankSaveResult, ContentPreview, GenerateRequest, GenerateResult, Lang, MappingsResponse,
  MediaInfo, Paper, PaperHeader, PaperItem, PaperSummary, QgenMeta, QgenSettings, Question, QType, Section, SegmentView,
  TeacherClass, TopicView,
} from '@/types/questionGen'

const B = '/ICMELive/api/v1/qgen'
/** AI generation runs one model call per question type in parallel, each with its own time budget. */
export const GENERATE_TIMEOUT_MS = 240_000

type Sig = { signal?: AbortSignal }
export interface ChapterList { nlp_class: string; nlp_subject: string; discipline: string | null; chapters: string[]; primary: string[] }

export interface PaperSave {
  revision: number
  title: string
  language: Lang
  chapter: string | null
  header: PaperHeader
  sections: Section[]
  items: PaperItem[]
}

/** AI Question Generator API (teacher). Content repository → generation → papers → bank → exports. */
export const questionGenService = {
  async meta({ signal }: Sig = {}): Promise<QgenMeta> {
    return (await api.get<QgenMeta>(`${B}/meta`, { signal })).data
  },
  async classes({ signal }: Sig = {}): Promise<TeacherClass[]> {
    return (await api.get<{ classes: TeacherClass[] }>(`${B}/catalog/classes`, { signal })).data.classes
  },
  /** `primary`: the subject's own chapters when it maps onto a combined book (Physics → Science), listed first. */
  async chapters(classCode: string, subjectCode: string, { signal }: Sig = {}): Promise<ChapterList> {
    return (await api.get<ChapterList>(`${B}/catalog/chapters`, { params: { class_code: classCode, subject_code: subjectCode }, signal })).data
  },
  async topics(classCode: string, subjectCode: string, chapter: string, { signal }: Sig = {}) {
    return (await api.get<{ topic_source: 'headings' | 'syllabus' | 'segments'; source_file: string; topics: TopicView[] }>(
      `${B}/catalog/topics`, { params: { class_code: classCode, subject_code: subjectCode, chapter }, signal })).data
  },
  async content(classCode: string, subjectCode: string, chapter: string, topicId: string, { signal }: Sig = {}) {
    return (await api.get<{ topic: TopicView; segments: SegmentView[] }>(`${B}/catalog/content`, {
      params: { class_code: classCode, subject_code: subjectCode, chapter, topic_id: topicId }, signal })).data
  },
  async preview(classCode: string, subjectCode: string, chapter: string, topicId: string, segmentIds: string[], { signal }: Sig = {}) {
    return (await api.get<ContentPreview>(`${B}/catalog/preview`, {
      params: { class_code: classCode, subject_code: subjectCode, chapter, topic_id: topicId, segment_ids: segmentIds },
      paramsSerializer: { indexes: null }, signal })).data
  },
  async generate(body: GenerateRequest, { signal }: Sig = {}): Promise<GenerateResult> {
    return (await api.post<GenerateResult>(`${B}/generate`, body, { timeout: GENERATE_TIMEOUT_MS, signal })).data
  },
  async validate(q: Question): Promise<Question> {
    return (await api.post<{ question: Question }>(`${B}/validate`, q)).data.question
  },

  // ---------------------------------------------------------------- papers
  async papers({ signal }: Sig = {}): Promise<PaperSummary[]> {
    return (await api.get<{ papers: PaperSummary[] }>(`${B}/papers`, { signal })).data.papers
  },
  async createPaper(body: { class_code: string; subject_code: string; chapter?: string | null; title: string; language: Lang }): Promise<Paper> {
    return (await api.post<Paper>(`${B}/papers`, body)).data
  },
  async paper(id: string, { signal }: Sig = {}): Promise<Paper> {
    return (await api.get<Paper>(`${B}/papers/${id}`, { signal })).data
  },
  async savePaper(id: string, body: PaperSave): Promise<Paper> {
    return (await api.put<Paper>(`${B}/papers/${id}`, body)).data
  },
  async deletePaper(id: string): Promise<void> {
    await api.delete(`${B}/papers/${id}`)
  },
  async addItems(id: string, items: { section_id?: string | null; question: Question }[]): Promise<Paper & { added: number; skipped_duplicates: number }> {
    return (await api.post(`${B}/papers/${id}/items`, { items })).data
  },
  async publish(id: string): Promise<Paper> {
    return (await api.post<Paper>(`${B}/papers/${id}/publish`)).data
  },
  async newVersion(id: string): Promise<Paper> {
    return (await api.post<Paper>(`${B}/papers/${id}/new-version`)).data
  },
  async createAssessment(id: string, body: { assessment_type: 'ONLINE_TEST' | 'ASSIGNMENT'; duration_minutes?: number | null }): Promise<AssessmentResult> {
    return (await api.post<AssessmentResult>(`${B}/papers/${id}/assessment`, body)).data
  },
  async pdf(id: string, answerKey: boolean): Promise<Blob> {
    return (await api.get(`${B}/papers/${id}/export.pdf`, { params: { answer_key: answerKey }, responseType: 'blob', timeout: 120_000 })).data
  },

  // ---------------------------------------------------------------- question bank
  async saveToBankFromPaper(id: string, body: { item_ids?: string[]; visibility: 'PRIVATE' | 'ORG' }): Promise<BankSaveResult> {
    return (await api.post<BankSaveResult>(`${B}/papers/${id}/bank`, body)).data
  },
  async saveToBank(body: { class_code: string; subject_code: string; chapter?: string | null; language: Lang; visibility: 'PRIVATE' | 'ORG'; questions: Question[] }): Promise<BankSaveResult> {
    return (await api.post<BankSaveResult>(`${B}/bank`, body)).data
  },
  async bank(params: { q?: string; qtype?: QType | ''; difficulty?: string; bloom?: string; nlp_class?: string; nlp_subject?: string; chapter?: string; scope?: 'mine' | 'org'; limit?: number; offset?: number }, { signal }: Sig = {}) {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null))
    return (await api.get<{ total: number; items: BankItem[]; media: Record<string, MediaInfo> }>(`${B}/bank`, { params: clean, signal })).data
  },
  async deleteBankItem(bankId: string): Promise<void> {
    await api.delete(`${B}/bank/${bankId}`)
  },
  async addFromBank(id: string, bankIds: string[], sectionId?: string | null): Promise<Paper & { added: number; skipped_duplicates: number }> {
    return (await api.post(`${B}/papers/${id}/items/from-bank`, { bank_ids: bankIds, section_id: sectionId ?? null })).data
  },

  // ---------------------------------------------------------------- media
  async upload(file: File): Promise<{ media_id: string; url: string; width: number; height: number }> {
    const fd = new FormData()
    fd.append('file', file)
    return (await api.post(`${B}/media`, fd, { timeout: 60_000 })).data
  },
  async mediaUrl(mediaId: string): Promise<MediaInfo> {
    return (await api.get<MediaInfo>(`${B}/media/${mediaId}`)).data
  },

  // ---------------------------------------------------------------- admin
  async adminMappings(orgCode?: string): Promise<MappingsResponse> {
    return (await api.get<MappingsResponse>(`${B}/admin/mappings`, { params: orgCode ? { org_code: orgCode } : {} })).data
  },
  async adminSetMapping(classCode: string, subjectCode: string, body: { nlp_class: string; nlp_subject: string }, orgCode?: string): Promise<MappingsResponse> {
    return (await api.put<MappingsResponse>(`${B}/admin/mappings/${encodeURIComponent(classCode)}/${encodeURIComponent(subjectCode)}`, body,
      { params: orgCode ? { org_code: orgCode } : {} })).data
  },
  async adminClearMapping(classCode: string, subjectCode: string, orgCode?: string): Promise<MappingsResponse> {
    return (await api.delete<MappingsResponse>(`${B}/admin/mappings/${encodeURIComponent(classCode)}/${encodeURIComponent(subjectCode)}`,
      { params: orgCode ? { org_code: orgCode } : {} })).data
  },
  async adminSettings(orgCode?: string): Promise<QgenSettings> {
    return (await api.get<QgenSettings>(`${B}/admin/settings`, { params: orgCode ? { org_code: orgCode } : {} })).data
  },
  async adminSaveSettings(body: { ar_instruction: string; ar_codes: string[] }, orgCode?: string): Promise<QgenSettings> {
    return (await api.put<QgenSettings>(`${B}/admin/settings`, body, { params: orgCode ? { org_code: orgCode } : {} })).data
  },
  async adminResetSettings(orgCode?: string): Promise<QgenSettings> {
    return (await api.delete<QgenSettings>(`${B}/admin/settings`, { params: orgCode ? { org_code: orgCode } : {} })).data
  },
}

/** Save a Blob as a file (PDF / Word downloads). */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
