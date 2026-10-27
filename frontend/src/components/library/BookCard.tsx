import type { ReactNode } from 'react'
import { BookOpen, CheckCircle2, ExternalLink, Languages, Library } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ACCESS_LABEL, coverClass } from '@/lib/library'
import { cn } from '@/lib/utils'
import type { Book } from '@/services/libraryService'

/**
 * Catalog / library book card. Covers are generated (subject colour + title) — no third-party images are fetched.
 * `selectable` adds a checkbox (teacher selection); `actions` renders the card's buttons.
 */
export function BookCard({ book, selectable, selected, onToggle, actions, footer }: {
  book: Book
  selectable?: boolean
  selected?: boolean
  onToggle?: () => void
  actions?: ReactNode
  footer?: ReactNode
}) {
  const access = ACCESS_LABEL[book.access]
  return (
    <article className={cn('group flex flex-col overflow-hidden rounded-2xl border bg-ink-900 transition-all hover:-translate-y-0.5 hover:shadow-glow',
      selected ? 'border-brand-500 ring-2 ring-brand-400/40' : 'border-line')} aria-label={book.title}>
      <div className={cn('relative flex h-36 flex-col justify-between bg-gradient-to-br p-4 text-white', coverClass(book.subject_name))}>
        <div className="flex items-start justify-between gap-2">
          <span className="rounded-md bg-white/20 px-2 py-0.5 text-[11px] font-semibold backdrop-blur">Class {book.class_number}</span>
          {selectable && (
            <label className="grid h-7 w-7 cursor-pointer place-items-center rounded-lg bg-white/90 shadow" title={selected ? 'Selected' : 'Select'}>
              <input type="checkbox" checked={!!selected} onChange={onToggle} aria-label={`Select ${book.title}`} className="h-4 w-4 cursor-pointer accent-indigo-600" />
            </label>
          )}
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-white/80">{book.subject_name}</div>
          <h3 className="line-clamp-2 font-display text-base font-bold leading-tight text-white">{book.title}</h3>
        </div>
        <BookOpen aria-hidden className="absolute bottom-3 right-3 h-10 w-10 text-white/20" />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="neutral">{book.board_label}</Badge>
          <Badge tone="neutral"><Languages className="h-3 w-3" /> {book.language}</Badge>
          <Badge tone={access.tone} title={access.hint}>{book.access === 'official_link' ? <ExternalLink className="h-3 w-3" /> : <BookOpen className="h-3 w-3" />} {access.label}</Badge>
        </div>
        <dl className="space-y-0.5 text-xs text-ink-500">
          <div className="flex gap-1"><dt className="sr-only">Source</dt><Library className="h-3.5 w-3.5 shrink-0" /><dd className="truncate">{book.source_name}{book.publisher ? ` · ${book.publisher}` : ''}</dd></div>
          {book.academic_year && <div><dt className="inline">Academic year: </dt><dd className="inline">{book.academic_year}</dd></div>}
        </dl>
        {!!book.published_to?.length && (
          <p className="flex items-start gap-1 text-xs font-medium text-ok"><CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" />
            Published to {book.published_to.map((p) => `${p.class_name} · ${p.subject_code}`).join(', ')}</p>
        )}
        {footer}
        {actions && <div className="mt-auto flex flex-wrap gap-2 pt-2">{actions}</div>}
      </div>
    </article>
  )
}
