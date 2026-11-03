import { useCallback, useEffect, useRef } from 'react'
import { useWellness } from '@/components/wellness/WellnessContext'
import { wellnessService } from '@/services/wellnessService'
import type { ClientActivity } from '@/types/wellness'

/**
 * Reports a client activity for server-side XP without blocking the exercise: the request runs in the background,
 * its result goes through the shared applyXp (header bar, toast, level-up), and failures are only logged so a network
 * blip never interrupts a breathing session or a game.
 * Reports are sent one after another: each result carries the absolute XP total, so a burst of balloon pops must not
 * land out of order and leave the header showing an older total.
 * `settled()` resolves once every report sent so far has finished (used to refresh counters afterwards).
 */
export function useActivityXp() {
  const { applyXp } = useWellness()
  const applyRef = useRef(applyXp)
  useEffect(() => { applyRef.current = applyXp }, [applyXp])
  const chainRef = useRef<Promise<void>>(Promise.resolve())

  const report = useCallback((activity: ClientActivity, taskName: string, details?: string) => {
    chainRef.current = chainRef.current
      .then(() => wellnessService.activity(activity, details?.slice(0, 200)))
      .then((r) => applyRef.current(r, taskName))
      .catch((e: unknown) => console.warn(`[wellness] ${activity} XP was not recorded`, e))
  }, [])

  const settled = useCallback(() => chainRef.current, [])

  return { report, settled }
}
