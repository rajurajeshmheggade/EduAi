import { tokenStore } from './apiClient'
import type { Citation } from '@/types'

export interface RagStreamHandlers {
  onMeta?: (m: { session_id: string; citations: Citation[]; k: number }) => void
  onToken?: (t: string) => void
  onDone?: () => void
  onError?: (msg: string) => void
}

/** POST /rag/query and consume the SSE stream (meta -> token* -> done). */
export async function streamRagQuery(
  body: { query: string; subject_code: string; textbook_id?: string; current_page?: number; session_id?: string },
  h: RagStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/ICMELive/api/v1/rag/query', {
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

export function dispatch(raw: string, h: RagStreamHandlers) {
  const ev = /^event: (.+)$/m.exec(raw)?.[1]
  const dataLine = /^data: (.+)$/m.exec(raw)?.[1]
  if (!ev) return
  const data = dataLine ? JSON.parse(dataLine) : {}
  if (ev === 'meta') h.onMeta?.(data)
  else if (ev === 'token') h.onToken?.(data.text)
  else if (ev === 'done') h.onDone?.()
  else if (ev === 'error') h.onError?.(data.message)
}

export async function transcribe(blob: Blob): Promise<string> {
  const fd = new FormData()
  fd.append('audio', blob, 'question.webm')
  const res = await fetch('/ICMELive/transcribe-audio', {
    method: 'POST', headers: { Authorization: `Bearer ${tokenStore.access ?? ''}` }, body: fd,
  })
  const j = await res.json()
  if (!res.ok) throw new Error(typeof j.detail === 'string' ? j.detail : 'Transcription failed')
  return j.text as string
}
