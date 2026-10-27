import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertTriangle, BookOpen, BookUp, Globe2, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, Eye, Library, Loader2, Send, Undo2, Users, X,
} from 'lucide-react'
import { BookCard } from '@/components/library/BookCard'
import { DikshaBrowser } from '@/components/library/diksha/DikshaBrowser'
import { LibraryEmpty, LibraryFilters } from '@/components/library/LibraryFilters'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Label, Select } from '@/components/ui/field'
import { Tabs } from '@/components/ui/tabs'
import { shortDate } from '@/lib/datetime'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/services/apiClient'
import { dikshaReaderLink } from '@/services/dikshaService'
import { libraryService, type Book, type BookFilters, type LibraryMeta, type Publication, type PublishTarget } from '@/services/libraryService'

const PAGE = 24
const key = (t: PublishTarget) => `${t.class_code}|${t.subject_code}`

/** Teacher Digital Library: search the verified catalog, select, preview and publish books to a class subject. */
export default function TeacherLibrary() {
  const nav = useNavigate()
  const [tab, setTab] = useState<'catalog' | 'diksha' | 'published'>('catalog')
  const [meta, setMeta] = useState<LibraryMeta | null>(null)
  const [targets, setTargets] = useState<PublishTarget[] | null>(null)
  const [target, setTarget] = useState('')
  const [filters, setFilters] = useState<BookFilters>({})
  const [subjects, setSubjects] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<{ books: Book[]; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Record<string, Book>>({})
  const [publishing, setPublishing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [pubs, setPubs] = useState<Publication[] | null>(null)

  useEffect(() => {
    libraryService.meta().then(setMeta).catch((e) => setError(errorMessage(e)))
    libraryService.targets().then((t) => {
      setTargets(t)
      const first = t[0]
      if (first) {
        setTarget(key(first))
        if (first.grade_number) setFilters({ class_number: first.grade_number })
      }
    }).catch((e) => setError(errorMessage(e)))
  }, [])

  useEffect(() => {
    libraryService.subjects(filters.board, filters.class_number).then(setSubjects).catch(() => setSubjects([]))
  }, [filters.board, filters.class_number])

  const loadBooks = useCallback(() => {
    setResult(null); setError(null)
    libraryService.books({ ...filters, page, page_size: PAGE }).then(setResult).catch((e) => setError(errorMessage(e)))
  }, [filters, page])
  useEffect(() => { if (tab === 'catalog') loadBooks() }, [loadBooks, tab])

  const loadPubs = useCallback(() => { libraryService.myPublications().then(setPubs).catch((e) => setError(errorMessage(e))) }, [])
  useEffect(() => { loadPubs() }, [loadPubs])

  const t = targets?.find((x) => key(x) === target) ?? null
  const chosen = Object.values(selected)
  const activePubs = pubs?.filter((p) => p.status === 'published').length ?? 0

  function pickTarget(k: string) {
    setTarget(k)
    const nt = targets?.find((x) => key(x) === k)
    // Follow the class's grade; subject filter only if the catalog uses the same subject name.
    setPage(1)
    setFilters((f) => ({ ...f, class_number: nt?.grade_number ?? f.class_number, subject: nt && subjects.includes(nt.subject_name) ? nt.subject_name : '' }))
  }

  function preview(b: Book) {
    if (b.access === 'official_link') window.open(b.source_url, '_blank', 'noopener,noreferrer')
    else nav(`/library/read/${b.book_id}?from=/teacher/library`)
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4 animate-fade-up">
        <div>
          <p className="flex items-center gap-1.5 text-sm text-ink-300"><Library className="h-4 w-4" /> Digital Library</p>
          <h1 className="mt-1 font-display text-3xl font-bold">Find & publish <span className="text-gradient">books</span></h1>
          <p className="mt-1 text-sm text-ink-300">Choose verified books from your school catalog or digital textbooks and resources from DIKSHA, and publish them to your class. Students see them in <b>My Library</b>.</p>
        </div>
        <Tabs items={[{ id: 'catalog', label: 'School catalog', icon: BookOpen }, { id: 'diksha', label: 'DIKSHA', icon: Globe2 },
          { id: 'published', label: 'Published', icon: BookUp, count: activePubs }]} value={tab} onChange={setTab} />
      </header>

      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      {notice && (
        <p role="status" className="flex items-center gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok">
          <CheckCircle2 className="h-4 w-4 shrink-0" /><span className="flex-1">{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss" className="cursor-pointer"><X className="h-4 w-4" /></button>
        </p>
      )}

      {tab !== 'published' && (
        <Card>
          <CardContent className="pt-5">
              <div className="grid gap-3 md:grid-cols-[1.4fr_1fr] md:items-end">
                <div><Label htmlFor="lib-target">Publish for (class · subject)</Label>
                  <Select id="lib-target" value={target} onChange={(e) => pickTarget(e.target.value)} disabled={!targets?.length}>
                    {!targets?.length && <option value="">You are not assigned to any class subject</option>}
                    {targets?.map((x) => <option key={key(x)} value={key(x)}>{x.class_name} · {x.subject_name}{x.grade_number ? ` (Class ${x.grade_number})` : ''}</option>)}
                  </Select>
                </div>
                {t && (
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge tone="brand">Academic year {t.year_code}</Badge>
                    <Badge tone="neutral"><Users className="h-3 w-3" /> {t.student_count} students</Badge>
                    {t.grade_number ? <Badge tone="ok">Class {t.grade_number}</Badge> : <Badge tone="warn" title="Ask your admin to set the class grade (Classes & subjects) so books are matched automatically">Class grade not set</Badge>}
                  </div>
                )}
              </div>
          </CardContent>
        </Card>
      )}

      {tab === 'diksha' ? (
        <DikshaBrowser key={target} target={t} onPublished={(msg) => { setNotice(msg); loadPubs() }} />
      ) : tab === 'catalog' ? (
        <>
          <Card>
            <CardContent className="space-y-4 pt-5">
              <LibraryFilters meta={meta} value={filters} subjects={subjects} onChange={(f) => { setFilters(f); setPage(1) }} />
            </CardContent>
          </Card>

          {!result ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-80" />)}</div>
          ) : result.books.length === 0 ? (
            <LibraryEmpty title="No verified books match these filters">Try another class, subject or language. Only books verified by your administrator appear here.</LibraryEmpty>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-300">
                <span>{result.total} book{result.total === 1 ? '' : 's'} found</span>
                <button className="cursor-pointer text-brand-600 hover:underline" onClick={() => {
                  const all = result.books.every((b) => selected[b.book_id])
                  setSelected((s) => { const n = { ...s }; result.books.forEach((b) => { if (all) delete n[b.book_id]; else n[b.book_id] = b }); return n })
                }}>{result.books.every((b) => selected[b.book_id]) ? 'Deselect page' : 'Select all on page'}</button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {result.books.map((b) => (
                  <BookCard key={b.book_id} book={b} selectable selected={!!selected[b.book_id]}
                    onToggle={() => setSelected((s) => { const n = { ...s }; if (n[b.book_id]) delete n[b.book_id]; else n[b.book_id] = b; return n })}
                    actions={<>
                      <Button size="sm" variant="secondary" onClick={() => preview(b)} disabled={b.access === 'unavailable'}>
                        {b.access === 'official_link' ? <><ExternalLink className="h-3.5 w-3.5" /> Open source</> : <><Eye className="h-3.5 w-3.5" /> Preview</>}
                      </Button>
                      <Button size="sm" variant={selected[b.book_id] ? 'default' : 'outline'} onClick={() => setSelected((s) => { const n = { ...s }; if (n[b.book_id]) delete n[b.book_id]; else n[b.book_id] = b; return n })}>
                        {selected[b.book_id] ? <><CheckCircle2 className="h-3.5 w-3.5" /> Selected</> : 'Select'}
                      </Button>
                    </>} />
                ))}
              </div>
              {result.total > PAGE && (
                <nav aria-label="Pages" className="flex items-center justify-center gap-2">
                  <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /> Previous</Button>
                  <span className="text-sm tabular-nums text-ink-300">Page {page} of {Math.ceil(result.total / PAGE)}</span>
                  <Button size="sm" variant="secondary" disabled={page * PAGE >= result.total} onClick={() => setPage(page + 1)}>Next <ChevronRight className="h-4 w-4" /></Button>
                </nav>
              )}
            </>
          )}

          <div className="sticky bottom-4 z-20 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-ink-900/95 p-3 shadow-xl backdrop-blur">
            <span className="text-sm text-ink-300"><b className="text-fg">{chosen.length}</b> book{chosen.length === 1 ? '' : 's'} selected{t ? <> for <b className="text-fg">{t.class_name} · {t.subject_name}</b></> : ''}</span>
            {chosen.length > 0 && <button className="cursor-pointer text-sm text-ink-500 hover:text-fg" onClick={() => setSelected({})}>Clear</button>}
            <Button className="ml-auto" id="publish-selected" disabled={!chosen.length || !t} onClick={() => setPublishing(true)}><Send className="h-4 w-4" /> Publish selected</Button>
          </div>
        </>
      ) : (
        <PublishedList pubs={pubs} onChanged={loadPubs} onError={setError} />
      )}

      {publishing && t && (
        <PublishDialog books={chosen} target={t} onClose={() => setPublishing(false)}
          onDone={(msg) => { setPublishing(false); setSelected({}); setNotice(msg); loadPubs(); loadBooks() }} />
      )}
    </div>
  )
}

function PublishDialog({ books, target, onClose, onDone }: { books: Book[]; target: PublishTarget; onClose: () => void; onDone: (msg: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wrongClass = target.grade_number ? books.filter((b) => b.class_number !== target.grade_number) : []
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')
  const otherSubject = books.filter((b) => !norm(target.subject_name).includes(norm(b.subject_name)) && !norm(b.subject_name).includes(norm(target.subject_name)))
  const already = books.filter((b) => b.published_to?.some((p) => p.class_code === target.class_code && p.subject_code === target.subject_code))

  async function confirm() {
    setBusy(true); setError(null)
    try {
      const r = await libraryService.publish({ book_ids: books.map((b) => b.book_id), class_code: target.class_code, subject_code: target.subject_code })
      const parts = []
      if (r.published.length) parts.push(`Published ${r.published.length} book${r.published.length === 1 ? '' : 's'} to ${target.class_name} · ${target.subject_name} (${r.student_count} students).`)
      if (r.already_published.length) parts.push(`${r.already_published.length} already published there — left unchanged.`)
      onDone(parts.join(' '))
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Dialog open onClose={onClose} title="Publish to Student Library" description="Check the summary before publishing." className="w-[min(36rem,calc(100vw-2rem))]">
      <div className="space-y-4 text-sm">
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 rounded-xl bg-ink-800 p-3">
          <dt className="text-ink-500">Class</dt><dd className="font-medium text-fg">{target.class_name}{target.grade_number ? ` (Class ${target.grade_number})` : ''}</dd>
          <dt className="text-ink-500">Subject</dt><dd className="font-medium text-fg">{target.subject_name} <span className="font-mono text-xs text-ink-500">{target.subject_code}</span></dd>
          <dt className="text-ink-500">Academic year</dt><dd className="font-medium text-fg">{target.year_code}</dd>
          <dt className="text-ink-500">Students</dt><dd className="font-medium text-fg">All {target.student_count} students of {target.class_name}</dd>
        </dl>
        <div>
          <div className="mb-1.5 font-medium text-fg">Books ({books.length})</div>
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {books.map((b) => (
              <li key={b.book_id} className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-1.5', wrongClass.includes(b) ? 'border-bad/40 bg-bad/5' : 'border-line')}>
                <BookOpen className="h-4 w-4 shrink-0 text-ink-500" />
                <span className="min-w-0 flex-1 truncate">{b.title}</span>
                <span className="text-xs text-ink-500">Class {b.class_number} · {b.subject_name} · {b.language}</span>
              </li>
            ))}
          </ul>
        </div>
        {wrongClass.length > 0 && <Warn tone="bad">{wrongClass.length} book(s) are not for Class {target.grade_number}. Remove them from the selection to publish.</Warn>}
        {otherSubject.length > 0 && <Warn>{otherSubject.length} book(s) are catalogued under a different subject than {target.subject_name}. Publish only if they are meant as supporting reading.</Warn>}
        {!target.grade_number && <Warn>This class has no grade set, so books cannot be matched to it automatically. Check the class of each book.</Warn>}
        {already.length > 0 && <Warn>{already.length} book(s) are already published here and will be left unchanged.</Warn>}
        {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-bad">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={confirm} disabled={busy || wrongClass.length > 0} id="confirm-publish">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Publish {books.length} book{books.length === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function Warn({ tone = 'warn', children }: { tone?: 'warn' | 'bad'; children: React.ReactNode }) {
  return <p className={cn('flex items-start gap-2 rounded-lg px-3 py-2', tone === 'bad' ? 'bg-bad/10 text-bad' : 'bg-warn/10 text-warn')}><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{children}</p>
}

function PublishedList({ pubs, onChanged, onError }: { pubs: Publication[] | null; onChanged: () => void; onError: (e: string) => void }) {
  const [status, setStatus] = useState<'published' | 'unpublished' | ''>('published')
  const [busy, setBusy] = useState<string | null>(null)
  const rows = useMemo(() => pubs?.filter((p) => !status || p.status === status) ?? null, [pubs, status])

  async function unpublish(p: Publication) {
    if (!confirm(`Unpublish “${p.title}” from ${p.class_name} · ${p.class_subject_name ?? p.subject_code}? Students will no longer see it. The catalog record is not deleted.`)) return
    setBusy(p.publication_id)
    try { await libraryService.unpublish(p.publication_id); onChanged() } catch (e) { onError(errorMessage(e)) } finally { setBusy(null) }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-300">Books published to the classes and subjects you teach.</p>
          <Select aria-label="Status" className="h-9 w-40" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="published">Published</option><option value="unpublished">Unpublished</option><option value="">All</option>
          </Select>
        </div>
        {!rows ? <div className="skeleton h-40" /> : rows.length === 0 ? (
          <LibraryEmpty title={status === 'published' ? 'Nothing published yet' : 'No records'}>Select books in the Catalog tab and use <b>Publish selected</b>.</LibraryEmpty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-500">
                <th className="py-2 pr-3 font-medium">Book</th><th className="py-2 pr-3 font-medium">Class · subject</th><th className="py-2 pr-3 font-medium">Year</th>
                <th className="py-2 pr-3 font-medium">Status</th><th className="py-2 pr-3 font-medium">By</th><th className="py-2 pr-3 font-medium">Date</th><th />
              </tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.publication_id} className="border-b border-line last:border-0">
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-1.5 font-medium text-fg">{p.title}
                        {p.source === 'diksha' && <Badge tone="aqua">DIKSHA</Badge>}
                        {p.source_status === 'unavailable' && <Badge tone="warn">No longer on DIKSHA</Badge>}
                      </div>
                      <div className="text-xs text-ink-500">{[p.class_number ? `Class ${p.class_number}` : null, p.subject_name, p.language,
                        p.source_context ? `from ${p.source_context.textbook_name}` : null].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="py-2.5 pr-3">{p.class_name} · {p.class_subject_name ?? p.subject_code}</td>
                    <td className="py-2.5 pr-3 tabular-nums">{p.year_code}</td>
                    <td className="py-2.5 pr-3"><Badge tone={p.status === 'published' ? 'ok' : 'neutral'}>{p.status === 'published' ? 'Published' : 'Unpublished'}</Badge></td>
                    <td className="py-2.5 pr-3 text-ink-300">{p.teacher_name ?? p.teacher_code}</td>
                    <td className="py-2.5 pr-3 text-ink-300">{shortDate(p.status === 'published' ? p.published_at : p.unpublished_at)}</td>
                    <td className="py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        <Link to={p.source === 'diksha' && p.source_id
                          ? dikshaReaderLink(p.source_id, p.source_kind ?? 'textbook', { within: p.source_context?.textbook_id, from: '/teacher/library' })
                          : `/library/read/${p.book_id}?from=/teacher/library`}><Button size="sm" variant="ghost"><Eye className="h-3.5 w-3.5" /> Open</Button></Link>
                        {p.can_unpublish && (
                          <Button size="sm" variant="secondary" disabled={busy === p.publication_id} onClick={() => unpublish(p)}>
                            {busy === p.publication_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />} Unpublish
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
