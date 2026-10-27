import { useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { Select } from '@/components/ui/field'
import { cn } from '@/lib/utils'

/* Pagination footer — port of Rapid's shared Pager.jsx: "a–b of N", an optional page-size selector, first /
   previous / sliding window of page numbers / next / last, and a "Go to … / N" box. */

/** A window of up to `max` page numbers that follows the current page; the first and last pages are always
 *  shown, with an ellipsis marker standing in for any gap. 12 pages on page 6 → 1 … 4 5 6 7 8 … 12. */
function pageButtons(cur: number, pages: number, max = 5): (number | '...L' | '...R')[] {
  if (pages <= max) return Array.from({ length: pages }, (_, i) => i + 1)
  const start = Math.max(1, Math.min(cur - Math.floor(max / 2), pages - max + 1))
  const end = start + max - 1
  const out: (number | '...L' | '...R')[] = Array.from({ length: max }, (_, i) => start + i)
  if (start > 1) { if (start > 2) out.unshift('...L'); out.unshift(1) }
  if (end < pages) { if (end < pages - 1) out.push('...R'); out.push(pages) }
  return out
}

const navCls = 'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-ink-900 text-ink-300 transition-colors ' +
  'enabled:cursor-pointer enabled:hover:border-brand-400/60 enabled:hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-40'

/** Jump straight to a page. An entry outside 1…pages is REJECTED and said so (never silently clamped), and
 *  the typed value stays on screen next to the reason so it can be corrected. */
function GoToPage({ cur, pages, onGo }: { cur: number; pages: number; onGo: (n: number) => void }) {
  const [val, setVal] = useState(String(cur))
  const [bad, setBad] = useState(false)
  // Re-seed when the page changes by any other means (a number button, next/prev, a size change).
  const [seenCur, setSeenCur] = useState(cur)
  if (seenCur !== cur) { setSeenCur(cur); setVal(String(cur)); setBad(false) }

  const commit = () => {
    const t = val.trim()
    // Digits only: parseInt would read "2x" as 2 and "" as NaN→1, both of which hide a typo.
    const n = /^\d+$/.test(t) ? parseInt(t, 10) : NaN
    if (!Number.isInteger(n) || n < 1 || n > pages) { setBad(true); return }
    setBad(false)
    if (n !== cur) onGo(n)
  }
  const msg = `Enter a page between 1 and ${pages}`
  return (
    <span className="relative inline-flex items-center">
      {bad && (
        // Sits ABOVE the box: the pager is the last row on the page, so a message below would scroll off.
        <span role="alert" id="session-pager-goto-error"
          className="absolute bottom-full right-0 z-10 mb-2 whitespace-nowrap rounded-lg border border-bad/30 bg-ink-900 px-2.5 py-1 text-xs text-bad shadow-lg">
          {msg}
        </span>
      )}
      <input inputMode="numeric" aria-label="Go to page" value={val}
        aria-invalid={bad || undefined} aria-describedby={bad ? 'session-pager-goto-error' : undefined} title={bad ? msg : undefined}
        onChange={(e) => { setVal(e.target.value); if (bad) setBad(false) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          // Escape abandons the edit and puts the real page back, error and all.
          if (e.key === 'Escape') { setVal(String(cur)); setBad(false) }
        }}
        onBlur={commit}
        className={cn('h-8 w-11 rounded-lg border text-center text-[13.5px] tabular-nums outline-none focus:ring-2 focus:ring-brand-500/30',
          bad ? 'border-bad bg-bad/5 text-bad' : 'border-line bg-ink-900 text-ink-100 focus:border-brand-400/70')} />
    </span>
  )
}

export function Pager({ total, page, size, onPage, onSize, sizeOptions = [9, 18, 36, 72] }: {
  total: number
  page: number
  size: number
  onPage: (n: number) => void
  onSize?: (n: number) => void
  sizeOptions?: number[]
}) {
  const pages = Math.max(1, Math.ceil(total / size))
  const cur = Math.min(Math.max(1, page), pages)
  const from = (cur - 1) * size
  const to = Math.min(cur * size, total)
  // A list that fits the SMALLEST page size has nothing to paginate, so no bar. Above that it STAYS, whatever
  // size is chosen — otherwise picking a big size would remove the very selector needed to go back.
  const smallest = Math.min(...sizeOptions)
  if (pages <= 1 && !(onSize && total > smallest)) return null
  const label = total === 0 ? '0 of 0' : `${from + 1}–${to} of ${total}`
  return (
    <nav aria-label="Sessions pagination" className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-3">
      <div className="flex flex-wrap items-center gap-3.5">
        <span className="text-[12.5px] tabular-nums text-ink-500">{label}</span>
        {onSize && (
          <label className="flex items-center gap-2 text-[12.5px] text-ink-500">
            <span className="whitespace-nowrap">Show</span>
            <Select aria-label="Sessions per page" className="h-8 w-[84px] text-[13px]" value={String(size)}
              onChange={(e) => onSize(parseInt(e.target.value, 10))}>
              {(sizeOptions.includes(size) ? sizeOptions : [size, ...sizeOptions]).map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
            <span className="whitespace-nowrap">per page</span>
          </label>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={navCls} disabled={cur <= 1} onClick={() => onPage(1)} aria-label="First page" title="First page"><ChevronsLeft className="h-4 w-4" /></button>
        <button type="button" className={navCls} disabled={cur <= 1} onClick={() => onPage(cur - 1)} aria-label="Previous page" title="Previous page"><ChevronLeft className="h-4 w-4" /></button>
        {pageButtons(cur, pages).map((n) => (typeof n === 'string'
          ? <span key={n} aria-hidden="true" className="inline-flex h-8 min-w-[26px] select-none items-center justify-center text-sm text-ink-500">…</span>
          : <button key={n} type="button" onClick={() => onPage(n)} aria-label={`Page ${n}`} aria-current={n === cur ? 'page' : undefined}
              className={cn('inline-flex h-8 min-w-8 cursor-pointer items-center justify-center rounded-lg border px-2.5 text-sm font-medium tabular-nums transition-colors',
                n === cur ? 'border-transparent bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-glow'
                  : 'border-line bg-ink-900 text-ink-300 hover:border-brand-400/60 hover:text-brand-600')}>{n}</button>))}
        <button type="button" className={navCls} disabled={cur >= pages} onClick={() => onPage(cur + 1)} aria-label="Next page" title="Next page"><ChevronRight className="h-4 w-4" /></button>
        <button type="button" className={navCls} disabled={cur >= pages} onClick={() => onPage(pages)} aria-label="Last page" title="Last page"><ChevronsRight className="h-4 w-4" /></button>
        {pages > 1 && (
          <>
            <span aria-hidden="true" className="mx-1 h-[22px] w-px bg-line" />
            <span className="whitespace-nowrap text-[12.5px] text-ink-500">Go to</span>
            <GoToPage cur={cur} pages={pages} onGo={onPage} />
            <span className="whitespace-nowrap text-[12.5px] text-ink-500">/ {pages}</span>
          </>
        )}
      </div>
    </nav>
  )
}
