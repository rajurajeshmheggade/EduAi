import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookUp, Globe2, CheckCircle2, Eye, Library, Loader2, Undo2, X } from 'lucide-react'
import { DikshaBrowser } from '@/components/library/diksha/DikshaBrowser'
import { LibraryEmpty } from '@/components/library/LibraryFilters'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/field'
import { Tabs } from '@/components/ui/tabs'
import { shortDate } from '@/lib/datetime'
import { errorMessage } from '@/services/apiClient'
import { dikshaReaderLink } from '@/services/dikshaService'
import { libraryService, type Publication, type PublishTarget } from '@/services/libraryService'

const key = (t: PublishTarget) => `${t.class_code}|${t.subject_code}`

/** Teacher Digital Library: browse the Catalogue and publish textbooks/resources to a class subject (all open in-app). */
export default function TeacherLibrary() {
  const [tab, setTab] = useState<'diksha' | 'published'>('diksha')
  const [targets, setTargets] = useState<PublishTarget[] | null>(null)
  const [target, setTarget] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pubs, setPubs] = useState<Publication[] | null>(null)

  useEffect(() => {
    libraryService.targets().then((t) => {
      setTargets(t)
      const first = t[0]
      if (first) setTarget(key(first))
    }).catch((e) => setError(errorMessage(e)))
  }, [])

  const loadPubs = useCallback(() => { libraryService.myPublications().then(setPubs).catch((e) => setError(errorMessage(e))) }, [])
  useEffect(() => { loadPubs() }, [loadPubs])

  const t = targets?.find((x) => key(x) === target) ?? null
  const activePubs = pubs?.filter((p) => p.status === 'published').length ?? 0

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4 animate-fade-up">
        <div>
          <p className="flex items-center gap-1.5 text-sm text-ink-300"><Library className="h-4 w-4" /> Digital Library</p>
          <h1 className="mt-1 font-display text-3xl font-bold">Find & publish <span className="text-gradient">books</span></h1>
          <p className="mt-1 text-sm text-ink-300">Choose digital textbooks and resources from the Catalogue, and publish them to your class. Students see them in <b>My Library</b>.</p>
        </div>
        <Tabs items={[{ id: 'diksha', label: 'Catalogue', icon: Globe2 },
          { id: 'published', label: 'Published', icon: BookUp, count: activePubs }]} value={tab} onChange={setTab} />
      </header>

      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      {notice && (
        <p role="status" className="flex items-center gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok">
          <CheckCircle2 className="h-4 w-4 shrink-0" /><span className="flex-1">{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss" className="cursor-pointer"><X className="h-4 w-4" /></button>
        </p>
      )}

      {tab !== 'published' && targets?.length === 0 && (
        <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">You are not assigned to any class subject, so you can't publish yet.</p>
      )}

      {tab === 'diksha' ? (
        <DikshaBrowser key={target} target={t} targets={targets} onTargetChange={setTarget} onPublished={(msg) => { setNotice(msg); loadPubs() }} />
      ) : (
        <PublishedList pubs={pubs} onChanged={loadPubs} onError={setError} />
      )}
    </div>
  )
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
          <LibraryEmpty title={status === 'published' ? 'Nothing published yet' : 'No records'}>Select content in the Catalogue tab and use <b>Publish selected</b>.</LibraryEmpty>
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
                        {p.source === 'diksha' && <Badge tone="aqua">Catalogue</Badge>}
                        {p.source_status === 'unavailable' && <Badge tone="warn">No longer in the Catalogue</Badge>}
                        {p.status === 'published' && p.hidden_from_students && (
                          <Badge tone="warn" title="Its licence is not approved for display inside EduAI, so students do not see it">Hidden from students</Badge>
                        )}
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
