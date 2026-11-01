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
}

export const readAloudService = {
  async voice(textbookId: string): Promise<ReadAloudVoice> {
    return (await api.get<ReadAloudVoice>(`${B}/${textbookId}/voice`)).data
  },

  async page(textbookId: string, page: number, mode: ReadMode = 'explain'): Promise<ReadAloudPage> {
    return (await api.get<ReadAloudPage>(`${B}/${textbookId}/pages/${page}`, { params: { mode } })).data
  },

  /** Audio of one part, voiced by the subject teacher's avatar voice (chosen by the server). */
  async audio(textbookId: string, page: number, index: number, mode: ReadMode = 'explain'): Promise<Blob> {
    try {
      return (await api.get<Blob>(`${B}/${textbookId}/pages/${page}/segments/${index}/audio`, { params: { mode }, responseType: 'blob' })).data
    } catch (e) {
      // Error bodies arrive as a Blob too: surface the server's message (e.g. "This page is not in English…").
      if (axios.isAxiosError(e) && e.response?.data instanceof Blob) {
        const detail = await e.response.data.text().then((t) => (JSON.parse(t) as { detail?: string }).detail).catch(() => undefined)
        if (detail) throw new Error(detail)
      }
      throw e
    }
  },
}
