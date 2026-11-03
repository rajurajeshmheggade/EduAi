import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProctorMedia } from '../media'
import { clientRules } from '@/test/proctoring'
import type { StudentStatus, WireEvent } from '@/services/proctoringService'
import { trackListeners } from '@/test/fakeMedia'
import { scalars, sessionOver, StudentProctorMonitor } from './monitor'

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

const LIGHT = { mean: 110, std: 35 }
const frame = (faces: number, extra: Partial<{ luma: { mean: number; std: number }; objects: { label: string; score: number }[] }> = {}) =>
  ({ faces, pose: null, luma: LIGHT, objects: [], ...extra })
const ok: StudentStatus = { status: 'ACTIVE', ended: false, end_reason: null, server_time: '', warnings: [] }

function fakeMedia(): ProctorMedia {
  return {
    camera: {}, mic: null, floorDb: -100, cameraLive: () => true, micLive: () => false, micDb: () => null, analyse: async () => null,
    startCamera: vi.fn(async () => ({})), startMic: vi.fn(async () => {}),
  } as unknown as ProctorMedia
}

function setup(over: Partial<ConstructorParameters<typeof StudentProctorMonitor>[0]> = {}) {
  const sent: WireEvent[][] = []
  const send = vi.fn(async (events: WireEvent[]) => { sent.push(events); return { ...ok, accepted: events.map((e) => e.seq) } })
  const heartbeat = vi.fn(async () => ok)
  const onStatus = vi.fn()
  const onFlag = vi.fn()
  const m = new StudentProctorMonitor({ media: fakeMedia(), rules: clientRules(), lastSeq: 7, send, heartbeat, onStatus, onFlag, ...over })
  return { m, sent, send, heartbeat, onStatus, onFlag }
}

describe('StudentProctorMonitor', () => {
  beforeEach(() => { vi.spyOn(document, 'hasFocus').mockReturnValue(true) })
  afterEach(() => { vi.restoreAllMocks() })

  it('turns held conditions into flags with the configured durations, continuing the server sequence', async () => {
    const { m, sent, onFlag } = setup()
    m.process(frame(2), 0)
    m.process(frame(2), 2000)
    expect(sent).toEqual([])                                           // 2 s < 3 s: not yet
    m.process(frame(2), 3200)
    await m.flush()
    expect(sent.flat().map((e) => [e.seq, e.code])).toEqual([[8, 'MULTIPLE_FACES']])
    expect(sent[0][0].details).toEqual({ faces: 2, persons: 0 })
    expect(onFlag).toHaveBeenCalledWith(expect.objectContaining({ code: 'MULTIPLE_FACES', label: 'More than one person in view' }))

    m.process(frame(0), 10_000)
    m.process(frame(0), 14_000)
    m.process(frame(1), 19_000)                                        // 9 s without a face, reported when it ends
    await m.flush()
    expect(sent.flat().at(-1)).toMatchObject({ seq: 9, code: 'NO_FACE', duration_ms: 9000 })
  })

  it('does not flag a short glitch or a dark frame as "no face"', async () => {
    const { m, sent } = setup()
    m.process(frame(0), 0)
    m.process(frame(1), 4000)                                          // 4 s < 8 s
    m.process(frame(0, { luma: { mean: 5, std: 1 } }), 5000)
    m.process(frame(0, { luma: { mean: 5, std: 1 } }), 10_500)
    await m.flush()
    expect(sent.flat().map((e) => e.code)).toEqual(['CAMERA_BLOCKED'])
  })

  it('hands teacher warnings and the end instruction to the page', async () => {
    const warning = { action_id: 'w1', message: 'Face the camera', created_at: '' }
    const { m, onStatus } = setup({ heartbeat: vi.fn(async () => ({ ...ok, warnings: [warning] })) })
    m.start()
    await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ warnings: [warning] })))
    m.stop()
  })

  it('a sanctioned trip to the lab simulation is not a tab switch', async () => {
    const { m, sent } = setup()
    m.start()
    m.allowAway('simulation')
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    vis.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(m.isAway()).toBe(false)                                    // back on the exam page: the window is over
    vis.mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise((r) => setTimeout(r, 1100))
    vis.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await m.flush()
    expect(sent.flat().map((e) => e.code)).toEqual(['SANCTIONED_AWAY', 'TAB_HIDDEN'])
    m.stop()
  })

  it('keeps unsent events and retries after a network error, dropping a rejected (422) batch', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce({ response: { status: 422 } })
      .mockResolvedValue({ ...ok, accepted: [] })
    const { m } = setup({ send })
    m.emit({ code: 'COPY_PASTE', at: 0, duration_ms: 0 })
    await m.flush()
    expect(m.pending).toBe(1)
    await m.flush()
    expect(m.pending).toBe(0)
  })

  it('stop() clears every timer and listener, sends what is left, and nothing restarts it', async () => {
    vi.useFakeTimers()
    try {
      const md = new EventTarget()
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: md })
      const listeners = trackListeners([document, window, md])
      const beat = deferred<StudentStatus>()
      const heartbeat = vi.fn(() => beat.promise)
      const { m, send, onStatus } = setup({ heartbeat })
      m.start()
      expect(vi.getTimerCount()).toBeGreaterThanOrEqual(4)             // vision, checks, flush, heartbeat
      const types = ['visibilitychange', 'fullscreenchange', 'copy', 'cut', 'paste', 'offline', 'online', 'pagehide', 'devicechange']
      expect(listeners.active(types)).toHaveLength(types.length)
      m.emit({ code: 'COPY_PASTE', at: 0, duration_ms: 0 })

      m.stop()
      m.stop()
      expect(vi.getTimerCount()).toBe(0)                                // every interval cleared
      expect(listeners.active(types)).toEqual([])                       // every listener gone
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))     // the queued flag still goes out
      document.dispatchEvent(new Event('copy'))
      md.dispatchEvent(new Event('devicechange'))
      m.emit({ code: 'COPY_PASTE', at: 1, duration_ms: 0 })
      m.start()                                                         // a stopped monitor stays stopped
      await m.restartCamera('cam-b')
      expect(vi.getTimerCount()).toBe(0)
      expect(m.pending).toBe(0)

      // settle() waits for the heartbeat already on its way (the session is closed after it), whose reply is dropped
      let settled = false
      void m.settle().then(() => { settled = true })
      await Promise.resolve()
      expect(settled).toBe(false)
      beat.resolve({ ...ok, status: 'ENDED_BY_TEACHER', ended: true })
      await vi.waitFor(() => expect(settled).toBe(true))
      expect(heartbeat).toHaveBeenCalled()
      expect(onStatus.mock.calls.map(([st]) => st.status)).toEqual(['ACTIVE'])   // the final flush's reply; the late beat is dropped
      listeners.restore()
    } finally {
      vi.useRealTimers()
      delete (navigator as unknown as Record<string, unknown>).mediaDevices
    }
  })

  it('knows when the server says the session is over (handed in, closed or ended by a teacher)', () => {
    expect(sessionOver({ status: 'ACTIVE', ended: false })).toBe(false)
    expect(sessionOver({ status: 'INTERRUPTED', ended: false })).toBe(false)
    for (const status of ['SUBMITTED', 'CLOSED', 'ENDED_BY_TEACHER'] as const) expect(sessionOver({ status, ended: false })).toBe(true)
    expect(sessionOver({ status: 'ACTIVE', ended: true })).toBe(true)
  })

  it('sends only small scalar details', () => {
    expect(scalars({ faces: 2, ok: true, none: null, nested: { a: 1 }, big: 'x'.repeat(200), nan: Number.NaN })).toEqual({ faces: 2, ok: true, none: null, big: 'x'.repeat(80) })
    expect(scalars({ nested: { a: 1 } })).toBeUndefined()
  })
})
