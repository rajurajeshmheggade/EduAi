import { describe, expect, it } from 'vitest'
import { FOCUS_DEFAULT_MINUTES, FOCUS_MAX_MINUTES, FOCUS_PRESETS, MINUTE_MS } from './config'
import {
  focusRemaining, formatClock, initialFocus, pauseFocus, resetFocus, restoreFocus, resumeFocus, setFocusMinutes, spokenClock, startFocus, tickFocus,
} from './focusTimer'

const T0 = 1_000_000

describe('focus timer state machine', () => {
  it('defaults to 25 minutes with 15 / 25 / 45 presets', () => {
    expect(FOCUS_DEFAULT_MINUTES).toBe(25)
    expect(FOCUS_PRESETS).toEqual([15, 25, 45])
    expect(initialFocus()).toEqual({ minutes: 25, status: 'idle', endsAt: null, remainingMs: 25 * MINUTE_MS })
  })

  it('start → pause holds the time → resume → complete exactly once', () => {
    let s = startFocus(initialFocus(25), T0)
    expect(s).toMatchObject({ status: 'running', endsAt: T0 + 25 * MINUTE_MS })
    expect(focusRemaining(s, T0 + MINUTE_MS)).toBe(24 * MINUTE_MS)

    s = pauseFocus(s, T0 + MINUTE_MS)
    expect(s).toMatchObject({ status: 'paused', endsAt: null, remainingMs: 24 * MINUTE_MS })
    expect(focusRemaining(s, T0 + 10 * MINUTE_MS)).toBe(24 * MINUTE_MS)       // paused: the clock does not move

    s = resumeFocus(s, T0 + 10 * MINUTE_MS)
    expect(s).toMatchObject({ status: 'running', endsAt: T0 + 34 * MINUTE_MS })
    expect(tickFocus(s, T0 + 34 * MINUTE_MS - 1)).toEqual({ state: s, completed: false })

    const end = tickFocus(s, T0 + 34 * MINUTE_MS)
    expect(end.completed).toBe(true)
    expect(end.state).toEqual({ minutes: 25, status: 'done', endsAt: null, remainingMs: 0 })
    expect(tickFocus(end.state, T0 + 40 * MINUTE_MS).completed).toBe(false)
  })

  it('start on a paused timer resumes it; start on a finished one begins a fresh session', () => {
    const paused = pauseFocus(startFocus(initialFocus(15), T0), T0 + 5 * MINUTE_MS)
    expect(startFocus(paused, T0 + 6 * MINUTE_MS)).toMatchObject({ status: 'running', endsAt: T0 + 16 * MINUTE_MS })
    const done = tickFocus(startFocus(initialFocus(15), T0), T0 + 15 * MINUTE_MS).state
    expect(startFocus(done, T0 + 20 * MINUTE_MS)).toMatchObject({ status: 'running', endsAt: T0 + 35 * MINUTE_MS, remainingMs: 15 * MINUTE_MS })
  })

  it('reset returns to the full length of the chosen session', () => {
    const s = startFocus(initialFocus(45), T0)
    expect(resetFocus(pauseFocus(s, T0 + MINUTE_MS))).toEqual(initialFocus(45))
    expect(resetFocus(s)).toEqual(initialFocus(45))
  })

  it('presets and custom lengths apply when not running, within 1–180 minutes', () => {
    expect(setFocusMinutes(initialFocus(), 45)).toEqual(initialFocus(45))
    expect(setFocusMinutes(initialFocus(), 0).minutes).toBe(1)
    expect(setFocusMinutes(initialFocus(), 999).minutes).toBe(FOCUS_MAX_MINUTES)
    expect(setFocusMinutes(initialFocus(), 12.4).minutes).toBe(12)
    expect(setFocusMinutes(initialFocus(), Number.NaN)).toEqual(initialFocus())
    const running = startFocus(initialFocus(), T0)
    expect(setFocusMinutes(running, 15)).toBe(running)                          // pause first
    expect(setFocusMinutes(pauseFocus(running, T0 + 1000), 15)).toEqual(initialFocus(15))
  })

  it('restores a stored timer, and repairs a damaged one', () => {
    const running = startFocus(initialFocus(25), T0)
    expect(restoreFocus(JSON.parse(JSON.stringify(running)))).toEqual(running)
    const paused = pauseFocus(running, T0 + MINUTE_MS)
    expect(restoreFocus(paused)).toEqual(paused)
    expect(restoreFocus(null)).toEqual(initialFocus())
    expect(restoreFocus({ minutes: 'x', status: 'running' })).toEqual(initialFocus())
    expect(restoreFocus({ minutes: 15, status: 'paused', remainingMs: 99 * MINUTE_MS })).toMatchObject({ remainingMs: 15 * MINUTE_MS })
    // a deadline that passed while the page was closed completes on the first tick
    expect(tickFocus(restoreFocus(running), T0 + 26 * MINUTE_MS).completed).toBe(true)
  })

  it('formats the clock for display and for screen readers', () => {
    expect(formatClock(25 * MINUTE_MS)).toBe('25:00')
    expect(formatClock(61_001)).toBe('01:02')
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(90 * MINUTE_MS)).toBe('1:30:00')
    expect(spokenClock(24 * MINUTE_MS + 13_000)).toBe('24 minutes 13 seconds')
    expect(spokenClock(MINUTE_MS)).toBe('1 minute')
    expect(spokenClock(1000)).toBe('1 second')
  })
})
