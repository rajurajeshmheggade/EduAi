import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, ExternalLink, Globe2, Library, Search } from 'lucide-react'
import { BookCard } from '@/components/library/BookCard'
import { Credits } from '@/components/library/diksha/Credits'
import { ResourceCard, TextbookCard } from '@/components/library/diksha/DikshaCards'
import { LibraryEmpty } from '@/components/library/LibraryFilters'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input, Label, Select } from '@/components/ui/field'
import { shortDate } from '@/lib/datetime'
import { LIBRARY_EMPTY_STUDENT } from '@/lib/library'
import { errorMessage } from '@/services/apiClient'
import { dikshaReaderLink, type ContentType, type PublishedExternal } from '@/services/dikshaService'
import { libraryService, type StudentBook } from '@/services/libraryService'

type Data = Awaited<ReturnType<typeof libraryService.studentBooks>>

type Filters = { content_type: ContentType | ''; subject: string; language: string; q: string }

/** Student Library: only books teachers published to the student's class for the current academic year. Everything
 * opens inside the app. Choosing a content type narrows the subjects to those that have content of that type. */
export default function StudentLibrary() {
  const nav = useNavigate()
  const [f, setF] = useState<Filters>({ content_type: '', subject: '', language: '', q: '' })
  const [q, setQ] = useState('')
  const [data, setData] = useState<Data | null>(null)
  const [scope, setScope] = useState<{ types: Data['types']; languages: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    let live = true
    libraryService.studentBooks(f).then((d) => {
      if (!live) return
      // A subject without content of the chosen type is dropped (the server lists only subjects that have some).
      if (f.subject && !d.subjects.some((s) => s.subject_code === f.subject)) { setF((x) => ({ ...x, subject: '' })); return }
      setData(d)
      // Types and languages come from the whole library so they don't shrink while filtering.
      setScope((s) => s ?? { types: d.types, languages: d.languages })
    }).catch((e) => { if (live) setError(errorMessage(e)) })
    return () => { live = false }
  }, [f])
  const subjects = data?.subjects ?? []

  function open(b: StudentBook) {
    if (b.access === 'official_link') window.open(b.source_url, '_blank', 'noopener,noreferrer')
    else nav(`/library/read/${b.book_id}?from=/student/library`)
  }
  const filtered = !!(f.content_type || f.subject || f.language || f.q)
  const types = scope?.types.filter((t) => t.count) ?? []

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <header className="animate-fade-up">
        <p className="flex items-center gap-1.5 text-sm text-ink-300"><Library className="h-4 w-4" /> Digital Library</p>
        <h1 className="mt-1 font-display text-3xl font-bold">My <span className="text-gradient">Library</span></h1>
        <div className="mt-2 flex flex-wrap gap-2">
          {data?.class_name && <Badge tone="brand">{data.class_name}</Badge>}
          {data?.year_code && <Badge tone="neutral">Academic year {data.year_code}</Badge>}
          {data && <Badge tone="neutral">{data.books.length + data.external.length} item{data.books.length + data.external.length === 1 ? '' : 's'}{filtered ? ' match' : ''}</Badge>}
        </div>
      </header>

      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      {(scope?.languages.length || types.length > 0) && (
        <Card>
          <CardContent className="space-y-3 pt-5">
            {types.length > 1 && (
              <div role="radiogroup" aria-label="Content type" className="flex flex-wrap gap-1.5">
                {[{ value: '' as const, label: 'All types', count: undefined }, ...types].map((t) => (
                  <button key={t.value} role="radio" aria-checked={f.content_type === t.value} onClick={() => setF({ ...f, content_type: t.value })}
                    className={`cursor-pointer rounded-lg border px-3 py-1 text-sm transition-colors ${f.content_type === t.value ? 'border-brand-400 bg-brand-500/10 font-medium text-brand-600' : 'border-line text-ink-300 hover:text-fg'}`}>
                    {t.label}{t.count != null ? ` (${t.count})` : ''}
                  </button>
                ))}
              </div>
            )}
            <div role="radiogroup" aria-label="Subject" className="flex flex-wrap gap-1.5">
              {[{ subject_code: '', subject_name: 'All subjects' }, ...subjects].map((s) => (
                <button key={s.subject_code} role="radio" aria-checked={f.subject === s.subject_code} onClick={() => setF({ ...f, subject: s.subject_code })}
                  className={`cursor-pointer rounded-full border px-3 py-1 text-sm transition-colors ${f.subject === s.subject_code ? 'border-brand-400 bg-brand-500/10 font-medium text-brand-600' : 'border-line text-ink-300 hover:text-fg'}`}>
                  {s.subject_name}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
              <div><Label htmlFor="sl-lang">Language</Label>
                <Select id="sl-lang" value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}>
                  <option value="">All languages</option>
                  {scope?.languages.map((l) => <option key={l} value={l}>{l}</option>)}
                </Select>
              </div>
              <div><Label htmlFor="sl-q">Search books</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
                  <Input id="sl-q" type="search" className="pl-9" placeholder="Title or subject" value={q} maxLength={100}
                    onChange={(e) => { const v = e.target.value; setQ(v); clearTimeout(timer.current); timer.current = setTimeout(() => setF((x) => ({ ...x, q: v })), 300) }} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton h-80" />)}</div>
      ) : data.books.length + data.external.length === 0 ? (
        filtered ? <LibraryEmpty title="No books match your filters">Try another subject or clear the search.</LibraryEmpty>
          : <LibraryEmpty title="Your library is empty">{LIBRARY_EMPTY_STUDENT}</LibraryEmpty>
      ) : (
        <>
        {data.books.length > 0 && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {data.books.map((b) => (
            <BookCard key={b.book_id} book={b}
              footer={<p className="text-xs text-ink-500">{b.subjects.map((s) => s.subject_name).join(', ')}{b.subjects[0]?.teacher_name ? ` · by ${b.subjects[0].teacher_name}` : ''} · {shortDate(b.published_at)}</p>}
              actions={
                <Button size="sm" className="w-full" disabled={b.access === 'unavailable'} onClick={() => open(b)} aria-label={`Read ${b.title}`}>
                  {b.access === 'official_link' ? <><ExternalLink className="h-3.5 w-3.5" /> Read on official site</> : <><BookOpen className="h-3.5 w-3.5" /> Read book</>}
                </Button>
              } />
          ))}
        </div>}
        {data.external.length > 0 && (
          <section aria-labelledby="dk-h" className="space-y-3">
            <h2 id="dk-h" className="flex items-center gap-2 font-display text-lg font-semibold text-fg"><Globe2 className="h-5 w-5 text-brand-600" /> Textbooks &amp; resources</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {data.external.map((x) => <ExternalCard key={x.source_id} x={x} onOpen={() => nav(dikshaReaderLink(x.source_id, x.kind, { within: x.context?.textbook_id, from: '/student/library' }))} />)}
            </div>
          </section>
        )}
        </>
      )}
    </div>
  )
}

function ExternalCard({ x, onOpen }: { x: PublishedExternal; onOpen: () => void }) {
  const Card_ = x.kind === 'textbook' ? TextbookCard : ResourceCard
  const gone = x.source_status === 'unavailable'
  return (
    <Card_ item={{ ...x.metadata, name: x.name, kind: x.kind }}
      footer={<div className="w-full space-y-2">
        <p className="text-xs text-ink-500">{x.subjects.map((s) => s.subject_name).join(', ')}{x.subjects[0]?.teacher_name ? ` · by ${x.subjects[0].teacher_name}` : ''} · {shortDate(x.published_at)}
          {x.context ? ` · from ${x.context.textbook_name}` : ''}</p>
        <Credits item={x.metadata} compact />
        <Button size="sm" className="w-full" disabled={gone} onClick={onOpen} aria-label={`Open ${x.name}`}>
          {gone ? 'No longer available' : x.kind === 'textbook' ? <><BookOpen className="h-3.5 w-3.5" /> Open textbook</> : <><BookOpen className="h-3.5 w-3.5" /> Open</>}
        </Button>
      </div>} />
  )
}
