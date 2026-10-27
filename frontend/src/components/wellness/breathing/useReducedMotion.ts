import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

function subscribe(onChange: () => void) {
  const mql = typeof window !== 'undefined' ? window.matchMedia?.(QUERY) : undefined
  mql?.addEventListener?.('change', onChange)
  return () => mql?.removeEventListener?.('change', onChange)
}
const snapshot = () => typeof window !== 'undefined' && !!window.matchMedia?.(QUERY).matches

/** Live `prefers-reduced-motion: reduce` (updates if the student changes the OS setting). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}
