/**
 * Proctoring engine for a running exam: browser-event sensors + the vision / audio loops -> rules -> flag events ->
 * transport, with evidence snapshots and the local enforcement signals (nudge, warning modal, pause overlay).
 * Severity, points, warnings and auto-submit are decided by the server; this only detects and reports.
 */
import type { ClientRules, Heartbeat, StatusInfo } from './examApi'
import { examChannel } from './examLock'
import type { ProctorMedia } from './media'
import type { FrameResult } from './proctor.worker'
import {
  cameraBlocked, ConfirmRule, ConsecutiveRule, devtoolsSuspected, euclidean, type FlagCode, type FlagEvent, HoldRule, inCalibration,
  isBlockedShortcut, lookingAway, Merger, PasteBurst, windowTooSmall,
} from './rules'
import type { EventTransport } from './transport'

export type PauseReason = 'fullscreen' | 'camera' | 'screen' | 'monitor'
export interface LocalFlag { code: FlagCode; label: string; severity: string; calibration: boolean; occurrence: number; modal: boolean; pause: boolean; evidence: string | null }
export interface Hud { camera: boolean; mic: boolean; screen: boolean; fullscreen: boolean; online: boolean; faces: number | null; fps: number | null; hint: string | null }

export interface EngineOptions {
  media: ProctorMedia
  rules: ClientRules
  transport: EventTransport
  startedAt: number
  reference: number[] | null
  baseline: { yaw: number; pitch: number }
  answered: () => number
  heartbeat: (h: Heartbeat) => Promise<StatusInfo & { server_flags: { code: FlagCode; label: string; calibration: boolean }[] }>
  presence: (blob: Blob) => Promise<unknown>
  onFlag: (f: LocalFlag) => void
  onHud: (h: Hud) => void
  onPause: (reasons: PauseReason[]) => void
  onServer: (s: StatusInfo) => void
}

const INSTANT: FlagCode[] = ['COPY_PASTE', 'BLOCKED_SHORTCUT', 'CONTEXT_MENU', 'PRINT_ATTEMPT', 'EXTENSION_INJECTION']

export class ProctorEngine {
  private o: EngineOptions
  private abort = new AbortController()
  private timers: ReturnType<typeof setInterval>[] = []
  private merger = new Merger()
  private paste = new PasteBurst()
  private occurrences = new Map<FlagCode, number>()
  private pauses = new Set<PauseReason>()
  private frames: number[] = []
  private lastFaces: number | null = null
  private degraded = false
  private lastObjects = 0
  private lastEmbed = 0
  private holds: Record<string, HoldRule>
  private phone = new ConfirmRule('PHONE_DETECTED')
  private book = new ConfirmRule('BOOK_OR_PAPER')
  private device = new ConfirmRule('EXTRA_DEVICE')
  private mismatch = new ConsecutiveRule('FACE_MISMATCH', 2)
  private channel: ReturnType<typeof examChannel> | null = null
  private observer: MutationObserver | null = null
  private stopped = false
  private hint: string | null = null
  /** Snapshots taken while an episode is happening (empty chair, hidden tab), used when its event is sent at the end. */
  private early = new Map<FlagCode, Promise<Blob | null>>()

  constructor(o: EngineOptions) {
    this.o = o
    const d = (code: string, fallback: number) => o.rules.flags[code]?.duration_ms || fallback
    this.holds = {
      TAB_HIDDEN: new HoldRule('TAB_HIDDEN', 0, 'end'),
      NO_FACE: new HoldRule('NO_FACE', d('NO_FACE', 5000), 'end'),
      NETWORK_OFFLINE: new HoldRule('NETWORK_OFFLINE', 0, 'end', 10 * 60_000),
      WINDOW_BLUR: new HoldRule('WINDOW_BLUR', d('WINDOW_BLUR', 1500)),
      CAMERA_BLOCKED: new HoldRule('CAMERA_BLOCKED', d('CAMERA_BLOCKED', 3000)),
      MULTIPLE_FACES: new HoldRule('MULTIPLE_FACES', d('MULTIPLE_FACES', 2000)),
      LOOKING_AWAY: new HoldRule('LOOKING_AWAY', d('LOOKING_AWAY', 4000)),
      VOICE_DETECTED: new HoldRule('VOICE_DETECTED', d('VOICE_DETECTED', 3000)),
      WINDOW_RESIZED: new HoldRule('WINDOW_RESIZED', d('WINDOW_RESIZED', 3000)),
      DEVTOOLS_SUSPECTED: new HoldRule('DEVTOOLS_SUSPECTED', 0),
      MULTI_MONITOR: new HoldRule('MULTI_MONITOR', 0),
    }
  }

  // ---------------------------------------------------------------- lifecycle
  start() {
    if (this.stopped) return
    const sig = { signal: this.abort.signal, capture: true }
    const block = (e: Event) => e.preventDefault()
    document.addEventListener('fullscreenchange', () => this.onFullscreen(), sig)
    document.addEventListener('visibilitychange', () => this.onVisibility(), sig)
    for (const t of ['copy', 'cut', 'paste'] as const) document.addEventListener(t, (e) => { e.preventDefault(); void this.emit('COPY_PASTE', { details: { action: t } }) }, sig)
    document.addEventListener('contextmenu', (e) => { e.preventDefault(); void this.emit('CONTEXT_MENU') }, sig)
    document.addEventListener('dragstart', block, sig)
    document.addEventListener('drop', block, sig)
    document.addEventListener('selectstart', (e) => { if (!(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)) e.preventDefault() }, sig)
    window.addEventListener('keydown', (e) => {
      this.paste.keydown()
      if (isBlockedShortcut(e)) { e.preventDefault(); e.stopPropagation(); void this.emit('BLOCKED_SHORTCUT', { details: { key: `${e.ctrlKey || e.metaKey ? 'Ctrl+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.key}` } }) }
    }, sig)
    document.addEventListener('beforeinput', (e) => {
      const ie = e as InputEvent
      const added = ie.data?.length ?? (ie.dataTransfer?.getData('text')?.length ?? 0)
      if (ie.inputType.startsWith('insert') && this.paste.input(added)) void this.emit('PASTE_BURST', { details: { chars: added, type: ie.inputType } })
    }, sig)
    window.addEventListener('beforeprint', () => { void this.emit('PRINT_ATTEMPT') }, sig)
    window.addEventListener('offline', () => this.holds.NETWORK_OFFLINE.update(true, Date.now()), sig)
    window.addEventListener('online', () => { const ev = this.holds.NETWORK_OFFLINE.update(false, Date.now()); if (ev) void this.emitEvent(ev) }, sig)
    const scr = window.screen as Screen & { isExtended?: boolean; addEventListener?: Window['addEventListener'] }
    scr.addEventListener?.('change', () => this.checkMonitors(), sig)
    for (const t of this.o.media.camera?.getVideoTracks() ?? []) {
      t.addEventListener('ended', () => this.trackLost('camera'), sig)
      t.addEventListener('mute', () => this.trackLost('camera'), sig)
      t.addEventListener('unmute', () => this.unpause('camera'), sig)
    }
    for (const t of this.o.media.screen?.getVideoTracks() ?? []) t.addEventListener('ended', () => this.trackLost('screen'), sig)
    this.channel = examChannel((m) => { if (m.type === 'portal-access') void this.emit('PORTAL_ACCESS_ATTEMPT', { details: { path: m.path } }) })
    this.observer = new MutationObserver((list) => this.onMutations(list))
    this.observer.observe(document.documentElement, { childList: true, subtree: true })

    const r = this.o.rules
    this.timers.push(setInterval(() => void this.vision(), Math.round(1000 / Math.max(0.5, r.face_fps))))
    this.timers.push(setInterval(() => this.audio(), 250))
    this.timers.push(setInterval(() => this.checks(), 500))
    this.timers.push(setInterval(() => void this.beat(), 10_000))
    this.timers.push(setInterval(() => void this.presence(), r.presence_snapshot_s * 1000))
    this.o.transport.start()
    this.onFullscreen(true)
    this.checkMonitors()
    this.hud()
  }

  /** Every listener, timer, observer and channel off; what is queued is sent. Safe to call twice; stays stopped. */
  stop() {
    if (this.stopped) return
    this.stopped = true
    this.abort.abort()
    this.timers.forEach(clearInterval)
    this.timers = []
    this.observer?.disconnect()
    this.channel?.close()
    this.o.transport.stop()
    void this.o.transport.flush()
  }

  /** The candidate re-shared the screen after it stopped. */
  rebindScreen() {
    for (const t of this.o.media.screen?.getVideoTracks() ?? []) t.addEventListener('ended', () => this.trackLost('screen'), { signal: this.abort.signal })
    this.unpause('screen')
  }

  setReference(embedding: number[] | null) { this.o.reference = embedding }

  // ---------------------------------------------------------------- emitting
  async emit(code: FlagCode, extra: Partial<FlagEvent> = {}) {
    return this.emitEvent({ code, at: Date.now(), duration_ms: 0, ...extra })
  }

  private async emitEvent(ev: FlagEvent) {
    if (this.stopped) return
    const rule = this.o.rules.flags[ev.code]
    if (ev.code !== 'PERF_DEGRADED' && (!rule || !rule.enabled)) return
    if (INSTANT.includes(ev.code) && !this.merger.push(ev)) return
    const n = (this.occurrences.get(ev.code) ?? 0) + 1
    this.occurrences.set(ev.code, n)
    const calibration = inCalibration(Date.now(), this.o.startedAt, this.o.rules.calibration_seconds)
    const warns = !!rule && (rule.warn === 'always' || (rule.warn === 'third' && n >= 3))
    const kind = rule?.evidence === 'webcam' || (rule?.evidence === 'webcam_first' && n === 1) ? 'webcam' : rule?.evidence === 'screen' ? 'screen' : null
    const early = this.early.get(ev.code)
    this.early.delete(ev.code)
    const blob = early ? await early.catch(() => null) : kind === 'webcam' ? await this.o.media.webcamJpeg().catch(() => null)
      : kind === 'screen' ? await this.o.media.screenJpeg().catch(() => null) : null
    // Stopped while the snapshot was taken: the event still goes out, at once (the transport timer is off now).
    this.o.transport.emit(ev, { urgent: this.stopped || (!calibration && (warns || !!rule?.pause)), evidence: blob && kind ? { blob, kind } : undefined })
    if (rule && !this.stopped) {
      this.o.onFlag({ code: ev.code, label: rule.label, severity: rule.severity, calibration, occurrence: n, modal: !calibration && warns,
        pause: rule.pause, evidence: blob ? URL.createObjectURL(blob) : null })
    }
  }

  // ---------------------------------------------------------------- browser sensors
  private onFullscreen(initial = false) {
    if (document.fullscreenElement) { this.unpause('fullscreen'); return }
    this.pause('fullscreen')
    if (!initial) void this.emit('FULLSCREEN_EXIT')
  }

  private onVisibility() {
    const now = Date.now()
    if (document.visibilityState === 'hidden') {
      this.holds.TAB_HIDDEN.update(true, now)
      if (!this.early.has('TAB_HIDDEN')) this.early.set('TAB_HIDDEN', this.o.media.webcamJpeg())
      return
    }
    const ev = this.holds.TAB_HIDDEN.update(false, now)
    if (ev) void this.emitEvent(ev)
  }

  private trackLost(kind: 'camera' | 'screen') {
    if (this.pauses.has(kind)) return
    this.pause(kind)
    void this.emit(kind === 'camera' ? 'CAMERA_LOST' : 'SCREEN_SHARE_STOPPED')
  }

  private checkMonitors() {
    const ext = (window.screen as Screen & { isExtended?: boolean }).isExtended
    if (ext === undefined) return
    const ev = this.holds.MULTI_MONITOR.update(ext, Date.now())
    if (ext) { this.pause('monitor'); if (ev) void this.emitEvent({ ...ev, details: { screens: 'extended' } }) } else this.unpause('monitor')
  }

  private onMutations(list: MutationRecord[]) {
    const root = document.getElementById('root')
    for (const m of list) {
      for (const n of Array.from(m.addedNodes)) {
        if (!(n instanceof Element)) continue
        if (n.tagName === 'VITE-ERROR-OVERLAY' || n.closest('[data-app-portal]')) continue   // the app's own portals (toasts)
        const foreign = n.tagName === 'IFRAME' || (root && !root.contains(n) && n !== root && !['SCRIPT', 'STYLE', 'LINK', 'META'].includes(n.tagName))
        if (foreign) { void this.emit('EXTENSION_INJECTION', { details: { tag: n.tagName.toLowerCase(), id: (n.id || '').slice(0, 40) } }); return }
      }
    }
  }

  private checks() {
    const now = Date.now()
    const visible = document.visibilityState === 'visible'
    const blur = this.holds.WINDOW_BLUR.update(visible && !document.hasFocus(), now)
    if (blur) void this.emitEvent(blur)
    if (document.fullscreenElement) {
      const small = this.holds.WINDOW_RESIZED.update(windowTooSmall(window.innerWidth, window.screen.availWidth), now)
      if (small) void this.emitEvent({ ...small, details: { inner: window.innerWidth, avail: window.screen.availWidth } })
    }
    const dev = this.holds.DEVTOOLS_SUSPECTED.update(devtoolsSuspected(window), now)
    if (dev) void this.emitEvent(dev)
    if (this.o.media.camera && !this.o.media.cameraLive()) this.trackLost('camera')
    if (this.o.media.screen && !this.o.media.screenLive()) this.trackLost('screen')
    this.checkMonitors()
    this.hud()
  }

  private audio() {
    const db = this.o.media.micDb()
    if (db === null || !Number.isFinite(db)) return
    const ev = this.holds.VOICE_DETECTED.update(db > this.o.media.floorDb + this.o.rules.voice_db, Date.now())
    if (ev) void this.emitEvent({ ...ev, details: { db: Math.round(db), floor: Math.round(this.o.media.floorDb) } })
  }

  // ---------------------------------------------------------------- vision
  private async vision() {
    if (this.stopped || !this.o.media.cameraLive()) return
    const now = Date.now()
    const objects = now - this.lastObjects >= 1000 / Math.max(0.1, this.o.rules.object_fps)
    const embed = !!this.o.reference && now - this.lastEmbed >= this.o.rules.face_match_interval_s * 1000
    const r = await this.o.media.analyse({ objects, embed })
    if (!r) return
    if (objects) this.lastObjects = now
    if (embed && r.embedding) this.lastEmbed = now
    this.frames = [...this.frames.filter((t) => t > now - 30_000), now]
    this.process(r, Date.now(), objects)
  }

  process(r: FrameResult, now: number, objectsSampled = false) {
    const fps = this.frames.length / 30
    if (!this.degraded && this.frames.length > 0 && now - this.o.startedAt > 30_000 && fps < 1) {
      this.degraded = true
      void this.emit('PERF_DEGRADED', { details: { fps } })
    } else if (this.degraded && fps >= 1) this.degraded = false
    this.lastFaces = r.faces
    const persons = r.objects.filter((o) => o.label === 'person' && o.score >= 0.6).length
    const blocked = cameraBlocked(r.luma)
    const evs: (FlagEvent | null)[] = [
      this.holds.CAMERA_BLOCKED.update(blocked, now, { details: { luma: r.luma } }),
      this.holds.NO_FACE.update(!blocked && !this.degraded && r.faces === 0, now),
      this.holds.MULTIPLE_FACES.update(r.faces >= 2 || persons >= 2, now, { details: { faces: r.faces, persons } }),
      this.holds.LOOKING_AWAY.update(r.faces === 1 && !!r.pose && lookingAway(r.pose, this.o.baseline), now, { details: { pose: r.pose } }),
    ]
    if (objectsSampled) {
      const best = (labels: string[]) => Math.max(0, ...r.objects.filter((o) => labels.includes(o.label)).map((o) => o.score))
      const phone = best(['cell phone'])
      const book = best(['book'])
      const dev = best(['laptop', 'tv'])
      evs.push(this.phone.update(phone >= 0.6, phone, now), this.book.update(book >= 0.6, book, now), this.device.update(dev >= 0.6, dev, now))
    }
    if (r.embedding && this.o.reference) {
      const dist = euclidean(r.embedding, this.o.reference)
      const ev = this.mismatch.update(dist > this.o.rules.face_match_threshold, now, Math.round(Math.min(1, dist) * 100) / 100)
      evs.push(ev ? { ...ev, details: { distance: Math.round(dist * 100) / 100, threshold: this.o.rules.face_match_threshold } } : null)
    }
    const noFace = this.holds.NO_FACE
    if (noFace.active && noFace.heldFor(now) >= noFace.durationMs && !this.early.has('NO_FACE')) this.early.set('NO_FACE', this.o.media.webcamJpeg())
    for (const ev of evs) if (ev) void this.emitEvent(ev)
    this.hint = blocked ? 'Your camera looks covered or dark' : r.faces === 0 ? 'Keep your face in view of the camera' : r.faces > 1 ? 'Only you should be in view' : null
    this.hud()
  }

  // ---------------------------------------------------------------- reporting
  private async beat() {
    if (this.stopped) return
    try {
      const res = await this.o.heartbeat({
        fullscreen: !!document.fullscreenElement, visible: document.visibilityState === 'visible', faces: this.lastFaces,
        camera_live: this.o.media.cameraLive(), screen_live: !!this.o.media.screenLive(), mic_live: !!this.o.media.micLive(),
        online: navigator.onLine, answered: this.o.answered(), fps: Math.round((this.frames.length / 30) * 10) / 10,
      })
      if (this.stopped) return
      for (const f of res.server_flags) {
        const rule = { label: f.label, severity: 'High' }
        this.o.onFlag({ code: f.code, label: rule.label, severity: rule.severity, calibration: f.calibration, occurrence: 1, modal: !f.calibration, pause: false, evidence: null })
      }
      this.o.onServer(res)
    } catch { /* offline: the server raises HEARTBEAT_MISSING if this lasts > 30 s */ }
  }

  private async presence() {
    if (this.stopped) return
    const b = await this.o.media.webcamJpeg().catch(() => null)
    if (b && !this.stopped) await this.o.presence(b).catch(() => {})
  }

  private pause(r: PauseReason) {
    if (this.pauses.has(r)) return
    this.pauses.add(r)
    this.o.onPause([...this.pauses])
  }

  unpause(r: PauseReason) {
    if (!this.pauses.delete(r)) return
    this.o.onPause([...this.pauses])
  }

  private hud() {
    this.o.onHud({ camera: !!this.o.media.cameraLive(), mic: !!this.o.media.micLive(), screen: !!this.o.media.screenLive(),
      fullscreen: !!document.fullscreenElement, online: navigator.onLine, faces: this.lastFaces,
      fps: Math.round((this.frames.length / 30) * 10) / 10, hint: this.hint })
  }
}
