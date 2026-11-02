import { createElement, lazy, type ComponentType } from 'react'

/**
 * Route-level code splitting that survives flaky networks and deploys. React.lazy caches a failed import forever, so
 * a page whose download failed once could never load again without a full reload. Here a failed import is retried
 * (with backoff and a timeout); if it still fails because the chunk no longer exists (the app was redeployed while
 * the tab was open), the page reloads once to pick up the new build; otherwise the error reaches the nearest error
 * boundary, whose "Try again" calls `resetFailedImports()` so the import really runs again.
 */
export interface RetryOptions {
  retries?: number
  delayMs?: number
  timeoutMs?: number
  reload?: () => void
}

const RELOAD_KEY = 'eduai.chunk-reload-at'
const RELOAD_GUARD_MS = 60_000
const failed = new Set<() => void>()

export function isChunkLoadError(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e)
  return /dynamically imported module|module script failed|error loading dynamically|loading (css )?chunk|chunkloaderror|unable to preload css/i.test(msg)
}

function reloadedRecently(): boolean {
  try {
    return Date.now() - Number(sessionStorage.getItem(RELOAD_KEY) || 0) < RELOAD_GUARD_MS
  } catch {
    return true          // no session storage: never risk a reload loop
  }
}

function markReload(): void {
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())) } catch { /* storage unavailable */ }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  if (!ms) return p
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Loading this page took too long.')), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

export async function importWithRetry<T>(factory: () => Promise<T>, { retries = 2, delayMs = 500, timeoutMs = 30_000, reload = () => window.location.reload() }: RetryOptions = {}): Promise<T> {
  let last: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(factory(), timeoutMs)
    } catch (e) {
      last = e
      if (attempt < retries) await sleep(delayMs * 2 ** attempt)
    }
  }
  if (isChunkLoadError(last) && !reloadedRecently()) {
    markReload()
    reload()
    return new Promise<T>(() => {})      // the page is reloading
  }
  throw last
}

/** `React.lazy` with retries, a guarded reload for stale chunks, and a reset for error-boundary retries. */
export function lazyWithRetry<P extends object>(factory: () => Promise<{ default: ComponentType<P> }>, options?: RetryOptions): ComponentType<P> {
  const make = () => lazy(() => importWithRetry(factory, options).catch((e) => { failed.add(reset); throw e }))
  let current = make()
  function reset() { current = make() }
  function Retrying(props: P) {
    return createElement(current as ComponentType<P>, props)
  }
  return Retrying
}

/** Error boundaries call this before rendering their children again: pages whose download failed are re-imported. */
export function resetFailedImports(): number {
  const n = failed.size
  for (const reset of failed) reset()
  failed.clear()
  return n
}
