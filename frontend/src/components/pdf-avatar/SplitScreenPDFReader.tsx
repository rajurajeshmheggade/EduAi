import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/TextLayer.css'
import { ChevronLeft, ChevronRight, Loader2, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Left pane of the split-screen classroom: textbook PDF with page control and cited-passage highlighting. */
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

      <div ref={box} className="min-h-0 flex-1 overflow-auto p-4">
        {error ? (
          <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 p-3 text-sm text-bad">{error}</p>
        ) : (
          <Document
            file={url}
            onLoadSuccess={(d) => setPages(d.numPages)}
            onLoadError={(e) => setError(`Could not load the textbook: ${e.message}`)}
            loading={<div className="grid place-items-center py-24 text-ink-300"><Loader2 className="h-6 w-6 animate-spin" /></div>}
          >
            <Page pageNumber={page} width={Math.floor(width * zoom)} customTextRenderer={customTextRenderer} renderAnnotationLayer={false}
              loading={<div className="skeleton h-[60vh] w-full" />} />
          </Document>
        )}
      </div>
    </div>
  )
}
