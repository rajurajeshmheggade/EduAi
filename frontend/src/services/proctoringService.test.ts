import { describe, expect, it } from 'vitest'
import { parseSse } from './proctoringService'

describe('live stream parsing', () => {
  it('splits complete frames, keeps the unfinished tail and ignores keep-alive comments', () => {
    const buf = 'event: hello\ndata: {"lifetime_s": 300}\n\n: keep-alive\n\nevent: event\ndata: {"session_id": "s1", "event": {"code": "NO_FACE"}}\n\nevent: sess'
    const { frames, rest } = parseSse(buf)
    expect(frames).toEqual([{ event: 'hello', data: { lifetime_s: 300 } }, { event: 'event', data: { session_id: 's1', event: { code: 'NO_FACE' } } }])
    expect(rest).toBe('event: sess')
    expect(parseSse(rest + 'ion\ndata: {"status": "ACTIVE"}\n\n').frames).toEqual([{ event: 'session', data: { status: 'ACTIVE' } }])
  })

  it('handles CRLF line endings and skips malformed data', () => {
    expect(parseSse('event: bye\r\ndata: {"reconnect": true}\r\n\r\nevent: x\ndata: {oops\n\n').frames).toEqual([{ event: 'bye', data: { reconnect: true } }])
  })
})
