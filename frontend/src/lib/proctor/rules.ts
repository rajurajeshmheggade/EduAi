/**
 * Proctoring rules engine (pure, unit-tested): raw sensor samples -> flag events, using the durations, 2-of-3
 * confirmations and 2 s merging of spec §6.2. Sensors and transport live elsewhere; the server re-scores everything.
 */
export type FlagCode =
  | 'FULLSCREEN_EXIT' | 'TAB_HIDDEN' | 'WINDOW_BLUR' | 'MULTI_MONITOR' | 'SCREEN_SHARE_STOPPED' | 'CAMERA_LOST' | 'CAMERA_BLOCKED'
  | 'NO_FACE' | 'MULTIPLE_FACES' | 'FACE_MISMATCH' | 'LOOKING_AWAY' | 'PHONE_DETECTED' | 'BOOK_OR_PAPER' | 'EXTRA_DEVICE'
  | 'VOICE_DETECTED' | 'COPY_PASTE' | 'PASTE_BURST' | 'BLOCKED_SHORTCUT' | 'CONTEXT_MENU' | 'PRINT_ATTEMPT' | 'DEVTOOLS_SUSPECTED'
  | 'WINDOW_RESIZED' | 'EXTENSION_INJECTION' | 'NETWORK_OFFLINE' | 'SECOND_SESSION' | 'PORTAL_ACCESS_ATTEMPT' | 'PAGE_RELOAD'
  | 'PERF_DEGRADED'

export interface FlagEvent {
  code: FlagCode
  at: number            // client ms timestamp of the trigger
  duration_ms: number
  confidence?: number
  details?: Record<string, unknown>
}

/**
 * A condition that must hold for `durationMs` before it counts.
 * mode 'trigger': emits once when the hold reaches the duration (MULTIPLE_FACES, LOOKING_AWAY, …).
 * mode 'end': emits when the episode ends, with the full duration (TAB_HIDDEN, NO_FACE: points grow with time);
 *             episodes longer than `maxEpisodeMs` are emitted and restarted so long absences are not lost.
 */
export class HoldRule {
  private since: number | null = null
  private fired = false
  readonly code: FlagCode
  readonly durationMs: number
  readonly mode: 'trigger' | 'end'
  readonly maxEpisodeMs: number

  constructor(code: FlagCode, durationMs: number, mode: 'trigger' | 'end' = 'trigger', maxEpisodeMs = 120_000) {
    this.code = code
    this.durationMs = durationMs
    this.mode = mode
    this.maxEpisodeMs = maxEpisodeMs
  }

  /** Is the condition currently holding (for HUD hints)? */
  get active() { return this.since !== null }
  heldFor(now: number) { return this.since === null ? 0 : now - this.since }

  update(condition: boolean, now: number, extra?: Omit<FlagEvent, 'code' | 'at' | 'duration_ms'>): FlagEvent | null {
    if (condition) {
      if (this.since === null) { this.since = now; this.fired = false }
      const held = now - this.since
      if (this.mode === 'trigger' && !this.fired && held >= this.durationMs) {
        this.fired = true
        return { code: this.code, at: now, duration_ms: held, ...extra }
      }
      if (this.mode === 'end' && held >= this.maxEpisodeMs) {
        const start = this.since
        this.since = now
        return { code: this.code, at: start, duration_ms: held, ...extra }
      }
      return null
    }
    if (this.since === null) return null
    const start = this.since
    const held = now - start
    this.since = null
    if (this.mode === 'end' && held >= this.durationMs) return { code: this.code, at: start, duration_ms: held, ...extra }
    return null
  }
}

/** Positive in at least 2 of the last 3 samples -> one event per episode (object detections). */
export class ConfirmRule {
  private samples: boolean[] = []
  private active = false
  private best = 0
  readonly code: FlagCode

  constructor(code: FlagCode) { this.code = code }

  update(positive: boolean, confidence: number, now: number): FlagEvent | null {
    this.samples = [...this.samples, positive].slice(-3)
    if (positive) this.best = Math.max(this.best, confidence)
    const hits = this.samples.filter(Boolean).length
    if (!this.active && hits >= 2) {
      this.active = true
      const ev = { code: this.code, at: now, duration_ms: 0, confidence: round(this.best) }
      return ev
    }
    if (this.active && hits === 0) { this.active = false; this.best = 0 }
    return null
  }
}

/** n consecutive positive checks -> event, then start counting again (FACE_MISMATCH: 2 checks in a row). */
export class ConsecutiveRule {
  private run = 0
  readonly code: FlagCode
  readonly n: number

  constructor(code: FlagCode, n = 2) { this.code = code; this.n = n }

  update(positive: boolean, now: number, confidence?: number): FlagEvent | null {
    this.run = positive ? this.run + 1 : 0
    if (this.run >= this.n) { this.run = 0; return { code: this.code, at: now, duration_ms: 0, confidence } }
    return null
  }
}

/** Events of the same code within 2 s merge into one, summing duration_ms (and counting occurrences). */
export class Merger {
  private last = new Map<FlagCode, { ev: FlagEvent; until: number }>()
  readonly windowMs: number

  constructor(windowMs = 2000) { this.windowMs = windowMs }

  /** Returns the event to send, or null when it merged into a recent one (which the caller already holds). */
  push(ev: FlagEvent): FlagEvent | null {
    const prev = this.last.get(ev.code)
    if (prev && ev.at <= prev.until) {
      prev.ev.duration_ms += ev.duration_ms
      prev.ev.details = { ...prev.ev.details, merged: Number(prev.ev.details?.merged ?? 1) + 1 }
      prev.until = ev.at + this.windowMs
      return null
    }
    this.last.set(ev.code, { ev, until: ev.at + this.windowMs })
    return ev
  }
}

export const inCalibration = (now: number, startedAt: number | null, calibrationSeconds: number) =>
  startedAt === null || now < startedAt + calibrationSeconds * 1000

// ---------------------------------------------------------------- keyboard / clipboard
export interface KeyLike { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }

/** Ctrl/⌘ + C V X A P S U F, F12, Ctrl+Shift+I/J/C, PrintScreen. */
export function isBlockedShortcut(e: KeyLike): boolean {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (k === 'F12' || k === 'PrintScreen' || e.code === 'PrintScreen') return true
  const mod = e.ctrlKey || e.metaKey
  if (mod && e.shiftKey && ['i', 'j', 'c'].includes(k)) return true
  return mod && ['c', 'v', 'x', 'a', 'p', 's', 'u', 'f'].includes(k)
}

/** ≥ 40 characters inserted with fewer than 3 key presses since the previous input = text not typed. */
export class PasteBurst {
  private keys = 0
  readonly minChars: number
  readonly maxKeys: number

  constructor(minChars = 40, maxKeys = 3) { this.minChars = minChars; this.maxKeys = maxKeys }

  keydown() { this.keys += 1 }

  /** `added` = characters added by this input event. Returns true for a burst. */
  input(added: number): boolean {
    const burst = added >= this.minChars && this.keys < this.maxKeys
    this.keys = 0
    return burst
  }
}

// ---------------------------------------------------------------- vision / audio maths
const VIRTUAL_CAMERA = /obs|virtual|manycam|snap camera|xsplit|droidcam|epoccam|camo/i
export const isVirtualCamera = (label: string | null | undefined) => !!label && VIRTUAL_CAMERA.test(label)

/** Mean luminance and standard deviation of RGBA pixels (camera covered: mean < 15 or std < 4). */
export function luminance(rgba: Uint8ClampedArray | number[]): { mean: number; std: number } {
  let sum = 0
  let sq = 0
  const n = rgba.length / 4
  for (let i = 0; i < rgba.length; i += 4) {
    const y = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]
    sum += y
    sq += y * y
  }
  const mean = n ? sum / n : 0
  return { mean: round(mean), std: round(Math.sqrt(Math.max(0, n ? sq / n - mean * mean : 0))) }
}

export const cameraBlocked = (l: { mean: number; std: number }) => l.mean < 15 || l.std < 4

/** Yaw / pitch / roll in degrees from MediaPipe's 4×4 facial transformation matrix (column-major). */
export function headPose(m: ArrayLike<number>): { yaw: number; pitch: number; roll: number } {
  const r = (row: number, col: number) => m[col * 4 + row]
  const sy = Math.hypot(r(0, 0), r(1, 0))
  const pitch = Math.atan2(r(2, 1), r(2, 2))
  const yaw = Math.atan2(-r(2, 0), sy)
  const roll = Math.atan2(r(1, 0), r(0, 0))
  const deg = (x: number) => round((x * 180) / Math.PI)
  return { yaw: deg(yaw), pitch: deg(pitch), roll: deg(roll) }
}

/** |yaw| > 30°, pitch < −25° or > 20° relative to the calibrated straight-ahead pose. */
export function lookingAway(p: { yaw: number; pitch: number }, base = { yaw: 0, pitch: 0 }): boolean {
  const yaw = p.yaw - base.yaw
  const pitch = p.pitch - base.pitch
  return Math.abs(yaw) > 30 || pitch < -25 || pitch > 20
}

export function euclidean(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += (a[i] - b[i]) ** 2
  return Math.sqrt(s)
}

/** Mean power (dB) of the 300–3400 Hz speech band from an AnalyserNode's getFloatFrequencyData. */
export function speechBandDb(freqDb: ArrayLike<number>, sampleRate: number, fftSize: number): number {
  const hz = sampleRate / fftSize
  const lo = Math.max(1, Math.floor(300 / hz))
  const hi = Math.min(freqDb.length - 1, Math.ceil(3400 / hz))
  let power = 0
  for (let i = lo; i <= hi; i++) power += 10 ** (freqDb[i] / 10)
  return round(10 * Math.log10(power / (hi - lo + 1) || 1e-12))
}

/** Median of calibration samples (the noise floor). */
export function median(xs: number[]): number {
  if (!xs.length) return -100
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export const devtoolsSuspected = (w: { outerWidth: number; innerWidth: number; outerHeight: number; innerHeight: number }) =>
  w.outerWidth - w.innerWidth > 160 || w.outerHeight - w.innerHeight > 160

export const windowTooSmall = (innerWidth: number, availWidth: number) => innerWidth < 0.9 * availWidth

function round(x: number) { return Math.round(x * 100) / 100 || 0 }
