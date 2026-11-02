/**
 * "Do not disturb" holds for the study flow (floating Focus Timer, break reminders).
 *
 *   exam    — an exam is running (online test, virtual-lab attempt): nothing may interrupt it. Reminders wait until it
 *             ends, the floating timer hides, ambient sound stops and no chime or toast plays.
 *   session — a classroom session is running (AI Classroom): the floating timer hides and ambient sound stops so it
 *             never covers the tutor's chat or talks over the avatar. The break reminder may still appear: this is
 *             study time, and the session closes normally when the student leaves for the break.
 *
 * Components hold one while they run (`useQuietHold`); the study flow reads the merged state (`useQuiet`).
 */
import { useEffect, useSyncExternalStore } from 'react'

export type QuietKind = 'exam' | 'session'
export interface QuietState { exam: boolean; session: boolean }

const holds = new Map<number, QuietKind>()
const listeners = new Set<() => void>()
let seq = 0
let snapshot: QuietState = { exam: false, session: false }

function emit() {
  const kinds = [...holds.values()]
  snapshot = { exam: kinds.includes('exam'), session: kinds.length > 0 }
  for (const l of listeners) l()
}

/** Hold quiet until the returned release is called. */
export function holdQuiet(kind: QuietKind): () => void {
  const id = ++seq
  holds.set(id, kind)
  emit()
  return () => { if (holds.delete(id)) emit() }
}

export const quietNow = (): QuietState => snapshot

function subscribe(l: () => void) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function useQuiet(): QuietState {
  return useSyncExternalStore(subscribe, quietNow, quietNow)
}

/** Hold quiet while `active`. */
export function useQuietHold(active: boolean, kind: QuietKind) {
  useEffect(() => (active ? holdQuiet(kind) : undefined), [active, kind])
}
