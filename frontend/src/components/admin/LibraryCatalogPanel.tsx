import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  BookOpen, CheckCircle2, Download, Eye, FileUp, History, Link2, Loader2, Pencil, Plus, ShieldAlert, Trash2, Upload, XCircle,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { LibraryEmpty, LibraryFilters } from '@/components/library/LibraryFilters'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label, Select, Textarea } from '@/components/ui/field'
import { Tabs } from '@/components/ui/tabs'
import { shortDate, shortDateTime } from '@/lib/datetime'
import { ACCESS_LABEL, LICENSE_LABEL, VERIFY_LABEL } from '@/lib/library'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/services/apiClient'
import { downloadBlob } from '@/services/classroomService'
import { dikshaService } from '@/services/dikshaService'
import { libraryService, type Book, type BookBody, type BookFilters, type LibraryMeta, type Publication } from '@/services/libraryService'

const CSV_TEMPLATE = 'board,class_number,subject_name,language,title,academic_year,publisher,source_name,source_url,access_mode,license_status,license_notice,in_app_reader_allowed,download_allowed,verification_status\n'

/** Admin: the approved book catalog (verified metadata + permissions) and the publication audit log. */
export function LibraryCatalogPanel({ org }: { org?: string | null }) {
  const [tab, setTab] = useState<'catalog' | 'log'>('catalog')
  return (
    <div className="space-y-4">
      <Tabs items={[{ id: 'catalog', label: 'Book catalog', icon: BookOpen }, { id: 'log', label: 'Publishing log', icon: History }]} value={tab} onChange={setTab} />
      {tab === 'catalog' ? <Catalog org={org} /> : <PublishLog org={org} />}
    </div>
  )
}

function Catalog({ org }: { org?: string | null }) {
  const { user } = useAuth()
  const isSuper = user?.role === 'superadmin'
  const [meta, setMeta] = useState<LibraryMeta | null>(null)
  const [filters, setFilters] = useState<BookFilters>({})
  const [status, setStatus] = useState('')
  const [scope, setScope] = useState<'all' | 'platform' | 'institution'>('all')
  const [subjects, setSubjects] = useState<string[]>([])
  const [data, setData] = useState<{ books: Book[]; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Book | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => { libraryService.meta().then(setMeta).catch((e) => setError(errorMessage(e))) }, [])
  useEffect(() => { libraryService.subjects(filters.board, filters.class_number, org).then(setSubjects).catch(() => setSubjects([])) }, [filters.board, filters.class_number, org])
  const load = useCallback(() => {
    libraryService.books({ ...filters, verification_status: status, scope, page_size: 100 }, org).then(setData).catch((e) => setError(errorMessage(e)))
  }, [filters, status, scope, org])
  useEffect(() => { load() }, [load])

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id); setError(null)
    try { await fn(); load() } catch (e) { setError(errorMessage(e)) } finally { setBusy(null) }
  }
  const canEdit = (b: Book) => b.scope === 'institution' || isSuper
  const pending = data?.books.filter((b) => b.verification_status === 'pending').length ?? 0

  return (
    <>
      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-sm text-ink-300">Only <b>verified</b>, active records are visible to teachers. Record the official source and the licence for every book — in-app reading and downloads are enabled only when the licence allows it.</p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setImporting(true)}><Upload className="h-4 w-4" /> Import CSV</Button>
              <Button onClick={() => setEditing('new')} id="add-book"><Plus className="h-4 w-4" /> Add book</Button>
            </div>
          </div>
          <LibraryFilters meta={meta} value={filters} subjects={subjects} onChange={setFilters} />
          <div className="flex flex-wrap items-center gap-3">
            <Select aria-label="Verification status" className="h-9 w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option><option value="verified">Verified</option><option value="pending">Pending review</option><option value="rejected">Rejected</option>
            </Select>
            <Select aria-label="Catalog scope" className="h-9 w-48" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
              <option value="all">Platform + institution</option><option value="platform">Platform catalog</option><option value="institution">This institution only</option>
            </Select>
            {pending > 0 && <Badge tone="warn">{pending} pending review</Badge>}
            {data && <span className="text-sm text-ink-500">{data.total} record{data.total === 1 ? '' : 's'}</span>}
          </div>
        </CardContent>
      </Card>

      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      {!data ? <div className="skeleton h-64" /> : data.books.length === 0 ? (
        <LibraryEmpty title="No catalog records">Add verified books from official sources (for example the NCERT or Karnataka textbook portals) with <b>Add book</b> or <b>Import CSV</b>.</LibraryEmpty>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-500">
                <th className="px-4 py-2.5 font-medium">Book</th><th className="px-3 py-2.5 font-medium">Status</th><th className="px-3 py-2.5 font-medium">Access</th>
                <th className="px-3 py-2.5 font-medium">Source link</th><th className="px-3 py-2.5 font-medium">Copy</th><th className="px-3 py-2.5 text-right font-medium">Published</th><th />
              </tr></thead>
              <tbody>
                {data.books.map((b) => (
                  <tr key={b.book_id} className={cn('border-b border-line align-top last:border-0', !b.is_active && 'opacity-60')}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-fg">{b.title}</div>
                      <div className="text-xs text-ink-500">{b.board_label} · Class {b.class_number} · {b.subject_name} · {b.language}{b.academic_year ? ` · ${b.academic_year}` : ''}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge tone={b.scope === 'platform' ? 'brand' : 'neutral'}>{b.scope === 'platform' ? 'Platform' : 'Institution'}</Badge>
                        {!b.is_active && <Badge tone="neutral">Inactive</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={VERIFY_LABEL[b.verification_status].tone}>{VERIFY_LABEL[b.verification_status].label}</Badge>
                        <Badge tone={LICENSE_LABEL[b.license_status].tone}>{LICENSE_LABEL[b.license_status].label}</Badge>
                      </div>
                    </td>
                    <td className="px-3 py-3"><Badge tone={ACCESS_LABEL[b.access].tone} title={ACCESS_LABEL[b.access].hint}>{ACCESS_LABEL[b.access].label}</Badge>
                      {b.download_allowed && b.access === 'in_app_file' && <div className="mt-1 text-xs text-ink-500">Download allowed</div>}</td>
                    <td className="px-3 py-3">
                      <a href={b.source_url} target="_blank" rel="noopener noreferrer" className="block max-w-56 truncate text-xs text-brand-600 hover:underline" title={b.source_url}>{b.source_name}</a>
                      <div className="mt-1 flex items-center gap-1.5 text-xs">
                        {b.link_status === 'ok' ? <span className="flex items-center gap-1 text-ok"><CheckCircle2 className="h-3 w-3" /> Reachable</span>
                          : b.link_status === 'broken' ? <span className="flex items-center gap-1 text-bad"><XCircle className="h-3 w-3" /> Broken</span>
                          : <span className="text-ink-500">Not checked</span>}
                        {canEdit(b) && <button className="cursor-pointer text-brand-600 hover:underline disabled:opacity-50" disabled={busy === b.book_id} onClick={() => act(b.book_id, () => libraryService.checkLink(b.book_id, org))}>{busy === b.book_id ? 'Checking…' : 'Check'}</button>}
                      </div>
                      {b.last_verified_at && <div className="text-[11px] text-ink-500">Verified {shortDate(b.last_verified_at)}</div>}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {b.has_file ? (
                        <div className="flex flex-col items-start gap-1">
                          <span className="text-ok">PDF hosted{b.file_bytes ? ` · ${b.file_bytes < 1048576 ? `${Math.max(1, Math.round(b.file_bytes / 1024))} KB` : `${(b.file_bytes / 1048576).toFixed(1)} MB`}` : ''}</span>
                          {canEdit(b) && <button className="cursor-pointer text-bad hover:underline" onClick={() => { if (confirm('Remove the hosted copy? Readers will use the source link instead.')) void act(b.book_id, () => libraryService.removeFile(b.book_id, org)) }}>Remove</button>}
                        </div>
                      ) : b.license_status === 'verified' && b.in_app_reader_allowed && canEdit(b) ? (
                        <label className="inline-flex cursor-pointer items-center gap-1 text-brand-600 hover:underline">
                          <FileUp className="h-3.5 w-3.5" /> Upload PDF
                          <input type="file" accept="application/pdf" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void act(b.book_id, () => libraryService.uploadFile(b.book_id, f, org)); e.target.value = '' }} />
                        </label>
                      ) : <span className="flex items-center gap-1 text-ink-500" title="Hosting needs a verified licence with in-app reading allowed"><ShieldAlert className="h-3.5 w-3.5" /> Not permitted</span>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{b.active_publications ?? 0}</td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-1">
                        <Link to={`/library/read/${b.book_id}?from=${encodeURIComponent('/admin-dashboard?tab=library')}${org ? `&org=${org}` : ''}`} title="Preview"><Button size="icon" variant="ghost" aria-label={`Preview ${b.title}`}><Eye className="h-4 w-4" /></Button></Link>
                        {canEdit(b) && <>
                          {b.verification_status !== 'verified' && <Button size="sm" variant="secondary" disabled={busy === b.book_id} onClick={() => act(b.book_id, () => libraryService.updateBook(b.book_id, { verification_status: 'verified' }, org))}><CheckCircle2 className="h-3.5 w-3.5" /> Verify</Button>}
                          <Button size="icon" variant="ghost" aria-label={`Edit ${b.title}`} onClick={() => setEditing(b)}><Pencil className="h-4 w-4" /></Button>
                        </>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {editing && meta && <BookForm meta={meta} book={editing === 'new' ? null : editing} isSuper={isSuper} org={org} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
      {importing && <ImportDialog isSuper={isSuper} org={org} onClose={() => setImporting(false)} onDone={load} />}
    </>
  )
}

const EMPTY: BookBody = {
  board: 'NCERT_CBSE', class_number: 1, subject_name: '', language: 'English', title: '', academic_year: null, publisher: null,
  source_name: '', source_url: 'https://', access_mode: 'official_link', license_status: 'unknown', license_notice: null,
  in_app_reader_allowed: false, download_allowed: false, verification_status: 'pending', chapters: [], is_active: true,
}

function BookForm({ meta, book, isSuper, org, onClose, onSaved }: { meta: LibraryMeta; book: Book | null; isSuper: boolean; org?: string | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<BookBody>(() => (book ? { ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, book[k as keyof Book]])) } as BookBody : EMPTY))
  const [chapters, setChapters] = useState(() => (book?.chapters ?? []).map((c) => (c.page ? `${c.title} | ${c.page}` : c.title)).join('\n'))
  const [scope, setScope] = useState<'institution' | 'platform'>('institution')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [subjectOptions, setSubjectOptions] = useState<string[]>([])
  useEffect(() => { libraryService.subjects(undefined, f.class_number, org).then(setSubjectOptions).catch(() => setSubjectOptions([])) }, [f.class_number, org])
  const set = <K extends keyof BookBody>(k: K, v: BookBody[K]) => setF((x) => ({ ...x, [k]: v }))
  const inAppPossible = f.license_status === 'verified'

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const parsed = chapters.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const m = /^(.*?)\s*\|\s*(\d+)\s*$/.exec(l)
      return m ? { title: m[1], page: Number(m[2]) } : { title: l, page: null }
    })
    const body: BookBody = {
      ...f, chapters: parsed, academic_year: f.academic_year || null, publisher: f.publisher || null, license_notice: f.license_notice || null,
      in_app_reader_allowed: inAppPossible && f.in_app_reader_allowed, download_allowed: inAppPossible && f.in_app_reader_allowed && f.download_allowed,
      access_mode: inAppPossible && f.in_app_reader_allowed ? f.access_mode : 'official_link',
    }
    try {
      if (book) await libraryService.updateBook(book.book_id, body, org)
      else await libraryService.createBook({ ...body, scope }, org)
      onSaved()
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  return (
    <Dialog open onClose={onClose} title={book ? 'Edit catalog record' : 'Add a verified book'} description="Use only real books from official sources. Do not invent titles or links." className="w-[min(46rem,calc(100vw-2rem))]">
      <form onSubmit={submit} className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label htmlFor="bf-title">Book title</Label><Input id="bf-title" required maxLength={300} value={f.title} onChange={(e) => set('title', e.target.value)} /></div>
          <div><Label htmlFor="bf-board">Board</Label><Select id="bf-board" value={f.board} onChange={(e) => set('board', e.target.value as BookBody['board'])}>{meta.boards.map((b) => <option key={b.code} value={b.code}>{b.label}</option>)}</Select></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="bf-class">Class</Label><Select id="bf-class" value={f.class_number} onChange={(e) => set('class_number', Number(e.target.value))}>{meta.classes.map((c) => <option key={c} value={c}>{c}</option>)}</Select></div>
            <div><Label htmlFor="bf-lang">Language</Label><Select id="bf-lang" value={f.language} onChange={(e) => set('language', e.target.value as BookBody['language'])}>{meta.languages.map((l) => <option key={l}>{l}</option>)}</Select></div>
          </div>
          <div><Label htmlFor="bf-subject">Subject</Label><Input id="bf-subject" required maxLength={120} placeholder="Choose or type a subject" list="bf-subject-options" autoComplete="off" value={f.subject_name} onChange={(e) => set('subject_name', e.target.value)} />
            <datalist id="bf-subject-options">{subjectOptions.map((s) => <option key={s} value={s} />)}</datalist></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="bf-year">Academic year</Label><Input id="bf-year" maxLength={32} placeholder="2026-27" value={f.academic_year ?? ''} onChange={(e) => set('academic_year', e.target.value)} /></div>
            <div><Label htmlFor="bf-pub">Publisher</Label><Input id="bf-pub" maxLength={200} value={f.publisher ?? ''} onChange={(e) => set('publisher', e.target.value)} /></div>
          </div>
          <div><Label htmlFor="bf-sname">Source name</Label><Input id="bf-sname" required maxLength={200} placeholder="Official textbook portal" value={f.source_name} onChange={(e) => set('source_name', e.target.value)} /></div>
          <div><Label htmlFor="bf-surl">Official source URL (https)</Label><Input id="bf-surl" required type="url" pattern="https://.+" maxLength={2000} value={f.source_url} onChange={(e) => set('source_url', e.target.value)} /></div>
        </div>

        <fieldset className="space-y-3 rounded-xl border border-line p-3">
          <legend className="px-1 text-sm font-medium text-fg">Permissions</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="bf-lic">Licence status</Label>
              <Select id="bf-lic" value={f.license_status} onChange={(e) => set('license_status', e.target.value as BookBody['license_status'])}>
                {Object.entries(meta.license_statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </div>
            <div><Label htmlFor="bf-ver">Catalog review</Label>
              <Select id="bf-ver" value={f.verification_status} onChange={(e) => set('verification_status', e.target.value as BookBody['verification_status'])}>
                {Object.entries(meta.verification_statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </div>
          </div>
          <label className={cn('flex items-start gap-2 text-sm', !inAppPossible && 'opacity-50')}>
            <input type="checkbox" disabled={!inAppPossible} checked={inAppPossible && f.in_app_reader_allowed}
              onChange={(e) => { set('in_app_reader_allowed', e.target.checked); set('access_mode', e.target.checked ? 'in_app_reader' : 'official_link') }} className="mt-0.5" />
            <span><b>In-app reading permitted</b> — the licence allows embedding or hosting this book in our reader.</span>
          </label>
          <label className={cn('flex items-start gap-2 text-sm', !(inAppPossible && f.in_app_reader_allowed) && 'opacity-50')}>
            <input type="checkbox" disabled={!(inAppPossible && f.in_app_reader_allowed)} checked={inAppPossible && f.in_app_reader_allowed && f.download_allowed}
              onChange={(e) => set('download_allowed', e.target.checked)} className="mt-0.5" />
            <span><b>Download permitted</b> — students may save a copy of the hosted PDF.</span>
          </label>
          {!inAppPossible && <p className="text-xs text-ink-500">Without a verified licence the book is offered as an official-source link only.</p>}
          <div><Label htmlFor="bf-notice">Licence / attribution notice (shown to readers)</Label>
            <Textarea id="bf-notice" rows={2} maxLength={2000} value={f.license_notice ?? ''} onChange={(e) => set('license_notice', e.target.value)} />
          </div>
        </fieldset>

        <div><Label htmlFor="bf-ch">Chapters (optional) — one per line, add “| page” for in-app navigation</Label>
          <Textarea id="bf-ch" rows={4} className="font-mono text-xs" placeholder={'Chemical Reactions and Equations | 1\nAcids, Bases and Salts | 17'} value={chapters} onChange={(e) => setChapters(e.target.value)} />
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_active} onChange={(e) => set('is_active', e.target.checked)} /> Active (available in the catalog)</label>
          {!book && isSuper && (
            <Select aria-label="Catalog scope" className="h-9 w-56" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
              <option value="institution">This institution only</option><option value="platform">Platform catalog (all institutions)</option>
            </Select>
          )}
        </div>

        {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          {book && (
            <Button type="button" variant="ghost" className="mr-auto text-bad" disabled={busy} onClick={async () => {
              if (!confirm(`Delete “${book.title}” from the catalog? Books with publishing history cannot be deleted — mark them inactive instead.`)) return
              setBusy(true); setError(null)
              try { await libraryService.deleteBook(book.book_id, org); onSaved() } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
            }}><Trash2 className="h-4 w-4" /> Delete</Button>
          )}
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy} id="save-book">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {book ? 'Save changes' : 'Add to catalog'}</Button>
        </div>
      </form>
    </Dialog>
  )
}

function ImportDialog({ isSuper, org, onClose, onDone }: { isSuper: boolean; org?: string | null; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('')
  const [scope, setScope] = useState<'institution' | 'platform'>('institution')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<{ created: number; skipped_existing: number; errors: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true); setError(null)
    try { setRes(await libraryService.importCsv(text, scope, org)); onDone() } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <Dialog open onClose={onClose} title="Import catalog records (CSV)" description="Board, class (1–12), subject, language, title, source name and https source URL are required." className="w-[min(42rem,calc(100vw-2rem))]">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => downloadBlob(new Blob([CSV_TEMPLATE], { type: 'text/csv' }), 'library-catalog-template.csv')}><Download className="h-3.5 w-3.5" /> Template</Button>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-ink-800">
            <FileUp className="h-3.5 w-3.5" /> Choose CSV file
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()) }} />
          </label>
          {isSuper && (
            <Select aria-label="Import scope" className="h-9 w-56" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
              <option value="institution">This institution only</option><option value="platform">Platform catalog</option>
            </Select>
          )}
        </div>
        <Textarea aria-label="CSV content" rows={8} className="font-mono text-xs" placeholder={CSV_TEMPLATE} value={text} onChange={(e) => setText(e.target.value)} />
        <p className="text-xs text-ink-500">Rows default to <b>Pending review</b> and <b>official link</b> unless the CSV says otherwise. Existing records (same board, class, language and title) are skipped.</p>
        {res && (
          <div role="status" className="rounded-lg bg-ink-800 p-3 text-sm">
            <b className="text-ok">{res.created} added</b> · {res.skipped_existing} already in catalog{res.errors.length ? ` · ${res.errors.length} rejected` : ''}
            {res.errors.length > 0 && <ul className="mt-2 max-h-32 list-disc overflow-y-auto pl-5 text-xs text-bad">{res.errors.map((er) => <li key={er}>{er}</li>)}</ul>}
          </div>
        )}
        {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={run} disabled={busy || !text.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Import</Button>
        </div>
      </div>
    </Dialog>
  )
}

function PublishLog({ org }: { org?: string | null }) {
  const [rows, setRows] = useState<Publication[] | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState<{ busy: boolean; msg?: string }>({ busy: false })
  useEffect(() => { libraryService.publications(org, status).then(setRows).catch((e) => setError(errorMessage(e))) }, [org, status])

  async function refreshDiksha() {
    setRefresh({ busy: true })
    try {
      const r = await dikshaService.refresh(org)
      setRefresh({ busy: false, msg: `Checked ${r.checked} DIKSHA item(s): ${r.updated} updated, ${r.unavailable} no longer on DIKSHA${r.failed ? `, ${r.failed} could not be reached` : ''}.` })
      libraryService.publications(org, status).then(setRows).catch(() => {})
    } catch (e) { setRefresh({ busy: false, msg: errorMessage(e) }) }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-300">Every publish and unpublish, with who did it and when.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" disabled={refresh.busy} onClick={refreshDiksha} title="Re-read metadata of published DIKSHA items older than the refresh window">
              {refresh.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5" />} Refresh DIKSHA metadata
            </Button>
            <Select aria-label="Status" className="h-9 w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option><option value="published">Published</option><option value="unpublished">Unpublished</option>
            </Select>
          </div>
        </div>
        {refresh.msg && <p role="status" className="rounded-lg bg-ink-800 px-3 py-2 text-sm text-ink-100">{refresh.msg}</p>}
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        {!rows ? <div className="skeleton h-40" /> : rows.length === 0 ? <LibraryEmpty title="No publishing activity yet" /> : (
          <ul className="divide-y divide-line">
            {rows.map((p) => (
              <li key={p.publication_id} className="flex flex-wrap items-start gap-3 py-3">
                <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 font-medium text-fg">{p.title}
                    {p.source === 'diksha' && <Badge tone="aqua">DIKSHA</Badge>}
                    {p.source_status === 'unavailable' && <Badge tone="warn">No longer on DIKSHA</Badge>}
                  </div>
                  <div className="text-xs text-ink-500">{p.class_name} · {p.class_subject_name ?? p.subject_code} · {p.year_code}{p.source_context ? ` · from ${p.source_context.textbook_name}` : ''}</div>
                  <ol className="mt-1.5 space-y-0.5 text-xs text-ink-300">
                    {p.events?.map((e, i) => (
                      <li key={i} className="flex items-center gap-1.5">
                        {e.action === 'unpublished' ? <Trash2 className="h-3 w-3 text-bad" /> : <CheckCircle2 className="h-3 w-3 text-ok" />}
                        <span className="capitalize">{e.action}</span> by {e.actor_name ?? e.actor_code} · {shortDateTime(e.created_at)}
                      </li>
                    ))}
                  </ol>
                </div>
                <Badge tone={p.status === 'published' ? 'ok' : 'neutral'}>{p.status === 'published' ? 'Published' : 'Unpublished'}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
