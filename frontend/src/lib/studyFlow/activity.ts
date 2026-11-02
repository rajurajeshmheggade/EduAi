/**
 * Is the student actively studying right now? Input (pointer, keys, wheel, touch, scroll) or a "pulse" from a page
 * that is teaching on its own (the avatar tutor speaking) within IDLE_AFTER_MS, in a visible tab.
 */
import { useEffect } from 'react'
import { IDLE_AFTER_MS } from './config'

let lastActivity = 0

export function markStudyActivity(at = Date.now()) {
  if (at > lastActivity) lastActivity = at
}

export const lastStudyActivity = () => lastActivity

/** Tests only. */
export function resetStudyActivity() { lastActivity = 0 }

export function isStudentActive(now = Date.now(), idleMs = IDLE_AFTER_MS): boolean {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false
  return lastActivity > 0 && now - lastActivity <= idleMs
}

const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const

/** Record the student's input while mounted (listeners are passive and capture scrolls inside panes). */
export function trackStudentInput(): () => void {
  const on = () => markStudyActivity()
  for (const e of INPUT_EVENTS) window.addEventListener(e, on, { passive: true, capture: true })
  return () => { for (const e of INPUT_EVENTS) window.removeEventListener(e, on, { capture: true }) }
}

/** While `active` (e.g. the tutor is explaining a page aloud) the student counts as studying even without input. */
export function useStudyPulse(active: boolean, everyMs = 20_000) {
  useEffect(() => {
    if (!active) return
    markStudyActivity()
    const id = window.setInterval(() => markStudyActivity(), everyMs)
    return () => window.clearInterval(id)
  }, [active, everyMs])
}
