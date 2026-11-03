/**
 * Student proctoring monitor (Online Tests, Virtual Labs, AI Classroom): browser events and the on-device camera /
 * microphone detectors -> the shared rules (lib/proctor/rules.ts) -> flag events -> batched, idempotent transport, and a
 * heartbeat that brings back teacher warnings or an "ended by teacher" instruction.
 *
 * FLAGS ONLY: no frame, snapshot or sound ever leaves the device. An event is a code, when, how long and a few numbers.
 * Severity is decided by the server; this only detects and reports.
 */
import type { ProctorMedia } from '../media'
import type { FrameResult } from '../proctor.worker'
import { cameraBlocked, ConfirmRule, type FlagCode, type FlagEvent, HoldRule, lookingAway, Merger } from '../rules'
import type { ClientRules, HeartbeatBody, ProctorStatus, StudentStatus, WireEvent } from '@/services/proctoringService'

export interface MonitorHud { camera: boolean; mic: boolean | null; fullscreen: boolean; online: boolean; visible: boolean; faces: number | null; hint: string | null; away: boolean }
export interface LocalFlag { code: FlagCode; label: string; at: number }

export interface MonitorOptions {
  media: ProctorMedia
  rules: ClientRules
  /** Highest seq the server already holds for this session (a resumed session continues after it). */
  lastSeq: number
  baseline?: { yaw: number; pitch: number }
  send: (events: WireEvent[]) => Promise<StudentStatus & { accepted: number[] }>
  heartbeat: (h: HeartbeatBody) => Promise<StudentStatus>
  /** The page is going away: hand over what was not sent yet (sent with fetch keepalive). */
  onUnload?: (pending: WireEvent[]) => void
  onHud?: (h: MonitorHud) => void
  onFlag?: (f: LocalFlag) => void
  onStatus?: (s: StudentStatus) => void
}

/** Sent at once rather than with the next 5 s batch. */
const URGENT: FlagCode[] = ['MULTIPLE_FACES', 'PHONE_DETECTED', 'CAMERA_LOST', 'MIC_LOST', 'FULLSCREEN_EXIT', 'TAB_HIDDEN', 'NO_FACE']
/** Same code within 2 s = one event (a burst of paste events, a flickering full screen). */
const INSTANT: FlagCode[] = ['COPY_PASTE', 'FULLSCREEN_EXIT']
/** Not shown in the student's own list of recorded flags (informational). */
const QUIET: FlagCode[] = ['SANCTIONED_AWAY', 'PERF_DEGRADED', 'NETWORK_OFFLINE']
export const AWAY_MAX_MS = 20 * 60_000
/** A session in one of these states is over for good (the server also says `ended`). */
const FINISHED: ProctorStatus[] = ['SUBMITTED', 'ENDED_BY_TEACHER', 'CLOSED']
export const sessionOver = (s: Pick<StudentStatus, 'status' | 'ended'>) => s.ended || FINISHED.includes(s.status)

/** Event details are small scalars only (the server refuses anything else). */
export function scalars(d: Record<string, unknown> | undefined): Record<string, string | number | boolean | null> | undefined {
  if (!d) return undefined
  const out: Record<string, string | number | boolean | null> = {}
  for (const [k, v] of Object.entries(d).slice(0, 8)) {
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k.slice(0, 32)] = v
    else if (typeof v === 'string') out[k.slice(0, 32)] = v.slice(0, 80)
  }
  return Object.keys(out).length ? out : undefined
}

export class StudentProctorMonitor {
  private o: MonitorOptions
  private abort = new AbortController()
  private timers: ReturnType<typeof setInterval>[] = []
  private queue: WireEvent[] = []
  private sending: Promise<void> | null = null
  private beating = new Set<Promise<void>>()
  private seq: number
  private merger = new Merger()
  private holds: Record<string, HoldRule>
  private phone = new ConfirmRule('PHONE_DETECTED')
  private device = new ConfirmRule('EXTRA_DEVICE')
  private lastFaces: number | null = null
  private lastObjects = 0
  private frames: number[] = []
  private degraded = false
  private startedAt = 0
  private stopped = false
  private hint: string | null = null
  private awayUntil = 0
  private lastBeatKey = ''
  private lastBeatAt = 0
  readonly permissions: { camera: PermissionState | null; mic: PermissionState | null } = { camera: null, mic: null }

  constructor(o: MonitorOptions) {
    this.o = o
    this.seq = o.lastSeq
    const d = o.rules.durations_ms
    this.holds = {
      NO_FACE: new HoldRule('NO_FACE', d.NO_FACE, 'end'),
      MULTIPLE_FACES: new HoldRule('MULTIPLE_FACES', d.MULTIPLE_FACES),
      LOOKING_AWAY: new HoldRule('LOOKING_AWAY', d.LOOKING_AWAY),
      CAMERA_BLOCKED: new HoldRule('CAMERA_BLOCKED', d.CAMERA_BLOCKED),
      WINDOW_BLUR: new HoldRule('WINDOW_BLUR', d.WINDOW_BLUR),
      VOICE_DETECTED: new HoldRule('VOICE_DETECTED', d.VOICE_DETECTED),
      TAB_HIDDEN: new HoldRule('TAB_HIDDEN', 1000, 'end'),
      NETWORK_OFFLINE: new HoldRule('NETWORK_OFFLINE', 0, 'end', 10 * 60_000),
      CAMERA_LOST: new HoldRule('CAMERA_LOST', 3000),
      MIC_LOST: new HoldRule('MIC_LOST', 3000),
    }
  }

  // ---------------------------------------------------------------- lifecycle
  start() {
    if (this.stopped || this.startedAt) return
    this.startedAt = Date.now()
    const sig = { signal: this.abort.signal }
    document.addEventListener('visibilitychange', () => this.onVisibility(), sig)
    document.addEventListener('fullscreenchange', () => this.onFullscreen(), sig)
    for (const t of ['copy', 'cut', 'paste'] as const) document.addEventListener(t, () => this.emit({ code: 'COPY_PASTE', at: Date.now(), duration_ms: 0, details: { action: t } }), sig)
    window.addEventListener('offline', () => { this.holds.NETWORK_OFFLINE.update(true, Date.now()); this.hud() }, sig)
    window.addEventListener('online', () => { const ev = this.holds.NETWORK_OFFLINE.update(false, Date.now()); if (ev) this.emit(ev); void this.flush(); this.hud() }, sig)
    window.addEventListener('pagehide', () => this.unload(), sig)
    navigator.mediaDevices?.addEventListener?.('devicechange', () => this.checks(), sig)
    void this.watchPermissions()
    const r = this.o.rules
    if (this.o.media.camera) this.timers.push(setInterval(() => void this.vision(), Math.round(1000 / Math.max(0.5, r.face_fps))))
    if (r.detect_voice && this.o.media.mic) this.timers.push(setInterval(() => this.audio(), 250))
    this.timers.push(setInterval(() => this.checks(), 1000))
    this.timers.push(setInterval(() => void this.flush(), 5000))
    this.timers.push(setInterval(() => void this.beat(), Math.max(5, r.heartbeat_seconds) * 1000))
    this.checks()
    void this.beat()
  }

  /** Stop sensing (every listener and timer) and send what is left. Safe to call twice; a stopped monitor stays stopped. */
  stop() {
    if (this.stopped) return
    this.stopped = true
    this.abort.abort()
    this.timers.forEach(clearInterval)
    this.timers = []
    void this.flush()
  }

  get isStopped() { return this.stopped }

  /**
   * Resolves once the flags still queued are sent and a heartbeat already on its way has come back — so the session
   * can be closed after them (a late heartbeat would otherwise reach the server after "finished").
   */
  async settle(): Promise<void> {
    await Promise.all([this.flush().catch(() => {}), ...this.beating])
  }

  get pending() { return this.queue.length }

  /**
   * The exam itself sends the student elsewhere (a Virtual Lab simulation on DIKSHA's player in a new tab): leaving
   * the page is not a tab switch until they come back, for at most 20 minutes. Logged as an informational event.
   */
  allowAway(reason: string, ms = AWAY_MAX_MS) {
    this.awayUntil = Date.now() + Math.min(ms, AWAY_MAX_MS)
    this.holds.TAB_HIDDEN = new HoldRule('TAB_HIDDEN', 1000, 'end')
    this.holds.WINDOW_BLUR = new HoldRule('WINDOW_BLUR', this.o.rules.durations_ms.WINDOW_BLUR)
    this.emit({ code: 'SANCTIONED_AWAY', at: Date.now(), duration_ms: 0, details: { reason } })
  }

  isAway(now = Date.now()) { return now < this.awayUntil }

  /** The student reconnected (or switched) the camera from the HUD. */
  async restartCamera(deviceId?: string) {
    if (this.stopped) return
    await this.o.media.startCamera(deviceId)
    this.checks()
  }

  async restartMic(deviceId?: string) {
    if (this.stopped) return
    await this.o.media.startMic(deviceId)
    this.checks()
  }

  // ---------------------------------------------------------------- emitting + transport
  emit(ev: FlagEvent) {
    if (this.stopped) return
    if (INSTANT.includes(ev.code) && !this.merger.push(ev)) return
    const details = scalars(ev.details)
    this.queue.push({
      seq: ++this.seq, code: ev.code, client_ts: new Date(ev.at).toISOString(), duration_ms: Math.max(0, Math.round(ev.duration_ms)),
      ...(ev.confidence !== undefined ? { confidence: Math.min(1, Math.max(0, ev.confidence)) } : {}), ...(details ? { details } : {}),
    })
    if (!QUIET.includes(ev.code)) this.o.onFlag?.({ code: ev.code, label: this.o.rules.labels[ev.code] ?? ev.code, at: ev.at })
    if (URGENT.includes(ev.code) || this.queue.length >= 20) void this.flush()
  }

  flush(): Promise<void> {
    this.sending ??= this.run().finally(() => { this.sending = null })
    return this.sending
  }

  private async run() {
    while (this.queue.length) {
      const batch = this.queue.slice(0, 50)
      let res: StudentStatus & { accepted: number[] }
      try {
        res = await this.o.send(batch)
      } catch (e) {
        const status = (e as { response?: { status?: number } })?.response?.status
        if (status === 422) this.queue = this.queue.slice(batch.length)   // malformed: drop rather than loop
        return                                                            // offline / 429 / 5xx: retry on the next tick
      }
      this.queue = this.queue.slice(batch.length)
      this.o.onStatus?.(res)
      if (res.ended || (res.status !== 'ACTIVE' && res.status !== 'INTERRUPTED')) { this.queue = []; return }
    }
  }

  private unload() {
    if (this.stopped) return
    const pending = this.queue.splice(0)
    this.stop()
    this.o.onUnload?.(pending)
  }

  // ---------------------------------------------------------------- browser sensors
  private onVisibility() {
    const now = Date.now()
    const hidden = document.visibilityState === 'hidden'
    if (hidden && this.isAway(now)) { this.hud(); return }   // sanctioned (e.g. the lab simulation on DIKSHA)
    const ev = this.holds.TAB_HIDDEN.update(hidden, now)
    if (!hidden) this.awayUntil = 0                          // back on the exam page: the sanctioned window is over
    if (ev) this.emit(ev)
    this.hud()
  }

  private onFullscreen() {
    if (this.o.rules.fullscreen_required && !document.fullscreenElement) this.emit({ code: 'FULLSCREEN_EXIT', at: Date.now(), duration_ms: 0 })
    this.hud()
    void this.beat(true)
  }

  private async watchPermissions() {
    const q = navigator.permissions?.query?.bind(navigator.permissions)
    if (!q) return
    for (const [name, key] of [['camera', 'camera'], ['microphone', 'mic']] as const) {
      try {
        const st = await q({ name: name as PermissionName })
        this.permissions[key] = st.state
        st.addEventListener?.('change', () => { this.permissions[key] = st.state; this.checks() }, { signal: this.abort.signal })
      } catch { /* not queryable in this browser (e.g. Firefox): track 'ended' still reports it */ }
    }
  }

  checks(now = Date.now()) {
    if (this.stopped) return
    const m = this.o.media
    const visible = document.visibilityState === 'visible'
    if (!this.isAway(now)) {
      const blur = this.holds.WINDOW_BLUR.update(visible && !document.hasFocus(), now)
      if (blur) this.emit(blur)
    }
    if (m.camera) {
      const lost = this.holds.CAMERA_LOST.update(!m.cameraLive(), now, { details: { permission: this.permissions.camera } })
      if (lost) this.emit(lost)
    }
    if (m.mic) {
      const lost = this.holds.MIC_LOST.update(!m.micLive(), now, { details: { permission: this.permissions.mic } })
      if (lost) this.emit(lost)
    }
    this.hud()
    // A change the teacher should see (camera off, permission removed …) goes out at once, not with the next beat.
    const key = this.beatKey()
    if (key !== this.lastBeatKey && now - this.lastBeatAt > 2000) void this.beat(true)
  }

  private audio() {
    const db = this.o.media.micDb()
    if (db === null || !Number.isFinite(db) || this.o.media.floorDb <= -99) return   // not calibrated: stay quiet
    const ev = this.holds.VOICE_DETECTED.update(db > this.o.media.floorDb + this.o.rules.voice_db, Date.now())
    if (ev) this.emit({ ...ev, details: { db: Math.round(db), floor: Math.round(this.o.media.floorDb) } })
  }

  // ---------------------------------------------------------------- vision
  private async vision() {
    if (this.stopped || !this.o.media.cameraLive()) return
    const now = Date.now()
    const objects = this.o.rules.detect_objects && now - this.lastObjects >= 1000 / Math.max(0.1, this.o.rules.object_fps)
    const r = await this.o.media.analyse({ objects })
    if (!r || this.stopped) return
    if (objects) this.lastObjects = now
    this.frames = [...this.frames.filter((t) => t > now - 30_000), now]
    this.process(r, Date.now(), objects)
  }

  /** One analysed frame -> rule updates (public for tests). */
  process(r: Pick<FrameResult, 'faces' | 'pose' | 'luma' | 'objects'>, now: number, objectsSampled = false) {
    const rules = this.o.rules
    const fps = this.frames.length / 30
    if (!this.degraded && this.frames.length > 0 && now - this.startedAt > 30_000 && fps < 0.5) {
      this.degraded = true
      this.emit({ code: 'PERF_DEGRADED', at: now, duration_ms: 0, details: { fps: Math.round(fps * 10) / 10 } })
    } else if (this.degraded && fps >= 0.5) this.degraded = false
    this.lastFaces = r.faces
    const persons = r.objects.filter((o) => o.label === 'person' && o.score >= rules.object_min_confidence).length
    const blocked = cameraBlocked(r.luma)
    const evs: (FlagEvent | null)[] = [
      this.holds.CAMERA_BLOCKED.update(blocked, now, { details: { luma: Math.round(r.luma.mean) } }),
      this.holds.NO_FACE.update(!blocked && r.faces === 0, now),
      rules.detect_multiple_faces ? this.holds.MULTIPLE_FACES.update(r.faces >= 2 || persons >= 2, now, { details: { faces: r.faces, persons } }) : null,
      rules.detect_looking_away ? this.holds.LOOKING_AWAY.update(r.faces === 1 && !!r.pose && lookingAway(r.pose, this.o.baseline), now) : null,
    ]
    if (objectsSampled && rules.detect_objects) {
      const best = (labels: string[]) => Math.max(0, ...r.objects.filter((o) => labels.includes(o.label)).map((o) => o.score))
      const phone = best(['cell phone'])
      const screen = best(['laptop', 'tv'])
      evs.push(this.phone.update(phone >= rules.object_min_confidence, phone, now), this.device.update(screen >= rules.object_min_confidence, screen, now))
    }
    for (const ev of evs) if (ev) this.emit(ev)
    this.hint = blocked ? 'Your camera looks covered or too dark' : r.faces === 0 ? 'Keep your face in view of the camera' : r.faces > 1 ? 'Only you should be in view' : null
    this.hud()
  }

  // ---------------------------------------------------------------- heartbeat + HUD
  status(): HeartbeatBody {
    const m = this.o.media
    return {
      camera_live: !!m.cameraLive(), mic_live: m.mic ? !!m.micLive() : null, camera_permission: this.permissions.camera, mic_permission: this.permissions.mic,
      fullscreen: !!document.fullscreenElement, visible: document.visibilityState === 'visible', faces: this.lastFaces, online: navigator.onLine,
      fps: Math.round((this.frames.length / 30) * 10) / 10,
    }
  }

  private beatKey() {
    const s = this.status()
    return [s.camera_live, s.mic_live, s.camera_permission, s.mic_permission, s.fullscreen, s.online].join('|')
  }

  private beat(urgent = false): Promise<void> {
    if (this.stopped) return Promise.resolve()
    const now = Date.now()
    if (urgent && now - this.lastBeatAt < 2000) return Promise.resolve()
    this.lastBeatAt = now
    this.lastBeatKey = this.beatKey()
    const run = (async () => {
      try {
        const st = await this.o.heartbeat(this.status())
        if (!this.stopped) this.o.onStatus?.(st)
      } catch { /* offline: the server marks the session interrupted if this lasts */ }
    })()
    this.beating.add(run)
    void run.finally(() => this.beating.delete(run))
    return run
  }

  private hud() {
    const m = this.o.media
    this.o.onHud?.({ camera: !!m.cameraLive(), mic: m.mic ? !!m.micLive() : null, fullscreen: !!document.fullscreenElement, online: navigator.onLine,
      visible: document.visibilityState === 'visible', faces: this.lastFaces, hint: this.hint, away: this.isAway() })
  }
}
