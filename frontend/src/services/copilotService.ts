import axios from 'axios'
import { api, tokenStore } from './apiClient'

const B = '/ICMELive/api/v1/copilot'

export interface CopilotStreamHandlers {
  onToken?: (t: string) => void
  onDone?: () => void
  onError?: (msg: string) => void
  /** 2–4 follow-up questions, sent after `done`. */
  onSuggestions?: (items: string[]) => void
}

/** Whether Copilot answers with a live AI provider or offline demo answers (no key material, ever). */
export interface CopilotStatus { mode: 'mock' | 'azure' | 'openai'; ai_ready: boolean; voice_transcription: boolean }

function dispatch(raw: string, h: CopilotStreamHandlers) {
  const ev = /^event: (.+)$/m.exec(raw)?.[1]
  const dataLine = /^data: (.+)$/m.exec(raw)?.[1]
  if (!ev) return
  const data = dataLine ? JSON.parse(dataLine) : {}
  if (ev === 'token') h.onToken?.(data.text)
  else if (ev === 'done') h.onDone?.()
  else if (ev === 'error') h.onError?.(data.message)
  else if (ev === 'suggestions' && Array.isArray(data.items)) h.onSuggestions?.(data.items.filter((s: unknown) => typeof s === 'string'))
}

/** POST /copilot/query and consume the SSE stream (token* -> done -> suggestions). Answers only from the
 * server's privacy-scoped snapshot — see CopilotDrawer.tsx for the contract shown to the user. */
export async function streamCopilotQuery(
  body: { query: string; org_code?: string | null },
  h: CopilotStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${B}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenStore.access ?? ''}` },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  })
  if (!res.ok || !res.body) {
    let msg = `Request failed (${res.status})`
    try { const j = await res.json(); if (typeof j.detail === 'string') msg = j.detail } catch { /* ignore */ }
    h.onError?.(msg)
    return
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n\n')) >= 0) {
      dispatch(buf.slice(0, i), h)
      buf = buf.slice(i + 2)
    }
  }
  if (buf.trim()) dispatch(buf, h)
}

export const copilotService = {
  async status(): Promise<CopilotStatus> {
    return (await api.get<CopilotStatus>(`${B}/status`)).data
  },

  /** Speech-to-text for a recorded voice message (when the browser has no speech recognition of its own). */
  async transcribe(audio: Blob): Promise<string> {
    try {
      const type = (audio.type || 'audio/webm').split(';')[0]
      return (await api.post<{ text: string }>(`${B}/transcribe`, audio, { headers: { 'Content-Type': type } })).data.text
    } catch (e) {
      const status = axios.isAxiosError(e) ? e.response?.status : undefined
      const detail = axios.isAxiosError(e) ? (e.response?.data as { detail?: unknown } | undefined)?.detail : undefined
      if (status === 501) throw new Error('Voice messages need the AI key — offline demo mode. Please type your question.')
      if (status === 429) throw new Error('Too many voice messages — please wait a moment and try again.')
      if (status === 413) throw new Error('That voice message is too long — please keep it under a minute.')
      throw new Error(typeof detail === 'string' ? detail : "Couldn't transcribe that voice message — please try again.")
    }
  },
}
