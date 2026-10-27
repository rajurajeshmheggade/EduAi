import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, Eye, Send } from 'lucide-react'
import { ResourceCard, TextbookCard } from '@/components/library/diksha/DikshaCards'
import { DikshaFilters } from '@/components/library/diksha/DikshaFilters'
import { EmptyState, ErrorState, LoadingState } from '@/components/library/diksha/LibraryStates'
import { ResourceViewer } from '@/components/library/diksha/ResourceViewer'
import { TeacherPublishDialog } from '@/components/library/diksha/TeacherPublishDialog'
import { TextbookDetails } from '@/components/library/diksha/TextbookDetails'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { errorMessage } from '@/services/apiClient'
import {
  dikshaService, type DikshaFilterOptions, type DikshaItem, type DikshaQuery, type DikshaSearchResult, type DikshaTextbook, type PublishSelection,
} from '@/services/dikshaService'
import type { PublishTarget } from '@/services/libraryService'

const PAGE = 24

/** Teacher: search DIKSHA (live), open textbooks and chapters, select textbooks or resources, publish to a class. */
export function DikshaBrowser({ target, onPublished }: { target: PublishTarget | null; onPublished: (msg: string) => void }) {
  const [query, setQuery] = useState<DikshaQuery>(() => ({
    content_type: 'Digital Textbook', page: 1,
    ...(target?.grade_number && target.grade_number >= 5 ? { class_number: target.grade_number } : {}),
  }))
  const [options, setOptions] = useState<DikshaFilterOptions | null>(null)
  const [result, setResult] = useState<DikshaSearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Record<string, PublishSelection>>({})
  const [open, setOpen] = useState<{ item: DikshaItem; tree?: DikshaTextbook; error?: string } | null>(null)
  const [publishing, setPublishing] = useState(false)

  useEffect(() => {
    dikshaService.filters({ board: query.board, class_number: query.class_number, content_type: query.content_type })
      .then(setOptions).catch(() => setOptions(null))
  }, [query.board, query.class_number, query.content_type])

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
              <DikshaFilters options={options} value={query} onChange={setQuery} />
              <p className="text-xs text-ink-500">Live results from DIKSHA (NCERT, CBSE and Karnataka State Board, Classes 5–12). Content stays on DIKSHA; publishing shares a link with your students.</p>
            </CardContent>
          </Card>

          {error ? <ErrorState message={error} onRetry={load} /> : !result ? <LoadingState /> : result.items.length === 0 ? (
            <EmptyState title={result.window_exceeded ? 'No more results can be shown' : 'No DIKSHA content matches these filters'}>
              {result.window_exceeded ? 'DIKSHA returns at most 10,000 results per search — narrow the filters or search by title.' : 'Try another class, subject or language.'}
            </EmptyState>
          ) : (
            <>
              <div className="text-sm text-ink-300">{total.toLocaleString()} result{total === 1 ? '' : 's'} on DIKSHA</div>
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
        <span className="text-sm text-ink-300"><b className="text-fg">{chosen.length}</b> DIKSHA item{chosen.length === 1 ? '' : 's'} selected{target ? <> for <b className="text-fg">{target.class_name} · {target.subject_name}</b></> : ''}</span>
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
