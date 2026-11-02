import { dispatch } from './ragAvatarService'
import { tokenStore } from './apiClient'

export interface CopilotStreamHandlers {
  onToken?: (t: string) => void
  onDone?: () => void
  onError?: (msg: string) => void
}

/** POST /copilot/query and consume the SSE stream (token* -> done). Answers only from aggregated,
 * anonymised institution views — see CopilotDrawer.tsx for the privacy contract shown to the user. */
export async function streamCopilotQuery(
  body: { query: string; org_code?: string | null },
  h: CopilotStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/ICMELive/api/v1/copilot/query', {
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
