/* A pausable game clock. The pure functions keep the maths testable; useGameClock drives it while a game is active
   (playing, not paused, page visible), so a hidden tab or the pause button freezes every timer. */
import { useCallback, useEffect, useRef, useState } from 'react'

export interface Clock {
  /** Time banked from earlier running spans. */
  bankedMs: number
  /** When the current running span started (performance.now()), or null while stopped. */
  since: number | null
}

export const newClock = (): Clock => ({ bankedMs: 0, since: null })
export const runClock = (c: Clock, now: number): Clock => (c.since === null ? { ...c, since: now } : c)
export const holdClock = (c: Clock, now: number): Clock => (c.since === null ? c : { bankedMs: c.bankedMs + Math.max(0, now - c.since), since: null })
export const readClock = (c: Clock, now: number): number => c.bankedMs + (c.since === null ? 0 : Math.max(0, now - c.since))
export const remainingMs = (c: Clock, totalMs: number, now: number): number => Math.max(0, totalMs - readClock(c, now))

/** "1:05" from milliseconds. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Elapsed play time that only advances while `active`. With `limitMs`, `onLimit` fires once when it is reached
 * (countdown games); `onTick(elapsedMs, stepMs)` runs on every tick. `reset()` starts a new round at zero.
 */
export function useGameClock(active: boolean, { limitMs, onLimit, onTick, tickMs = 200 }: {
  limitMs?: number
  onLimit?: () => void
  onTick?: (elapsedMs: number, stepMs: number) => void
  tickMs?: number
} = {}) {
  const clockRef = useRef<Clock>(newClock())
  const firedRef = useRef(false)
  const lastRef = useRef(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const onLimitRef = useRef(onLimit)
  const onTickRef = useRef(onTick)
  const activeRef = useRef(active)
  useEffect(() => {
    onLimitRef.current = onLimit
    onTickRef.current = onTick
    activeRef.current = active
  })

  useEffect(() => {
    if (!active) return
    clockRef.current = runClock(clockRef.current, performance.now())
    const id = window.setInterval(() => {
      const elapsed = Math.min(readClock(clockRef.current, performance.now()), limitMs ?? Infinity)
      const step = elapsed - lastRef.current
      lastRef.current = elapsed
      setElapsedMs(elapsed)
      if (step > 0) onTickRef.current?.(elapsed, step)
      if (limitMs !== undefined && elapsed >= limitMs && !firedRef.current) {
        firedRef.current = true
        onLimitRef.current?.()
      }
    }, tickMs)
    return () => {
      window.clearInterval(id)
      clockRef.current = holdClock(clockRef.current, performance.now())
    }
  }, [active, limitMs, tickMs])

  const reset = useCallback(() => {
    // A reset while running keeps running from zero
    clockRef.current = activeRef.current ? runClock(newClock(), performance.now()) : newClock()
    firedRef.current = false
    lastRef.current = 0
    setElapsedMs(0)
  }, [])
  const read = useCallback(() => readClock(clockRef.current, performance.now()), [])

  return { elapsedMs, reset, read }
}
