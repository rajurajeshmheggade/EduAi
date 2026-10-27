import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { BALLOON_COLORS, MAX_SPEED_PX_S, MIN_SPEED_PX_S, OFFSCREEN_PX, SPAWN_EVERY_MS, pick } from './content'

export interface Balloon {
  id: number
  x: number
  /** Starting top offset: the arena's bottom edge, or a fixed spot when motion is reduced. */
  y0: number
  size: number
  /** Rise speed, px per second. */
  speed: number
  text: string
  color: { light: string; deep: string }
  bornAt: number
  /** How long the balloon stays in the arena (the time a rising one takes to float away). */
  lifeMs: number
}

/**
 * The floating worry balloons. The list (spawned / popped / gone) is React state; the per-frame rise is written
 * straight to each balloon's transform from one requestAnimationFrame loop, so the game does not re-render 60 times a
 * second. With reduced motion the balloons do not travel: each appears at a random spot and fades in, then leaves
 * after the time it would have taken to float away.
 */
export function useBalloonField({ playing, thoughts, reducedMotion, arenaRef }: {
  playing: boolean
  /** Worry texts for the balloons (memoised by the caller so the frame loop is not restarted). */
  thoughts: readonly string[]
  reducedMotion: boolean
  arenaRef: RefObject<HTMLDivElement | null>
}) {
  const listRef = useRef<Balloon[]>([])
  const [balloons, setBalloons] = useState<Balloon[]>([])
  const yRef = useRef(new Map<number, number>())
  const elsRef = useRef(new Map<number, HTMLElement>())
  const idRef = useRef(0)

  const update = useCallback((fn: (prev: Balloon[]) => Balloon[]) => {
    listRef.current = fn(listRef.current)
    setBalloons(listRef.current)
  }, [])

  /** Takes balloons out; if one of them had keyboard focus, focus returns to the arena instead of being lost. */
  const remove = useCallback((ids: number[]) => {
    const active = document.activeElement
    const hadFocus = !!active && ids.some((id) => !!elsRef.current.get(id)?.contains(active))
    for (const id of ids) yRef.current.delete(id)
    update((prev) => prev.filter((b) => !ids.includes(b.id)))
    if (hadFocus) arenaRef.current?.focus({ preventScroll: true })
  }, [arenaRef, update])

  const clear = useCallback(() => {
    yRef.current.clear()
    update(() => [])
  }, [update])

  const register = useCallback((id: number, el: HTMLElement | null) => {
    if (el) elsRef.current.set(id, el)
    else elsRef.current.delete(id)
  }, [])

  const elementOf = useCallback((id: number) => elsRef.current.get(id) ?? null, [])

  /** The balloon closest to escaping: the highest one (the oldest when balloons do not move). */
  const mostUrgent = useCallback((): Balloon | undefined => {
    let best: Balloon | undefined
    let bestKey = Infinity
    for (const b of listRef.current) {
      const key = reducedMotion ? b.bornAt : (yRef.current.get(b.id) ?? b.y0)
      if (key < bestKey) {
        bestKey = key
        best = b
      }
    }
    return best
  }, [reducedMotion])

  useEffect(() => {
    if (!playing) return
    const spawn = () => {
      const arena = arenaRef.current
      if (!arena || document.hidden) return // no pile-up while the browser tab is in the background
      const width = arena.clientWidth
      const height = arena.clientHeight
      const size = Math.random() * 20 + 80
      const speed = MIN_SPEED_PX_S + Math.random() * (MAX_SPEED_PX_S - MIN_SPEED_PX_S)
      const balloon: Balloon = {
        id: idRef.current++,
        x: Math.random() * Math.max(0, width - 120) + 10,
        y0: reducedMotion ? 10 + Math.random() * Math.max(0, height - size * 1.2 - 30) : height,
        size,
        speed,
        text: pick(thoughts),
        color: pick(BALLOON_COLORS),
        bornAt: performance.now(),
        lifeMs: ((height + OFFSCREEN_PX) / speed) * 1000,
      }
      update((prev) => [...prev, balloon])
    }

    let last = performance.now()
    let raf = 0
    const frame = (now: number) => {
      // Clamp the step so a frame after a pause (hidden tab) does not teleport the balloons
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000))
      last = now
      const gone: number[] = []
      for (const b of listRef.current) {
        if (reducedMotion) {
          if (now - b.bornAt >= b.lifeMs) gone.push(b.id)
          continue
        }
        const y = (yRef.current.get(b.id) ?? b.y0) - b.speed * dt
        yRef.current.set(b.id, y)
        const el = elsRef.current.get(b.id)
        if (el) el.style.transform = `translate3d(${b.x}px, ${y}px, 0)`
        if (y <= -OFFSCREEN_PX) gone.push(b.id)
      }
      if (gone.length) remove(gone)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    const spawner = window.setInterval(spawn, SPAWN_EVERY_MS)
    return () => {
      cancelAnimationFrame(raf)
      window.clearInterval(spawner)
    }
  }, [playing, thoughts, reducedMotion, arenaRef, update, remove])

  return { balloons, register, remove, clear, elementOf, mostUrgent }
}
