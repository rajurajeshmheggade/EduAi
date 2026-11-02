import axios from 'axios'
import { api } from './apiClient'

const B = '/ICMELive/api/v1/read-aloud/textbooks'

export type AvatarVoice = 'male' | 'female'
/** explain = the AI teacher explains the page (default); read = the page is read word for word. */
export type ReadMode = 'explain' | 'read'

export interface ReadAloudVoice {
  teacher: { name: string; gender: string | null } | null
  voice: AvatarVoice
  engine: string
}

export interface ReadAloudSegment {
  index: number
  text: string
  /** Exact words on the page this part explains (highlighted in the PDF). */
  quote?: string | null
  /** Index of the lesson key point this part belongs to. */
  point?: number | null
}

export interface PageLesson {
  title: string
  intro: string
  key_points: { heading: string; explanation: string; quote: string }[]
  terms: { term: string; meaning: string }[]
  recap: string
  question: string
}

export interface ReadAloudPage {
  page: number
  total_pages: number
  mode: ReadMode
  segments: ReadAloudSegment[]
  lesson: PageLesson | null
  engine: string
  /** Version of this script: audio parts are requested for it, so a lesson replaced meanwhile never mixes parts. */
  version?: string | null
  /** The AI was unavailable: this is the offline lesson, replaced by the AI's once it answers again. */
  fallback?: boolean
}

/** Server-side preparation of a page (script + first spoken part) in the reader's background pipeline. */
export type Readiness = 'ready' | 'preparing' | 'queued' | 'failed' | 'idle'

export interface PageReadiness {
  page: number
  status: Readiness
  script: Readiness
  audio: Readiness
  engine: string | null
  fallback: boolean
}

export interface PipelineStatus {
  page: number
  mode: ReadMode
  pages: PageReadiness[]
}

export interface RequestOpts {
  signal?: AbortSignal
}

export const readAloudService = {
  async voice(textbookId: string): Promise<ReadAloudVoice> {
    return (await api.get<ReadAloudVoice>(`${B}/${textbookId}/voice`)).data
  },

  /** `prefetch`: fetched ahead of the reader (doesn't move their background pipeline to this page). */
  async page(textbookId: string, page: number, mode: ReadMode = 'explain', { signal, prefetch }: RequestOpts & { prefetch?: boolean } = {}): Promise<ReadAloudPage> {
    return (await api.get<ReadAloudPage>(`${B}/${textbookId}/pages/${page}`, { params: { mode, ...(prefetch ? { prefetch } : {}) }, signal })).data
  },

  /** The reader opened `page`: the server prepares it and the next pages in the background (queued work for pages
   * they left is cancelled). Returns how ready each one is. */
  async prepare(textbookId: string, page: number, mode: ReadMode = 'explain', { signal }: RequestOpts = {}): Promise<PipelineStatus> {
    return (await api.post<PipelineStatus>(`${B}/${textbookId}/pages/${page}/prepare`, null, { params: { mode }, signal })).data
  },

  /** Cheap readiness of `page` and the next ones (no AI call). */
  async status(textbookId: string, page: number, mode: ReadMode = 'explain', { signal }: RequestOpts = {}): Promise<PipelineStatus> {
    return (await api.get<PipelineStatus>(`${B}/${textbookId}/pages/${page}/status`, { params: { mode }, signal })).data
  },

  /** Audio of one part, voiced by the subject teacher's avatar voice (chosen by the server). */
  async audio(textbookId: string, page: number, index: number, mode: ReadMode = 'explain',
    { signal, version }: RequestOpts & { version?: string | null } = {}): Promise<Blob> {
    try {
      return (await api.get<Blob>(`${B}/${textbookId}/pages/${page}/segments/${index}/audio`, {
        params: { mode, ...(version ? { v: version } : {}) }, responseType: 'blob', signal })).data
    } catch (e) {
      // Error bodies arrive as a Blob too: surface the server's message (e.g. "This page is not in English…").
      // 409 = the page's lesson was replaced since this version was fetched: the reader reloads the page.
      if (axios.isAxiosError(e) && e.response?.data instanceof Blob) {
        const detail = await e.response.data.text().then((t) => (JSON.parse(t) as { detail?: string }).detail).catch(() => undefined)
        if (detail) throw Object.assign(new Error(detail), { status: e.response.status })
      }
      throw e
    }
  },
}
