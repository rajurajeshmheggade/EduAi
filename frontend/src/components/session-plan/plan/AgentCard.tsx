import { Download, Eye, FileText, Info, X, type LucideIcon } from 'lucide-react'
import { Overlay } from '@/components/lesson-plan/dialogs'
import { cn } from '@/lib/utils'
import type { AgentItem, AgentStatus } from '@/types/lessonPlan'
import { PlanCard } from './cards'
import { arr, obj, safeUrl, trim, type Tint } from './read'

/* One live agent block (Current Affairs / Video References / Images / Educational Documents). When the agent
   ran and found nothing the card still renders and says so plainly — a teacher should see the block was tried
   and came back empty. Only an agent that never ran (no status) is skipped. */

export type AgentView = 'list' | 'video' | 'gallery' | 'docs'

/** One agent item read defensively — every field of model/search output is optional. */
function itemOf(x: unknown): AgentItem | null {
  const o = obj(x)
  if (!o) return null
  return {
    title: trim(o.title), url: safeUrl(o.url), snippet: trim(o.snippet) || null, source: trim(o.source) || null,
    date: trim(o.date) || null, thumbnail: safeUrl(o.thumbnail) || null,
  }
}

export function AgentCard({ icon, title, tint, items, status, view = 'list', onPreviewDoc, emptyText }: {
  icon: LucideIcon
  title: string
  tint: Tint
  items: unknown
  status: AgentStatus | undefined
  view?: AgentView
  onPreviewDoc?: (d: AgentItem) => void
  emptyText: string
}) {
  const st = obj(status) ?? {}
  const rows = arr(items).map(itemOf).filter((x): x is AgentItem => !!x && !!(x.title || x.url))
  if (rows.length === 0 && (st.status === 'ok' || st.status == null)) return null
  const message = trim(st.message)

  return (
    <PlanCard icon={icon} title={title} tint={tint} subtitle={rows.length ? `${rows.length} item${rows.length === 1 ? '' : 's'}` : ''}>
      {/* When the literal chapter found nothing, the platform searches its theme instead and says so. */}
      {rows.length > 0 && message ? (
        <div className="mb-3 rounded-xl border border-line bg-brand-500/[0.04] px-3 py-2 text-[12.5px] text-ink-500">{message}</div>
      ) : null}
      {rows.length === 0 ? (
        // ONE message, whatever the cause — the plumbing reason stays in the agent status and the log.
        <div className="flex items-start gap-2.5 text-[13.5px] leading-[1.7] text-ink-500">
          <Info className="mt-0.5 h-[15px] w-[15px] shrink-0 text-ink-500/70" aria-hidden="true" /><span>{emptyText}</span>
        </div>
      ) : view === 'video' ? (
        // A thumbnail wall: a teacher recognises the frame before reading the title. A video opens in a new
        // tab — an embedded player shows a broken frame wherever YouTube is unreachable, which reads as our fault.
        <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3.5">
          {rows.map((x, i) => (
            <button key={i} type="button" title={`Play ${x.title}`} disabled={!x.url}
              onClick={() => { if (x.url) window.open(x.url, '_blank', 'noopener,noreferrer') }}
              className="block w-full cursor-pointer overflow-hidden rounded-2xl border border-line bg-ink-900 p-0 text-left transition-[border-color,transform,box-shadow] duration-150 hover:-translate-y-[3px] hover:border-pink-300 hover:shadow-[0_14px_28px_-14px_rgb(219_39_119/.5)] disabled:cursor-default">
              <span className="relative block aspect-video w-full overflow-hidden bg-slate-900">
                {x.thumbnail ? <img src={x.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" className="block h-full w-full object-cover" /> : null}
                <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-transparent from-45% to-black/55" />
                <span aria-hidden="true" className="absolute left-1/2 top-1/2 inline-flex h-[46px] w-[46px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 shadow-[0_6px_18px_-6px_rgb(0_0_0/.55)]">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="#DB2777"><path d="M8 5.5l11 6.5-11 6.5z" /></svg>
                </span>
                {x.source ? <span className="absolute bottom-2 left-2.5 right-2.5 truncate text-[11px] font-medium text-white [text-shadow:0_1px_3px_rgb(0_0_0/.6)]">{x.source}</span> : null}
              </span>
              <span className="block px-3 py-2.5">
                <span className="line-clamp-2 block text-[13px] font-semibold leading-snug text-fg">{x.title}</span>
                {x.date ? <span className="mt-1 block text-[11.5px] text-ink-500">{x.date}</span> : null}
              </span>
            </button>
          ))}
        </div>
      ) : view === 'docs' ? (
        // Study material: a document list with Preview (the PDF inline) / Open.
        <div className="flex flex-col gap-2.5">
          {rows.map((x, i) => {
            const badge = String((x.source || '').split('·')[0] || 'DOC').trim().toUpperCase() || 'DOC'
            const isPdf = /\.pdf(\?|#|$)/i.test(x.url || '') || badge === 'PDF'
            return (
              <div key={i} className="flex items-start gap-3 rounded-2xl border border-line bg-ink-950 px-3.5 py-3">
                <span className={cn('inline-flex h-[50px] w-[42px] shrink-0 flex-col items-center justify-center rounded-[7px] border',
                  isPdf ? 'border-red-200 bg-red-50 text-red-600' : 'border-blue-200 bg-blue-50 text-blue-600')}>
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  <span className="mt-0.5 text-[8.5px] font-bold tracking-[.04em]">{badge.slice(0, 4)}</span>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold leading-normal text-fg">{x.title}</div>
                  {x.snippet ? <div className="mt-0.5 text-[13px] leading-relaxed text-ink-300">{x.snippet}</div> : null}
                  <div className="mt-1 text-xs text-ink-500">{[x.source, x.date].filter(Boolean).join(' · ')}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {isPdf && x.url && (
                      <button type="button" onClick={() => onPreviewDoc?.(x)}
                        className="inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-lg border border-brand-400/40 bg-brand-500/10 px-3 text-[12.5px] font-semibold text-brand-600 hover:bg-brand-500/15">
                        <Eye className="h-[13px] w-[13px]" />Preview
                      </button>
                    )}
                    {x.url && (
                      <a href={x.url} target="_blank" rel="noreferrer noopener"
                        className="inline-flex h-[30px] items-center gap-1.5 rounded-lg border border-line bg-ink-900 px-3 text-[12.5px] font-semibold text-ink-300 no-underline hover:text-fg">
                        <Download className="h-[13px] w-[13px]" />Open
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : view === 'gallery' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {rows.map((x, i) => {
            const src = x.thumbnail || x.url
            if (!src) return null
            return (
              <a key={i} href={x.url || src} target="_blank" rel="noreferrer noopener" title={x.title}
                className="block overflow-hidden rounded-xl border border-line bg-ink-950 no-underline transition-[border-color,transform] duration-150 hover:-translate-y-[3px] hover:border-violet-300">
                <img src={src} alt={x.title || ''} loading="lazy" referrerPolicy="no-referrer" className="block aspect-[4/3] w-full bg-ink-800 object-cover" />
                <span className="block truncate px-2.5 py-2 text-xs text-ink-300">{x.title}</span>
              </a>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((x, i) => (
            <a key={i} href={x.url || undefined} target="_blank" rel="noreferrer noopener"
              className="flex items-start gap-3 rounded-2xl border border-line bg-ink-950 px-3.5 py-3 no-underline transition-colors hover:border-brand-400/50">
              {x.thumbnail ? <img src={x.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-[60px] w-24 shrink-0 rounded-lg bg-ink-800 object-cover" /> : null}
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-normal text-brand-600">{x.title}</span>
                {x.snippet ? <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-300">{x.snippet}</span> : null}
                <span className="mt-1 block text-xs text-ink-500">{[x.source, x.date].filter(Boolean).join(' · ')}</span>
              </span>
            </a>
          ))}
        </div>
      )}
    </PlanCard>
  )
}

/** PDF preview. Remote PDFs can refuse to frame (X-Frame-Options / CSP), so "Open in a new tab" is always offered. */
export function DocPreview({ doc, onClose }: { doc: AgentItem; onClose: () => void }) {
  return (
    <Overlay onClose={onClose} z="z-[400]">
      <div className="glass flex h-[min(88vh,900px)] w-[min(1040px,100%)] flex-col overflow-hidden rounded-2xl" role="dialog" aria-modal="true" aria-label={doc.title || 'Document'}>
        <div className="flex items-center gap-3 border-b border-line bg-gradient-to-b from-brand-500/[0.06] to-transparent px-4 py-3">
          <span className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-red-50 text-red-600"><FileText className="h-[15px] w-[15px]" /></span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold text-fg">{doc.title}</div>
            {doc.source ? <div className="mt-px text-[11.5px] text-ink-500">{doc.source}</div> : null}
          </div>
          <a href={doc.url} target="_blank" rel="noreferrer noopener"
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 text-[12.5px] font-semibold text-ink-300 no-underline hover:text-fg">
            <Download className="h-[13px] w-[13px]" />Open in a new tab
          </a>
          <button type="button" onClick={onClose} aria-label="Close preview" title="Close"
            className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-line bg-ink-900 text-ink-500 hover:text-fg"><X className="h-3.5 w-3.5" /></button>
        </div>
        <div className="min-h-0 flex-1 bg-[#525659]">
          <object data={doc.url} type="application/pdf" width="100%" height="100%" className="block" aria-label={doc.title || 'Document'}>
            <embed src={doc.url} type="application/pdf" width="100%" height="100%" />
            <div className="px-6 py-11 text-center text-[13.5px] leading-[1.7] text-slate-200">
              This document cannot be previewed here — use “Open in a new tab” above.
            </div>
          </object>
        </div>
      </div>
    </Overlay>
  )
}
