import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/TextLayer.css'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorState, PageLoader, Skeleton } from '@/components/ui/loading'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Left pane of the split-screen classroom: textbook PDF with page control and cited-passage highlighting. The next
 * page is rendered ahead, out of sight, so turning to it is instant. */
export function SplitScreenPDFReader({ url, page, onPageChange, highlight }: {
  url: string
  page: number
  onPageChange: (p: number) => void
  /** Snippet of the cited chunk; matching text spans on the page are highlighted. */
  highlight?: string | null
}) {
  const [pages, setPages] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(600)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!box.current) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e.contentRect.width - 32))))
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [])

  useEffect(() => { box.current?.scrollTo({ top: 0, behavior: 'smooth' }) }, [page])

  const hl = useMemo(() => (highlight ? ` ${norm(highlight)} ` : null), [highlight])
  const customTextRenderer = useCallback(({ str }: { str: string }) => {
    const n = norm(str)
    return hl && n.length >= 4 && hl.includes(` ${n} `) ? `<mark>${str}</mark>` : str
  }, [hl])

  const go = (p: number) => onPageChange(Math.min(Math.max(1, p), pages || 1))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => go(page - 1)} disabled={page <= 1} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
          <span className="min-w-24 text-center text-sm tabular-nums text-ink-300" id="pdf-page-indicator">Page <b className="text-fg">{page}</b> / {pages || '–'}</span>
          <Button variant="ghost" size="icon" onClick={() => go(page + 1)} disabled={!pages || page >= pages} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.15).toFixed(2)))} aria-label="Zoom out"><ZoomOut className="h-4 w-4" /></Button>
          <span className="w-10 text-center text-xs text-ink-500">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon" onClick={() => setZoom((z) => Math.min(2, +(z + 0.15).toFixed(2)))} aria-label="Zoom in"><ZoomIn className="h-4 w-4" /></Button>
        </div>
      </div>

      <div ref={box} className="relative min-h-0 flex-1 overflow-auto p-4">
        {error ? (
          <ErrorState title="Could not load the textbook" message={error} onRetry={() => { setError(null); setAttempt((n) => n + 1) }} />
        ) : (
          <Document
            key={attempt}
            file={url}
            onLoadSuccess={(d) => setPages(d.numPages)}
            onLoadError={(e) => setError(e.message)}
            loading={<PageLoader message="Opening the textbook…" className="min-h-[60vh]" />}
          >
            {[page, page + 1].filter((p) => p === page || p <= pages).map((p) => (
              // Same key when the next page becomes the current one: its canvas is reused, not drawn again.
              <div key={p} aria-hidden={p !== page || undefined}
                className={p === page ? undefined : 'pointer-events-none invisible absolute inset-x-4 top-4 h-0 overflow-hidden'}>
                <Page pageNumber={p} width={Math.floor(width * zoom)} customTextRenderer={p === page ? customTextRenderer : undefined}
                  renderAnnotationLayer={false} loading={<Skeleton className="h-[60vh] w-full" />} />
              </div>
            ))}
          </Document>
        )}
      </div>
    </div>
  )
}
