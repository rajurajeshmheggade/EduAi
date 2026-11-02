/**
 * Which parts of a video were really played — the basis of "watch the video to the end to unlock Submit" in Virtual
 * Labs. Coverage grows only while playback runs continuously: seeking (or any jump larger than normal playback could
 * produce between two progress events) adds nothing, so dragging the playhead to the end does not count. A video is
 * complete once the player reached its end AND at least COMPLETE_RATIO of it was played. The server applies the same
 * rule and additionally limits how fast watched time can grow (backend services/virtual_labs/video.py).
 */

export type Segment = [number, number]

export const COMPLETE_RATIO = 0.9
/** Fastest playback the in-app players allow (faster rates are clamped). */
export const MAX_RATE = 2
/** Media seconds between two progress events (at 1x) still treated as continuous playback. Browsers fire
 * `timeupdate` every 15–250 ms and the YouTube player is polled every 500 ms, so this leaves room for jank. */
const MAX_STEP = 1.5

/** Sorted, merged intervals (touching / overlapping ones joined). */
export function mergeSegments(segments: Segment[]): Segment[] {
  const sorted = segments.filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s).map(([s, e]) => [s, e] as Segment)
    .sort((a, b) => a[0] - b[0])
  const out: Segment[] = []
  for (const [s, e] of sorted) {
    const last = out[out.length - 1]
    if (last && s <= last[1] + 0.05) last[1] = Math.max(last[1], e)
    else out.push([s, e])
  }
  return out
}

export const coveredSeconds = (segments: Segment[]) => segments.reduce((n, [s, e]) => n + (e - s), 0)

const round = (n: number) => Math.round(n * 100) / 100

export class WatchTracker {
  private segs: Segment[]
  private last: number | null = null
  duration: number
  endedSeen = false

  constructor(initial: Segment[] = [], duration = 0, reachedEnd = false) {
    this.segs = mergeSegments(initial)
    this.duration = duration
    this.endedSeen = reachedEnd
  }

  get segments(): Segment[] { return this.segs.map(([s, e]) => [round(s), round(e)] as Segment) }

  setDuration(d: number) { if (Number.isFinite(d) && d > 0) this.duration = d }

  /** Playback (re)started at `t`. */
  play(t: number) { this.last = t }

  /** A progress event while playing; counts [previous, t] only when it looks like continuous playback. */
  time(t: number, rate = 1) {
    if (this.last !== null) {
      const step = t - this.last
      const r = Number.isFinite(rate) ? Math.min(Math.max(rate, 1), MAX_RATE) : 1
      if (step > 0 && step <= MAX_STEP * r) this.add(this.last, t)
    }
    this.last = t
  }

  /** The playhead is being moved: the jump never counts. */
  seek() { this.last = null }

  pause(t: number) { this.time(t); this.last = null }

  /** The player reached its end. */
  end(duration = this.duration) {
    this.setDuration(duration)
    if (this.last !== null && this.duration) this.time(this.duration)
    this.endedSeen = true
    this.last = null
  }

  private add(s: number, e: number) {
    const d = this.duration || Infinity
    this.segs = mergeSegments([...this.segs, [Math.max(0, s), Math.min(d, e)]])
  }

  get covered(): number { return coveredSeconds(this.segs) }
  get coverage(): number { return this.duration ? Math.min(1, this.covered / this.duration) : 0 }
  get complete(): boolean { return this.endedSeen && this.coverage >= COMPLETE_RATIO }
}
