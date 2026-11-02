/**
 * Camera, microphone and entire-screen capture for the exam, plus the client of the ML worker. Nothing is recorded:
 * frames go to the on-device worker; JPEG snapshots are taken only for flags (and a sparse presence snapshot); the
 * microphone is used for loudness only.
 */
import { median, speechBandDb } from './rules'
import type { FrameResult, WorkerIn, WorkerOut } from './proctor.worker'

export const MODELS_BASE = '/models/proctor'

export class ScreenSurfaceError extends Error {
  readonly surface: string | undefined
  constructor(surface: string | undefined) {
    super(surface === 'browser' ? 'You shared a browser tab. Share your ENTIRE screen.' : surface === 'window'
      ? 'You shared one window. Share your ENTIRE screen.' : 'Share your entire screen to continue.')
    this.surface = surface
  }
}

function hiddenVideo(): HTMLVideoElement {
  const v = document.createElement('video')
  v.muted = true
  v.playsInline = true
  v.autoplay = true
  return v
}

export class ProctorMedia {
  camera: MediaStream | null = null
  mic: MediaStream | null = null
  screen: MediaStream | null = null
  readonly camVideo = hiddenVideo()
  readonly screenVideo = hiddenVideo()
  cameraLabel: string | null = null
  micLabel: string | null = null
  screenSurface: string | null = null
  floorDb = -100
  backend = 'none'
  modelsReady = false
  private audio: { ctx: AudioContext; analyser: AnalyserNode; buf: Float32Array<ArrayBuffer> } | null = null
  private worker: Worker | null = null
  private waiting = new Map<number, (r: FrameResult | null) => void>()
  private nextId = 1
  private busy = false

  // ---------------------------------------------------------------- devices
  /** `deviceId` picks a specific camera (student device picker); without it the current / default camera is used. */
  async startCamera(deviceId?: string): Promise<MediaStream> {
    const live = this.camera?.getVideoTracks()[0]
    if (live?.readyState === 'live' && (!deviceId || live.getSettings?.().deviceId === deviceId)) return this.camera!
    this.camera?.getTracks().forEach((t) => t.stop())
    this.camera = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 },
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}) }, audio: false })
    this.cameraLabel = this.camera.getVideoTracks()[0]?.label ?? null
    this.camVideo.srcObject = this.camera
    await this.camVideo.play().catch(() => {})
    await waitFor(() => this.camVideo.videoWidth > 0, 5000)
    return this.camera
  }

  async startMic(deviceId?: string): Promise<void> {
    const live = this.mic?.getAudioTracks()[0]
    if (live?.readyState === 'live' && (!deviceId || live.getSettings?.().deviceId === deviceId)) return
    this.mic?.getTracks().forEach((t) => t.stop())
    void this.audio?.ctx.close().catch(() => {})
    this.audio = null
    this.mic = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true, video: false })
    this.micLabel = this.mic.getAudioTracks()[0]?.label ?? null
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    ctx.createMediaStreamSource(this.mic).connect(analyser)
    this.audio = { ctx, analyser, buf: new Float32Array(analyser.frequencyBinCount) }
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
  }

  /** Speech-band level (dB) right now. */
  micDb(): number | null {
    if (!this.audio) return null
    this.audio.analyser.getFloatFrequencyData(this.audio.buf)
    return speechBandDb(this.audio.buf, this.audio.ctx.sampleRate, this.audio.analyser.fftSize)
  }

  /** Noise floor = median speech-band level over `ms` of (hopefully) quiet room. */
  async calibrateMic(ms = 5000, onProgress?: (f: number) => void): Promise<number> {
    const xs: number[] = []
    const end = performance.now() + ms
    while (performance.now() < end) {
      const v = this.micDb()
      if (v !== null && Number.isFinite(v)) xs.push(v)
      onProgress?.(1 - (end - performance.now()) / ms)
      await sleep(100)
    }
    this.floorDb = median(xs)
    return this.floorDb
  }

  /** Entire screen only: tabs and windows are refused. */
  async startScreen(): Promise<MediaStream> {
    this.screen?.getTracks().forEach((t) => t.stop())
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'monitor' }, audio: false,
      // Chromium hints: offer whole monitors, hide this tab, no switching surfaces mid-share.
      ...({ monitorTypeSurfaces: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'exclude', preferCurrentTab: false } as object),
    } as DisplayMediaStreamOptions)
    const track = stream.getVideoTracks()[0]
    const surface = (track?.getSettings() as (MediaTrackSettings & { displaySurface?: string }) | undefined)?.displaySurface
    if (surface !== 'monitor') {
      stream.getTracks().forEach((t) => t.stop())
      throw new ScreenSurfaceError(surface)
    }
    this.screen = stream
    this.screenSurface = surface
    this.screenVideo.srcObject = stream
    await this.screenVideo.play().catch(() => {})
    return stream
  }

  cameraLive = () => { const t = this.camera?.getVideoTracks()[0]; return t?.readyState === 'live' && !t.muted }
  screenLive = () => this.screen?.getVideoTracks()[0]?.readyState === 'live'
  micLive = () => this.mic?.getAudioTracks()[0]?.readyState === 'live'
  cameraDeviceId = () => this.camera?.getVideoTracks()[0]?.getSettings?.().deviceId ?? null
  micDeviceId = () => this.mic?.getAudioTracks()[0]?.getSettings?.().deviceId ?? null

  // ---------------------------------------------------------------- models
  loadModels(opts: { embed: boolean; objects: boolean }, timeoutMs = 90_000): Promise<string> {
    if (this.modelsReady) return Promise.resolve(this.backend)
    this.worker?.terminate()
    const w = new Worker(new URL('./proctor.worker.ts', import.meta.url), { type: 'module', name: 'proctor' })
    this.worker = w
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('The proctoring models took too long to load')), timeoutMs)
      w.onmessage = (e: MessageEvent<WorkerOut>) => {
        const m = e.data
        if (m.type === 'ready') { clearTimeout(t); this.modelsReady = true; this.backend = m.backend; w.onmessage = (ev) => this.onResult(ev.data); resolve(m.backend) }
        else if (m.type === 'error') { clearTimeout(t); reject(new Error(m.message)) }
      }
      w.onerror = (e) => { clearTimeout(t); reject(new Error(e.message || 'The proctoring worker failed to start')) }
      w.postMessage({ type: 'init', base: new URL(MODELS_BASE, location.origin).href, ...opts } satisfies WorkerIn)
    })
  }

  private onResult(m: WorkerOut) {
    if (m.type !== 'result') {
      // a frame failed: release whoever waits on the oldest frame
      const first = [...this.waiting.keys()][0]
      if (first !== undefined) { this.waiting.get(first)?.(null); this.waiting.delete(first) }
      this.busy = false
      return
    }
    this.waiting.get(m.id)?.(m)
    this.waiting.delete(m.id)
    this.busy = false
  }

  /** One frame through the models. Returns null while the worker is still busy (frames are skipped, not queued). */
  async analyse(opts: { objects?: boolean; embed?: boolean; source?: CanvasImageSource } = {}): Promise<FrameResult | null> {
    if (!this.worker || !this.modelsReady || this.busy) return null
    const src = opts.source ?? this.camVideo
    if (src === this.camVideo && !this.camVideo.videoWidth) return null
    this.busy = true
    let bitmap: ImageBitmap
    try { bitmap = await createImageBitmap(src as ImageBitmapSource) } catch { this.busy = false; return null }
    const id = this.nextId++
    return new Promise((resolve) => {
      this.waiting.set(id, resolve)
      setTimeout(() => { if (this.waiting.has(id)) { this.waiting.delete(id); this.busy = false; resolve(null) } }, 10_000)
      this.worker!.postMessage({ type: 'frame', id, ts: performance.now(), bitmap, objects: !!opts.objects, embed: !!opts.embed } satisfies WorkerIn, [bitmap])
    })
  }

  // ---------------------------------------------------------------- snapshots
  async jpeg(video: HTMLVideoElement, width: number, quality: number, maxBytes = 200 * 1024): Promise<Blob | null> {
    if (!video.videoWidth) return null
    const h = Math.round((video.videoHeight / video.videoWidth) * width)
    const c = document.createElement('canvas')
    c.width = width
    c.height = h
    c.getContext('2d')!.drawImage(video, 0, 0, width, h)
    for (let q = quality; q >= 0.3; q -= 0.15) {
      const b = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', q))
      if (b && b.size <= maxBytes) return b
    }
    return null
  }

  webcamJpeg = () => this.jpeg(this.camVideo, 320, 0.6)
  screenJpeg = () => (this.screenLive() ? this.jpeg(this.screenVideo, 640, 0.6) : Promise.resolve(null))

  /** Sharpness of the current camera frame (variance of a simple gradient on a small greyscale copy). */
  sharpness(): number {
    const c = document.createElement('canvas')
    c.width = 160
    c.height = 120
    const g = c.getContext('2d', { willReadFrequently: true })!
    g.drawImage(this.camVideo, 0, 0, 160, 120)
    const d = g.getImageData(0, 0, 160, 120).data
    const lum = (i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    let sum = 0
    let sq = 0
    let n = 0
    for (let y = 1; y < 119; y++) {
      for (let x = 1; x < 159; x++) {
        const i = (y * 160 + x) * 4
        const v = 4 * lum(i) - lum(i - 4) - lum(i + 4) - lum(i - 640) - lum(i + 640)
        sum += v
        sq += v * v
        n++
      }
    }
    return sq / n - (sum / n) ** 2
  }

  stop() {
    for (const s of [this.camera, this.mic, this.screen]) s?.getTracks().forEach((t) => t.stop())
    this.camera = this.mic = this.screen = null
    void this.audio?.ctx.close().catch(() => {})
    this.audio = null
    this.worker?.terminate()
    this.worker = null
    this.modelsReady = false
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitFor(cond: () => boolean, ms: number) {
  const end = performance.now() + ms
  while (!cond() && performance.now() < end) await sleep(50)
}
