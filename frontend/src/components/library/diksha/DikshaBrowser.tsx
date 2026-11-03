import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, Eye, Send } from 'lucide-react'
import { ResourceCard, TextbookCard } from '@/components/library/diksha/DikshaCards'
import { DikshaFilters } from '@/components/library/diksha/DikshaFilters'
import { EmptyState, ErrorState, LoadingState } from '@/components/library/diksha/LibraryStates'
import { ResourceViewer } from '@/components/library/diksha/ResourceViewer'
import { TeacherPublishDialog } from '@/components/library/diksha/TeacherPublishDialog'
import { TextbookDetails } from '@/components/library/diksha/TextbookDetails'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/field'
import { errorMessage } from '@/services/apiClient'
import { optionsFor, resolveFilters } from '@/lib/diksha'
import {
  DEFAULT_CONTENT_TYPE, dikshaService, type DikshaFilterOptions, type DikshaItem, type DikshaQuery, type DikshaSearchResult, type DikshaTextbook,
  type PublishSelection,
} from '@/services/dikshaService'
import type { PublishTarget } from '@/services/libraryService'

const PAGE = 24
const targetKey = (t: PublishTarget) => `${t.class_code}|${t.subject_code}`
/** Teacher: search the catalogue (live), open textbooks and chapters, select textbooks or resources, publish to a class.
 *
 * `targets`/`onTargetChange` are only used to render a compact publish-to switcher in the sticky footer when
 * the teacher has more than one eligible class · subject — most teachers have exactly one, so no picker shows. */
export function DikshaBrowser({ target, targets, onTargetChange, onPublished }: {
  target: PublishTarget | null; targets?: PublishTarget[] | null; onTargetChange?: (key: string) => void; onPublished: (msg: string) => void
}) {
  // Board and class default to the admin-set class. When the admin hasn't set them, DikshaFilters shows
  // Board + Class pickers (before Subject) so the teacher can narrow the search manually. DikshaBrowser is
  // remounted (key={target}) by TeacherLibrary whenever the teacher switches target, so this initial state
  // always reflects the current one.
  const [query, setQuery] = useState<DikshaQuery>(() => ({
    content_type: DEFAULT_CONTENT_TYPE, page: 1,
    ...(target?.grade_number && target.grade_number >= 5 ? { class_number: target.grade_number } : {}),
    ...(target?.board ? { board: target.board } : {}),
  }))
  const [options, setOptions] = useState<DikshaFilterOptions | null>(null)
  const [result, setResult] = useState<DikshaSearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Record<string, PublishSelection>>({})
  const [open, setOpen] = useState<{ item: DikshaItem; tree?: DikshaTextbook; error?: string } | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [resolving, setResolving] = useState(false)
  const seq = useRef(0)

  // Options for the first selection; later ones arrive with each change (see `change`).
  useEffect(() => {
    const token = seq.current
    optionsFor(query).then((o) => { if (seq.current === token) setOptions(o) }).catch(() => setOptions(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Board, class, type or subject changed: load the options for the new selection first, then search with the
   * dependent choices that are still valid — one search, no flash of an impossible combination. */
  async function change(next: DikshaQuery) {
    const deps = (q: DikshaQuery) => [q.board ?? '', q.class_number ?? '', q.content_type ?? DEFAULT_CONTENT_TYPE, q.subject ?? ''].join('|')
    if (deps(next) === deps(query)) { setQuery(next); return }
    const token = ++seq.current
    setResolving(true)
    try {
      const r = await resolveFilters(next)
      if (seq.current !== token) return
      setOptions(r.options); setQuery(r.query)
    } catch {
      if (seq.current === token) { setOptions(null); setQuery({ ...next, subject: '', medium: '' }) }
    } finally {
      if (seq.current === token) setResolving(false)
    }
  }

  const load = useCallback(() => {
    setResult(null); setError(null)
    dikshaService.search({ ...query, page_size: PAGE }).then(setResult).catch((e) => setError(errorMessage(e)))
  }, [query])
  useEffect(() => { load() }, [load])

  function openItem(item: DikshaItem) {
    if (item.kind === 'resource') { setOpen({ item }); return }
    setOpen({ item })
    dikshaService.textbook(item.source_id).then((tree) => setOpen({ item, tree })).catch((e) => setOpen({ item, error: errorMessage(e) }))
  }
  const toggle = (sel: PublishSelection) => setSelected((s) => {
    const n = { ...s }
    if (n[sel.source_id]) delete n[sel.source_id]
    else n[sel.source_id] = sel
    return n
  })
  const chosen = Object.values(selected)
  const page = query.page ?? 1
  const total = result?.total ?? 0

  return (
    <>
      {open ? (
        <div className="space-y-4">
          <Button variant="secondary" size="sm" onClick={() => setOpen(null)}><ArrowLeft className="h-4 w-4" /> Back to results</Button>
          {open.item.kind === 'resource' ? (
            <ResourceViewer item={open.item} />
          ) : open.error ? (
            <ErrorState message={open.error} onRetry={() => openItem(open.item)} />
          ) : !open.tree ? (
            <LoadingState rows={2} className="lg:grid-cols-2" label="Loading textbook" />
          ) : (
            <TextbookDetails tree={open.tree} selection={{
              isSelected: (id) => !!selected[id],
              toggleBook: () => toggle({ source_id: open.tree!.book.source_id, item: open.tree!.book }),
              toggleResource: (r) => toggle({ source_id: r.source_id, within: open.tree!.book.source_id, item: r }),
            }} />
          )}
        </div>
      ) : (
        <>
          <Card>
            <CardContent className="space-y-3 pt-5">
              {!target?.board && (
                <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
                  This class has no board set, so results include every supported board. Pick a class and board below to narrow it, or ask your admin to set it (Classes & subjects) to do this automatically.
                </p>
              )}
              <DikshaFilters options={options} value={query} onChange={(q) => void change(q)} busy={resolving} lockBoardClass={!!(target?.grade_number && target?.board)} />
              <p className="text-xs text-ink-500">Live results for NCERT, CBSE and Karnataka State Board, Classes 5–12. Everything opens inside EduAI; only content whose licence allows that is listed, with its credits.</p>
            </CardContent>
          </Card>

          {error ? <ErrorState message={error} onRetry={load} /> : !result ? <LoadingState /> : result.items.length === 0 ? (
            <EmptyState title={result.window_exceeded ? 'No more results can be shown' : 'No Catalogue content matches these filters'}>
              {result.window_exceeded ? 'The Catalogue returns at most 10,000 results per search — narrow the filters or search by title.' : 'Try another content type, subject or language.'}
            </EmptyState>
          ) : (
            <>
              <div className="text-sm text-ink-300">{total.toLocaleString()} result{total === 1 ? '' : 's'} in the Catalogue</div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {result.items.map((it) => {
                  const Card_ = it.kind === 'resource' ? ResourceCard : TextbookCard
                  return (
                    <Card_ key={it.source_id} item={it} selectable selected={!!selected[it.source_id]} onToggle={() => toggle({ source_id: it.source_id, item: it })}
                      footer={<Button size="sm" variant="secondary" onClick={() => openItem(it)} aria-label={`Open ${it.name ?? 'item'}`}>
                        <Eye className="h-3.5 w-3.5" /> {it.kind === 'resource' ? 'Preview' : 'Chapters & resources'}
                      </Button>} />
                  )
                })}
              </div>
              {(page > 1 || page * PAGE < total) && (
                <nav aria-label="Pages" className="flex items-center justify-center gap-2">
                  <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setQuery({ ...query, page: page - 1 })}><ChevronLeft className="h-4 w-4" /> Previous</Button>
                  <span className="text-sm tabular-nums text-ink-300">Page {page} of {Math.max(1, Math.ceil(Math.min(total, 10000) / PAGE))}</span>
                  <Button size="sm" variant="secondary" disabled={page * PAGE >= Math.min(total, 10000)} onClick={() => setQuery({ ...query, page: page + 1 })}>Next <ChevronRight className="h-4 w-4" /></Button>
                </nav>
              )}
            </>
          )}
        </>
      )}

      <div className="sticky bottom-4 z-20 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-ink-900/95 p-3 shadow-xl backdrop-blur">
        <span className="text-sm text-ink-300"><b className="text-fg">{chosen.length}</b> Catalogue item{chosen.length === 1 ? '' : 's'} selected</span>
        {targets && targets.length > 1 ? (
          <Select aria-label="Publish for (class · subject)" className="h-8 w-48" value={target ? targetKey(target) : ''}
            onChange={(e) => onTargetChange?.(e.target.value)}>
            {targets.map((x) => <option key={targetKey(x)} value={targetKey(x)}>{x.class_name} · {x.subject_name}</option>)}
          </Select>
        ) : target ? (
          <span className="text-sm text-ink-300">for <b className="text-fg">{target.class_name} · {target.subject_name}</b></span>
        ) : null}
        {chosen.length > 0 && <button className="cursor-pointer text-sm text-ink-500 hover:text-fg" onClick={() => setSelected({})}>Clear</button>}
        <Button className="ml-auto" id="diksha-publish" disabled={!chosen.length || !target} onClick={() => setPublishing(true)}><Send className="h-4 w-4" /> Publish selected</Button>
      </div>

      {publishing && target && (
        <TeacherPublishDialog selections={chosen} target={target} onClose={() => setPublishing(false)}
          onDone={(msg) => { setPublishing(false); setSelected({}); onPublished(msg); load() }} />
      )}
    </>
  )
}
