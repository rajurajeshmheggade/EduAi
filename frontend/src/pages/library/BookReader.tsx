import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, BookOpen, Download, ExternalLink, Library, ListTree, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { SplitScreenPDFReader } from '@/components/pdf-avatar/SplitScreenPDFReader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { LICENSE_LABEL } from '@/lib/library'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/services/apiClient'
import { libraryService, type BookAccess } from '@/services/libraryService'

const HOME = { student: '/student/library', teacher: '/teacher/library', orgadmin: '/admin-dashboard?tab=library', superadmin: '/admin-dashboard?tab=library' } as const

/**
 * Book reader (FRD §6.3). The server decides the access method; this page never embeds or offers a download
 * the licence does not allow, and always shows the source.
 */
export default function BookReader() {
  const { bookId = '' } = useParams()
  const [params] = useSearchParams()
  const { user } = useAuth()
  const [a, setA] = useState<BookAccess | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [frameFailed, setFrameFailed] = useState(false)
  const back = (params.get('from')?.startsWith('/') ? params.get('from') : null) ?? (user ? HOME[user.role] : '/')
  const org = params.get('org')

  useEffect(() => { libraryService.access(bookId, org).then(setA).catch((e) => setError(errorMessage(e, 'This book could not be opened.'))) }, [bookId, org])

  const hasPages = a?.mode === 'in_app_file' && a.chapters.some((c) => c.page)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-ink-900 px-4 py-3 md:px-6">
        <Link to={back}><Button size="sm" variant="secondary"><ArrowLeft className="h-4 w-4" /> Back to library</Button></Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-lg font-semibold text-fg">{a?.title ?? 'Opening book…'}</h1>
          {a && <p className="truncate text-xs text-ink-500">{a.board_label} · Class {a.class_number} · {a.subject_name} · {a.language}{a.publisher ? ` · ${a.publisher}` : ''}</p>}
        </div>
        {a && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={LICENSE_LABEL[a.license_status].tone}><ShieldCheck className="h-3 w-3" /> {LICENSE_LABEL[a.license_status].label}</Badge>
            {a.download_allowed && a.file_url && (
              <a href={a.file_url} download target="_blank" rel="noopener noreferrer"><Button size="sm" variant="secondary"><Download className="h-3.5 w-3.5" /> Download</Button></a>
            )}
            <a href={a.source_url} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="outline"><ExternalLink className="h-3.5 w-3.5" /> Official source</Button></a>
          </div>
        )}
      </div>

      {error ? (
        <Centered><AlertTriangle className="mx-auto mb-2 h-8 w-8 text-bad" /><p className="font-medium text-fg">{error}</p>
          <p className="mt-1 text-sm text-ink-300">The book may have been unpublished or is not available for your class.</p></Centered>
      ) : !a ? (
        <div className="p-6"><div className="skeleton h-[60vh]" /></div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {a.chapters.length > 0 && a.mode !== 'official_link' && a.mode !== 'unavailable' && (
            <aside aria-label="Chapters" className="hidden w-64 shrink-0 overflow-y-auto border-r border-line bg-ink-900 p-3 lg:block">
              <h2 className="mb-2 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-ink-500"><ListTree className="h-3.5 w-3.5" /> Chapters</h2>
              <ol className="space-y-0.5">
                {a.chapters.map((c, i) => (
                  <li key={i}>
                    <button disabled={!hasPages || !c.page} onClick={() => c.page && setPage(c.page)}
                      className={cn('flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm',
                        hasPages && c.page ? 'cursor-pointer hover:bg-ink-800' : 'cursor-default', c.page && c.page <= page && (a.chapters[i + 1]?.page ?? Infinity) > page ? 'bg-brand-500/10 font-medium text-brand-600' : 'text-ink-100')}>
                      <span className="w-5 shrink-0 text-xs tabular-nums text-ink-500">{i + 1}</span>
                      <span className="flex-1">{c.title}</span>
                      {c.page && <span className="text-xs tabular-nums text-ink-500">p.{c.page}</span>}
                    </button>
                  </li>
                ))}
              </ol>
            </aside>
          )}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {a.mode === 'in_app_file' && a.file_url && (
              <div className="min-h-0 flex-1 bg-ink-800/40"><SplitScreenPDFReader url={a.file_url} page={page} onPageChange={setPage} /></div>
            )}
            {a.mode === 'in_app_embed' && (frameFailed ? (
              <OfficialLink a={a} reason="The source did not allow the page to be shown inside the app." />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <iframe title={a.title} src={a.source_url} className="min-h-0 w-full flex-1 border-0 bg-white" referrerPolicy="no-referrer"
                  sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" onError={() => setFrameFailed(true)} />
                <p className="border-t border-line bg-ink-900 px-4 py-2 text-xs text-ink-500">
                  Not loading? <a className="text-brand-600 hover:underline" href={a.source_url} target="_blank" rel="noopener noreferrer">Open it on {a.source_name}</a>.
                </p>
              </div>
            ))}
            {a.mode === 'official_link' && <OfficialLink a={a} reason="This book is available to read on its official source website." />}
            {a.mode === 'unavailable' && <Centered><BookOpen className="mx-auto mb-2 h-8 w-8 text-ink-500" /><p className="font-medium text-fg">This book is not available right now.</p></Centered>}

            <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-ink-900 px-4 py-2 text-xs text-ink-500">
              <span className="flex items-center gap-1"><Library className="h-3.5 w-3.5" /> Source: <a className="text-brand-600 hover:underline" href={a.source_url} target="_blank" rel="noopener noreferrer">{a.source_name}</a></span>
              {a.license_notice && <span>{a.license_notice}</span>}
              {a.link_status === 'broken' && <span className="text-warn">The official link failed its last check.</span>}
            </footer>
          </div>
        </div>
      )}
    </div>
  )
}

function OfficialLink({ a, reason }: { a: BookAccess; reason: string }) {
  return (
    <Centered>
      <ExternalLink className="mx-auto mb-3 h-9 w-9 text-brand-600" />
      <p className="font-display text-lg font-semibold text-fg">Read “{a.title}” on {a.source_name}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-300">{reason} It opens in a new tab.</p>
      <a href={a.source_url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block"><Button id="open-official"><ExternalLink className="h-4 w-4" /> Open official source</Button></a>
      {a.link_status === 'broken' && <p className="mt-3 text-sm text-warn">The link failed its last check — if it doesn’t open, please tell your teacher.</p>}
    </Centered>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid flex-1 place-items-center p-8"><Card className="max-w-lg p-8 text-center">{children}</Card></div>
}
