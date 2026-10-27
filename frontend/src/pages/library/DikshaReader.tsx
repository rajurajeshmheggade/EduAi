import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Globe2 } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ErrorState, LoadingState } from '@/components/library/diksha/LibraryStates'
import { ResourceViewer } from '@/components/library/diksha/ResourceViewer'
import { TextbookDetails } from '@/components/library/diksha/TextbookDetails'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/services/apiClient'
import { dikshaService, type DikshaItem, type DikshaTextbook } from '@/services/dikshaService'

const HOME = { student: '/student/library', teacher: '/teacher/library', orgadmin: '/admin-dashboard?tab=library', superadmin: '/admin-dashboard?tab=library' } as const

/**
 * DIKSHA textbook / resource reader inside the LMS. The server checks that a student may open the item (published to
 * their class, or part of a published textbook) and decides the permitted viewer for every resource.
 */
export default function DikshaReader() {
  const { sourceId = '' } = useParams()
  const [params] = useSearchParams()
  const { user } = useAuth()
  const kind = params.get('kind') === 'resource' ? 'resource' : 'textbook'
  const within = params.get('within')
  const back = (params.get('from')?.startsWith('/') ? params.get('from') : null) ?? (user ? HOME[user.role] : '/')
  const [tree, setTree] = useState<DikshaTextbook | null>(null)
  const [item, setItem] = useState<DikshaItem | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null); setTree(null); setItem(null)
    const p = kind === 'resource' ? dikshaService.resource(sourceId, within).then(setItem) : dikshaService.textbook(sourceId).then(setTree)
    p.catch((e) => setError(errorMessage(e, 'This item could not be opened.')))
  }, [kind, sourceId, within])
  useEffect(() => { load() }, [load])

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-8">
      <div className="flex flex-wrap items-center gap-3">
        <Link to={back}><Button size="sm" variant="secondary"><ArrowLeft className="h-4 w-4" /> Back to library</Button></Link>
        <span className="inline-flex items-center gap-1.5 text-sm text-ink-500"><Globe2 className="h-4 w-4" /> DIKSHA digital library</span>
      </div>
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : kind === 'resource' ? (
        item ? <ResourceViewer item={item} /> : <LoadingState rows={1} className="lg:grid-cols-1" label="Loading resource" />
      ) : tree ? (
        <TextbookDetails tree={tree} initialResource={params.get('resource')} />
      ) : (
        <LoadingState rows={2} className="lg:grid-cols-2" label="Loading textbook" />
      )}
    </div>
  )
}
