import { describe, expect, it, vi } from 'vitest'
import { EXTERNAL_MS, IDLE_MS, LabClock } from './labClock'

const visible = { visibilityState: 'visible' as DocumentVisibilityState, activeElement: null }
const hidden = { visibilityState: 'hidden' as DocumentVisibilityState, activeElement: null }
const inFrame = { visibilityState: 'visible' as DocumentVisibilityState, activeElement: { tagName: 'IFRAME' } as Element }

describe('LabClock', () => {
  it('counts active, visible time and stops when the student is idle', () => {
    const c = new LabClock(100, vi.fn())
    const t0 = Date.now()
    c.input(t0)
    c.tick(t0 + 1000, visible)
    c.tick(t0 + 31_000, visible)
    expect(c.get()).toBe(131)
    c.tick(t0 + 31_000 + IDLE_MS, visible)            // no input for 3 minutes: not counted
    expect(c.get()).toBe(131)
  })

  it('counts while the simulation frame has focus even without page input', () => {
    const c = new LabClock(0, vi.fn())
    const t0 = Date.now()
    c.input(t0 - IDLE_MS * 2)
    c.tick(t0, inFrame)
    c.tick(t0 + 20_000, inFrame)
    expect(c.get()).toBe(20)
  })

  it('counts time away only after the lab was opened on DIKSHA, for at most 20 minutes', () => {
    const c = new LabClock(0, vi.fn(async () => ({ active_seconds: 0 })))
    const t0 = Date.now()
    c.tick(t0, hidden)
    c.tick(t0 + 30_000, hidden)
    expect(c.get()).toBe(0)                          // hidden tab, no launch
    c.launch(false, t0 + 30_000)
    c.tick(t0 + 60_000, hidden)
    expect(c.get()).toBe(30)
    c.tick(t0 + 30_000 + EXTERNAL_MS + 60_000, hidden) // beyond the launch window
    expect(c.get()).toBe(30)
  })

  it('reports whole seconds, adopts the server total and retries after a failure', async () => {
    const report = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ active_seconds: 42 })
    const c = new LabClock(10, report)
    const t0 = Date.now()
    c.input(t0)
    c.tick(t0, visible)
    c.tick(t0 + 15_500, visible)
    await c.flush()
    expect(report).toHaveBeenLastCalledWith(15, false)
    await c.flush()                                  // the failed 15 s are sent again
    expect(report).toHaveBeenLastCalledWith(15, false)
    expect(c.get()).toBe(42)
  })

  it('neither counts nor reports while paused (lab being submitted)', async () => {
    const report = vi.fn(async () => ({ active_seconds: 0 }))
    const c = new LabClock(0, report)
    const t0 = Date.now()
    c.input(t0)
    c.pause()
    c.tick(t0 + 10_000, visible)
    c.launch(true, t0 + 10_000)
    await c.flush()
    expect(c.get()).toBe(0)
    expect(report).not.toHaveBeenCalled()
  })
})
