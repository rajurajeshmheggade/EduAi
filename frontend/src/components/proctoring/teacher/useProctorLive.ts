import { useEffect, useRef, useState } from 'react'
import { type LiveMessage, openProctorStream, type ProctorModule, StreamError } from '@/services/proctoringService'

export type LiveState = 'connecting' | 'live' | 'polling'

const RETRY_MS = [1000, 3000, 10_000, 30_000]
const POLL_MS = 10_000

/**
 * Live proctoring updates for the teacher's dashboards: Server-Sent Events read with fetch (the Authorization header
 * cannot go through EventSource). The server closes each stream before the token expires; the hook reconnects at once
 * after a clean close and with back-off after an error, calling `onPoll` every 10 s until the stream is back, so the
 * dashboard never goes stale. `onPoll` also runs on reconnect, which refreshes an expired token through the API client.
 */
export function useProctorLive(filter: { module?: ProctorModule; refId?: string }, onMessage: (m: LiveMessage) => void, onPoll: () => void): LiveState {
  const [state, setState] = useState<LiveState>('connecting')
  const cb = useRef({ onMessage, onPoll })
  useEffect(() => { cb.current = { onMessage, onPoll } }, [onMessage, onPoll])
  const { module, refId } = filter

  useEffect(() => {
    const ctl = new AbortController()
    let failures = 0
    let poll: ReturnType<typeof setInterval> | undefined
    const startPolling = () => { setState('polling'); poll ??= setInterval(() => cb.current.onPoll(), POLL_MS) }
    const stopPolling = () => { if (poll) clearInterval(poll); poll = undefined }

    async function loop() {
      while (!ctl.signal.aborted) {
        try {
          await openProctorStream({ module, refId }, (m) => {
            if (m.type === 'hello') { failures = 0; stopPolling(); setState('live'); return }
            cb.current.onMessage(m)
          }, ctl.signal)
          if (ctl.signal.aborted) return
          cb.current.onPoll()                     // catch up on anything missed between streams
        } catch (e) {
          if (ctl.signal.aborted) return
          startPolling()
          if (e instanceof StreamError && (e.status === 401 || e.status === 403)) cb.current.onPoll()   // refreshes the token
          await new Promise((r) => setTimeout(r, RETRY_MS[Math.min(failures, RETRY_MS.length - 1)]))
          failures += 1
        }
      }
    }
    void loop()
    return () => { ctl.abort(); stopPolling() }
  }, [module, refId])

  return state
}
