import { useEffect, useSyncExternalStore } from 'react'

/**
 * App-wide "something is still loading" signal behind the slim progress bar at the top of the shell: a page whose
 * code is downloading (route suspense) or whose first data hasn't arrived yet (useAsync) counts as loading.
 */
let busy = 0
const listeners = new Set<() => void>()
const emit = () => { for (const l of listeners) l() }

/** Marks one loading operation; call the returned function when it ends (safe to call twice). */
export function startLoading(): () => void {
  busy++
  emit()
  let ended = false
  return () => {
    if (ended) return
    ended = true
    busy--
    emit()
  }
}

export function useIsLoading(): boolean {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => busy > 0,
    () => false,
  )
}

/** Counts as loading while `active` is true. */
export function useLoadingSignal(active: boolean): void {
  useEffect(() => (active ? startLoading() : undefined), [active])
}
