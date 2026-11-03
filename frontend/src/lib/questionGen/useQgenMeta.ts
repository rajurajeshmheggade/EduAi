import { useEffect, useState } from 'react'
import { errorMessage } from '@/services/apiClient'
import { questionGenService } from '@/services/questionGenService'
import type { QgenMeta } from '@/types/questionGen'

let metaCache: Promise<QgenMeta> | null = null

/** GET /qgen/meta once per page load (types, difficulty, Bloom levels, languages, A/R codes). */
export function useQgenMeta() {
  const [state, setState] = useState<{ data?: QgenMeta; error?: string; loading: boolean }>({ loading: true })
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let live = true
    metaCache ??= questionGenService.meta()
    metaCache.then((data) => { if (live) setState({ data, loading: false }) })
      .catch((e) => { metaCache = null; if (live) setState({ loading: false, error: errorMessage(e) }) })
    return () => { live = false }
  }, [nonce])
  return { ...state, retry: () => { metaCache = null; setState({ loading: true }); setNonce((n) => n + 1) } }
}

export function resetMetaCache() { metaCache = null }
