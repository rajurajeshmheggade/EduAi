import { describe, expect, it } from 'vitest'
import { COMPLETE_RATIO, mergeSegments, WatchTracker } from './videoProgress'

/** Plays from `from` to `to` with progress events every 0.25 s (like `timeupdate`). */
function play(t: WatchTracker, from: number, to: number, rate = 1) {
  t.play(from)
  for (let x = from + 0.25 * rate; x <= to + 1e-9; x += 0.25 * rate) t.time(Math.round(x * 100) / 100, rate)
}

describe('WatchTracker', () => {
  it('counts continuous playback and completes at the end', () => {
    const t = new WatchTracker([], 120)
    play(t, 0, 119.75)
    expect(t.complete).toBe(false)                         // the end has not been reached yet
    t.end(120)
    expect(t.coverage).toBe(1)
    expect(t.complete).toBe(true)
    expect(t.segments).toEqual([[0, 120]])
  })

  it('does not count seeking to the end', () => {
    const t = new WatchTracker([], 120)
    play(t, 0, 5)
    t.seek()
    play(t, 118, 119.75)
    t.end(120)
    expect(t.endedSeen).toBe(true)
    expect(t.coverage).toBeLessThan(COMPLETE_RATIO)
    expect(t.complete).toBe(false)
    expect(t.segments).toEqual([[0, 5], [118, 120]])
  })

  it('ignores jumps between progress events even without a seeking event (e.g. the YouTube player)', () => {
    const t = new WatchTracker([], 120)
    t.play(0)
    t.time(0.5); t.time(100); t.time(100.5)
    expect(t.covered).toBeCloseTo(1)
  })

  it('counts up to 2x speed, never faster', () => {
    const t = new WatchTracker([], 60)
    play(t, 0, 60, 2)
    expect(t.coverage).toBe(1)
    const fast = new WatchTracker([], 60)
    fast.play(0)
    for (let x = 4; x <= 60; x += 4) fast.time(x, 16)      // a 16x rate is treated as 2x: 4 s steps are jumps
    expect(fast.covered).toBe(0)
  })

  it('resumes from progress saved earlier (a reload keeps it) and counts re-watching once', () => {
    const t = new WatchTracker([[0, 60]], 120)
    play(t, 30, 119.75)
    t.end()
    expect(t.segments).toEqual([[0, 120]])
    expect(t.complete).toBe(true)
  })

  it('needs 90% of the video, not just the end', () => {
    const t = new WatchTracker([], 100)
    play(t, 0, 80)
    t.seek()
    play(t, 95, 99.75)
    t.end(100)
    expect(t.coverage).toBeCloseTo(0.85)
    expect(t.complete).toBe(false)
  })

  it('merges overlapping parts', () => {
    expect(mergeSegments([[5, 10], [0, 6], [20, 30], [10, 12]])).toEqual([[0, 12], [20, 30]])
  })
})
