import { useCallback, useEffect, useRef, useState } from 'react'
import { useLoadingSignal } from '@/lib/navProgress'
import { errorMessage } from '@/services/apiClient'

/**
 * Load data with loading / error / retry / timeout handled the same way everywhere.
 * `fn` receives an AbortSignal; a call that outlives `timeoutMs` is aborted and reported as an error.
 */
export function useAsync<T>(fn: (signal: AbortSignal) => Promise<T>, deps: unknown[], { timeoutMs = 30_000 }: { timeoutMs?: number } = {}) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true })
  const [nonce, setNonce] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn
  useEffect(() => {
    const ctl = new AbortController()
    // Report the timeout from the timer itself: a request that ignores the signal must not spin forever.
    const t = window.setTimeout(() => {
      ctl.abort()
      setState((s) => ({ data: s.data, loading: false, error: 'The server took too long to respond.' }))
    }, timeoutMs)
    setState((s) => ({ data: s.data, loading: true }))
    fnRef.current(ctl.signal)
      .then((data) => { if (!ctl.signal.aborted) setState({ data, loading: false }) })
      .catch((e) => { if (!ctl.signal.aborted) setState({ loading: false, error: errorMessage(e) }) })
      .finally(() => window.clearTimeout(t))
    return () => { window.clearTimeout(t); ctl.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, timeoutMs])
  const retry = useCallback(() => setNonce((n) => n + 1), [])
  useLoadingSignal(state.loading && state.data === undefined)    // first load: the shell's top progress bar runs
  return { ...state, retry }
}
