/**
 * Time in the lab, measured in the browser and reported every 15 s (the server caps every report by its own clock).
 *
 * Counts while the workspace is visible and the student is active: recent mouse / keyboard input, focus inside the
 * simulation or video frame (a cross-origin frame sends no input events to the page), or a lab video playing. Everything
 * runs inside the app, so time in another tab never counts. Wall-clock deltas are used, so throttled background timers
 * neither lose nor invent time. Kept outside React so ticking never re-renders the simulation.
 */
export const IDLE_MS = 3 * 60_000
const REPORT_MS = 15_000

type ClockDoc = Pick<Document, 'visibilityState' | 'activeElement'> & Partial<Pick<Document, 'querySelectorAll'>>
const videoPlaying = (doc: ClockDoc) =>
  !!doc.querySelectorAll && Array.from(doc.querySelectorAll('video')).some((v) => !v.paused && !v.ended)

type Report = (seconds: number, launched: boolean) => Promise<{ active_seconds: number }>

export class LabClock {
  private seconds: number
  private pending = 0
  private launched = false
  private lastInput = Date.now()
  private lastTick = Date.now()
  private inflight = false
  private paused = false
  private listeners = new Set<() => void>()
  private readonly report: Report

  constructor(initial: number, report: Report) {
    this.seconds = initial
    this.report = report
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  get = () => Math.floor(this.seconds)

  private emit() { this.listeners.forEach((fn) => fn()) }

  /** Called once a second (and on visibility changes). */
  tick(now = Date.now(), doc: ClockDoc = document) {
    const dt = Math.min(now - this.lastTick, 60_000) / 1000
    this.lastTick = now
    if (this.paused) return
    const visible = doc.visibilityState === 'visible'
    const inFrame = doc.activeElement?.tagName === 'IFRAME'
    const active = visible && (inFrame || now - this.lastInput < IDLE_MS || videoPlaying(doc))
    if (active && dt > 0) {
      const before = Math.floor(this.seconds)
      this.seconds += dt
      this.pending += dt
      if (Math.floor(this.seconds) !== before) this.emit()
    }
  }

  input(now = Date.now()) { this.lastInput = now }

  /** The simulation was opened (its in-app frame loaded). */
  launch(now = Date.now()) {
    this.launched = true
    this.lastInput = now
    void this.flush()
  }

  /** Stop counting and reporting (e.g. while the lab is being submitted); resume() if submitting fails. */
  pause() { this.paused = true }
  resume() { this.paused = false; this.lastTick = Date.now(); this.lastInput = Date.now() }

  async flush() {
    const n = Math.floor(this.pending)
    if ((n <= 0 && !this.launched) || this.inflight || this.paused) return
    const launched = this.launched
    this.pending -= n
    this.launched = false
    this.inflight = true
    try {
      const r = await this.report(Math.min(n, 120), launched)
      this.seconds = r.active_seconds + this.pending   // server total is the truth
      this.emit()
    } catch {
      this.pending += n                                 // try again with the next report
      this.launched ||= launched
    } finally {
      this.inflight = false
    }
  }

  /** Starts ticking + reporting; returns the stop function (which sends what is left). */
  start(): () => void {
    this.lastTick = Date.now()
    this.lastInput = Date.now()
    const onInput = () => this.input()
    const onVisibility = () => {
      this.tick()
      if (document.visibilityState === 'hidden') void this.flush()
      else this.input()
    }
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, onInput, { passive: true }))
    document.addEventListener('visibilitychange', onVisibility)
    const ticker = window.setInterval(() => this.tick(), 1000)
    const reporter = window.setInterval(() => void this.flush(), REPORT_MS)
    return () => {
      window.clearInterval(ticker)
      window.clearInterval(reporter)
      events.forEach((e) => window.removeEventListener(e, onInput))
      document.removeEventListener('visibilitychange', onVisibility)
      this.tick()
      void this.flush()
    }
  }
}
