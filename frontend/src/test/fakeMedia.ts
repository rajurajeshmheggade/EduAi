import { expect, vi } from 'vitest'

/**
 * A fake camera / microphone / screen, detection worker, AudioContext and full screen for tests of the proctoring
 * teardown (jsdom has none of them). Every track's `stop` is a spy, so a test can check that each one was stopped
 * exactly once; `trackListeners` / `trackIntervals` record what the code under test registered and whether it let go.
 */
export class FakeTrack extends EventTarget {
  readyState: MediaStreamTrackState = 'live'
  muted = false
  enabled = true
  readonly kind: 'video' | 'audio'
  readonly label: string
  private readonly settings: Record<string, unknown>
  readonly stop = vi.fn(() => { this.readyState = 'ended' })
  constructor(kind: 'video' | 'audio', label: string, settings: Record<string, unknown>) {
    super()
    this.kind = kind
    this.label = label
    this.settings = settings
  }
  getSettings() { return this.settings }
}

export class FakeStream {
  private readonly tracks: FakeTrack[]
  constructor(tracks: FakeTrack[]) { this.tracks = tracks }
  getTracks() { return [...this.tracks] }
  getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video') }
  getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio') }
}

const DEVICES = [
  { deviceId: 'cam-a', kind: 'videoinput', label: 'Integrated Camera', groupId: '' },
  { deviceId: 'cam-b', kind: 'videoinput', label: 'USB Camera', groupId: '' },
  { deviceId: 'mic-a', kind: 'audioinput', label: 'Built-in Mic', groupId: '' },
]
const LABEL: Record<string, string> = Object.fromEntries(DEVICES.map((d) => [d.deviceId, d.label]))

export class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: { message: string }) => void) | null = null
  terminated = false
  readonly terminate = vi.fn(() => { this.terminated = true })
  constructor() { FakeWorker.instances.push(this) }
  postMessage(m: { type: string; id?: number; bitmap?: { close(): void } }) {
    const reply = (data: unknown) => setTimeout(() => { if (!this.terminated) this.onmessage?.({ data }) }, 0)
    if (m.type === 'init') reply({ type: 'ready', backend: 'cpu' })
    else if (m.type === 'frame') {
      reply({ type: 'result', id: m.id, faces: 1, pose: { yaw: 0, pitch: 0, roll: 0 }, box: { x: 0.35, y: 0.25, w: 0.3, h: 0.4 }, centred: true,
        luma: { mean: 120, std: 40 }, objects: [], embedding: null, ms: 4 })
    }
  }
}

export class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  state: AudioContextState = 'running'
  sampleRate = 48_000
  readonly close = vi.fn(async () => { this.state = 'closed' })
  constructor() { FakeAudioContext.instances.push(this) }
  resume = async () => {}
  createAnalyser() { return { fftSize: 2048, frequencyBinCount: 1024, getFloatFrequencyData: (b: Float32Array) => b.fill(-80) } }
  createMediaStreamSource() { return { connect: () => {} } }
}

export interface MediaEnv {
  /** Every track any getUserMedia / getDisplayMedia call handed out. */
  tracks: FakeTrack[]
  workers: FakeWorker[]
  audioContexts: FakeAudioContext[]
  getUserMedia: ReturnType<typeof vi.fn>
  getDisplayMedia: ReturnType<typeof vi.fn>
  /** The next getUserMedia call (for that kind of device, if given) waits — an open permission prompt — until `release()`. */
  holdNext(kind?: 'video' | 'audio'): { release(): void }
  /** Tracks still running (the camera light would be on). */
  live(): FakeTrack[]
  exitFullscreen: ReturnType<typeof vi.fn>
  enterFullscreen(): void
  restore(): void
}

export function installMediaEnv(opts: { screenSurface?: string } = {}): MediaEnv {
  FakeWorker.instances = []
  FakeAudioContext.instances = []
  const tracks: FakeTrack[] = []
  let held: { resolve: () => void } | null = null
  let holdNext: 'video' | 'audio' | 'any' | null = null
  const devices = new EventTarget() as EventTarget & Record<string, unknown>

  const getUserMedia = vi.fn(async (c: MediaStreamConstraints) => {
    if (holdNext && (holdNext === 'any' || c[holdNext])) {
      holdNext = null
      await new Promise<void>((resolve) => { held = { resolve } })
    }
    const out: FakeTrack[] = []
    if (c.video) {
      const id = ((c.video as MediaTrackConstraints).deviceId as { exact?: string } | undefined)?.exact ?? 'cam-a'
      out.push(new FakeTrack('video', LABEL[id] ?? id, { deviceId: id }))
    }
    if (c.audio) {
      const id = ((c.audio as MediaTrackConstraints).deviceId as { exact?: string } | undefined)?.exact ?? 'mic-a'
      out.push(new FakeTrack('audio', LABEL[id] ?? id, { deviceId: id }))
    }
    tracks.push(...out)
    return new FakeStream(out) as unknown as MediaStream
  })
  const getDisplayMedia = vi.fn(async () => {
    const t = new FakeTrack('video', 'screen:0', { displaySurface: opts.screenSurface ?? 'monitor' })
    tracks.push(t)
    return new FakeStream([t]) as unknown as MediaStream
  })
  Object.assign(devices, { getUserMedia, getDisplayMedia, enumerateDevices: vi.fn(async () => DEVICES) })

  const saved = {
    mediaDevices: Object.getOwnPropertyDescriptor(navigator, 'mediaDevices'),
    secure: Object.getOwnPropertyDescriptor(window, 'isSecureContext'),
    videoWidth: Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'videoWidth'),
    videoHeight: Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'videoHeight'),
  }
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: devices })
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 })
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => {})
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('createImageBitmap', async () => ({ width: 640, height: 480, close: () => {} }))
  // jsdom has no canvas: a 2D context that reads back a well-lit grey frame
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({
    drawImage: () => {}, getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(120) }),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext)
  const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback) => cb(new Blob(['jpeg'], { type: 'image/jpeg' })))

  let fsEl: Element | null = null
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fsEl })
  const exitFullscreen = vi.fn(async () => { fsEl = null; document.dispatchEvent(new Event('fullscreenchange')) })
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen })
  Object.defineProperty(document.documentElement, 'requestFullscreen', {
    configurable: true, value: vi.fn(async () => { fsEl = document.documentElement; document.dispatchEvent(new Event('fullscreenchange')) }),
  })

  return {
    tracks, workers: FakeWorker.instances, audioContexts: FakeAudioContext.instances, getUserMedia, getDisplayMedia, exitFullscreen,
    holdNext(kind) {
      holdNext = kind ?? 'any'
      return { release: () => { held?.resolve(); held = null } }
    },
    live: () => tracks.filter((t) => t.readyState === 'live'),
    enterFullscreen: () => { fsEl = document.documentElement },
    restore() {
      for (const [target, key, d] of [[navigator, 'mediaDevices', saved.mediaDevices], [window, 'isSecureContext', saved.secure],
        [HTMLVideoElement.prototype, 'videoWidth', saved.videoWidth], [HTMLVideoElement.prototype, 'videoHeight', saved.videoHeight]] as const) {
        if (d) Object.defineProperty(target, key, d)
        else delete (target as unknown as Record<string, unknown>)[key]
      }
      delete (document as unknown as Record<string, unknown>).fullscreenElement
      delete (document as unknown as Record<string, unknown>).exitFullscreen
      delete (document.documentElement as unknown as Record<string, unknown>).requestFullscreen
      play.mockRestore()
      getContext.mockRestore()
      toBlob.mockRestore()
      vi.unstubAllGlobals()
    },
  }
}

/** Listeners the code under test registers on `targets`, and which of them are still attached (not removed / aborted). */
export function trackListeners(targets: EventTarget[]) {
  interface Reg { target: EventTarget; type: string; listener: unknown; capture: boolean; signal?: AbortSignal; removed: boolean }
  const regs: Reg[] = []
  const spies = targets.map((target) => {
    const add = target.addEventListener.bind(target)
    const remove = target.removeEventListener.bind(target)
    const a = vi.spyOn(target, 'addEventListener').mockImplementation((type, listener, o) => {
      regs.push({ target, type, listener, capture: typeof o === 'boolean' ? o : !!o?.capture, signal: typeof o === 'object' ? o.signal : undefined, removed: false })
      add(type, listener, o)
    })
    const r = vi.spyOn(target, 'removeEventListener').mockImplementation((type, listener, o) => {
      const capture = typeof o === 'boolean' ? o : !!o?.capture
      for (const x of regs) if (x.target === target && x.type === type && x.listener === listener && x.capture === capture) x.removed = true
      remove(type, listener, o)
    })
    return [a, r]
  })
  return {
    active: (types: string[]) => regs.filter((x) => !x.removed && !x.signal?.aborted && types.includes(x.type)).map((x) => x.type),
    restore: () => spies.flat().forEach((s) => s.mockRestore()),
  }
}

/** setInterval timers the code under test started and has not cleared yet. */
export function trackIntervals() {
  const open = new Map<unknown, string>()
  const realSet = globalThis.setInterval
  const realClear = globalThis.clearInterval
  const set = vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: () => void, ms?: number) => {
    const id = realSet(fn, ms)
    open.set(id, new Error().stack ?? '')
    return id
  }) as typeof setInterval)
  const clear = vi.spyOn(globalThis, 'clearInterval').mockImplementation(((id?: ReturnType<typeof setInterval>) => {
    open.delete(id)
    realClear(id)
  }) as typeof clearInterval)
  return {
    get open() { return open.size },
    /** Where each interval still running was started (for a failing test's message). */
    get where() { return [...open.values()] },
    restore: () => { set.mockRestore(); clear.mockRestore() },
  }
}

/** The camera light is off: every track handed out was stopped exactly once, the worker and audio are closed. */
export function expectAllOff(env: MediaEnv) {
  expect(env.tracks.length).toBeGreaterThan(0)
  expect(env.live()).toEqual([])
  expect(env.tracks.map((t) => t.stop.mock.calls.length)).toEqual(env.tracks.map(() => 1))
  expect(env.workers.map((w) => w.terminate.mock.calls.length)).toEqual(env.workers.map(() => 1))
  expect(env.audioContexts.map((c) => c.close.mock.calls.length)).toEqual(env.audioContexts.map(() => 1))
}
