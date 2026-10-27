import { Library, Loader2, PanelRightClose, PanelRightOpen, Plus, Search, TriangleAlert } from 'lucide-react'
import { ASSET_TYPES } from '@/components/lesson-plan/data'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/field'
import { cn } from '@/lib/utils'
import type { AssetType, LibraryItem, LibraryResponse } from '@/types/lessonPlan'
import { LibCard } from './cards'
import { ASSET_ICON } from './kinds'

/* The Resource Library rail (right of the picked tray): collapsible, sticky on wide screens. Asset-type
   select with its count, search, the browsed chapter with Change, "+ Add" (EduAI has no separate Learning
   Resources screen), then the chapter groups of library cards — or whichever state is true right now. */

export interface LibSel { chapterId: string; chapter: string }

export function LibraryPanel({
  open, onToggle, assetType, onAssetType, count, q, onQ, sel, scopeOk, scopeLine, currentChapter,
  lib, busy, err, onRetry, onBrowse, onAdd, isAdded, onPick, onDeleteItem,
}: {
  open: boolean
  onToggle: () => void
  assetType: AssetType
  onAssetType: (t: AssetType) => void
  /** Count for the selected type, or null when the server has not said. */
  count: number | null
  q: string
  onQ: (q: string) => void
  sel: LibSel | null
  scopeOk: boolean
  scopeLine: string
  currentChapter: string
  lib: LibraryResponse
  busy: boolean
  err: string
  onRetry: () => void
  onBrowse: () => void
  onAdd: () => void
  isAdded: (x: LibraryItem) => boolean
  onPick: (x: LibraryItem) => void
  onDeleteItem: (x: LibraryItem) => void
}) {
  const total = lib.total
  const TypeIcon = ASSET_ICON[assetType]

  if (!open) {
    return (
      <div className="glass w-full overflow-hidden rounded-2xl min-[1100px]:sticky min-[1100px]:top-3">
        <button type="button" onClick={onToggle} title="Open resource library" aria-label="Open resource library" aria-expanded={false}
          className="flex w-full cursor-pointer flex-row items-center justify-center gap-2.5 px-0 py-3.5 transition-colors hover:bg-ink-800 min-[1100px]:w-14 min-[1100px]:flex-col">
          <span className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-brand-500/12 text-brand-600"><Library className="h-4 w-4" /></span>
          <span className="rounded-full bg-brand-500/12 px-2 py-0.5 text-[11px] font-semibold text-brand-600">{total}</span>
          <span className="text-[11.5px] font-medium tracking-[.05em] text-ink-500 min-[1100px]:[writing-mode:vertical-rl]">Resource Library</span>
          <PanelRightOpen className="h-3.5 w-3.5 text-ink-500" />
        </button>
      </div>
    )
  }

  return (
    <div className="glass flex w-full flex-col overflow-hidden rounded-2xl min-[1100px]:sticky min-[1100px]:top-3 min-[1100px]:max-h-[calc(100vh-1.5rem)]">
      <div className="flex flex-col gap-3 border-b border-line bg-gradient-to-b from-brand-500/[0.06] to-transparent px-4 pb-3 pt-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-auto inline-flex items-center gap-2 whitespace-nowrap text-[14.5px] font-semibold text-fg">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500/12 text-brand-600"><Library className="h-3.5 w-3.5" /></span>
            Resource Library
            <span className="rounded-full bg-brand-500/12 px-2.5 py-0.5 text-xs font-semibold text-brand-600">{total}</span>
          </span>
          <Button size="sm" variant="outline" onClick={onAdd} disabled={!scopeOk} title="Add a link or a file to this class and subject’s library">
            <Plus className="h-3.5 w-3.5" />Add resource
          </Button>
          <button type="button" onClick={onToggle} title="Collapse library" aria-label="Collapse library" aria-expanded
            className="inline-flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-lg border border-line bg-ink-900 text-ink-500 transition-colors hover:border-brand-400/60 hover:text-brand-600">
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[11.5px] font-semibold uppercase tracking-[.05em] text-ink-500">Type</span>
          <div className="relative min-w-[200px] max-w-[280px] flex-1">
            <TypeIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
            <Select aria-label="Asset type" className="pl-9" value={assetType} onChange={(e) => onAssetType(e.target.value as AssetType)}>
              {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </div>
          <span className="inline-flex h-7 items-baseline gap-1 whitespace-nowrap rounded-full bg-brand-500/12 px-3 pt-[5px] text-brand-600">
            <b className="text-[13.5px] font-bold tabular-nums">{count == null ? '—' : count}</b>
            <span className="text-[11.5px] font-medium opacity-85">items</span>
          </span>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
          <Input aria-label="Search the resource library" value={q} onChange={(e) => onQ(e.target.value)} disabled={!sel} className="pl-9"
            placeholder={sel ? `Search ${total} resources…` : 'Browse a class and subject first…'} />
        </div>
        {sel && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11.5px] text-ink-500">{[scopeLine, sel.chapter || 'All chapters'].filter(Boolean).join(' · ')}</span>
            <button type="button" onClick={onBrowse}
              className="h-6 cursor-pointer rounded-full border border-line bg-ink-900 px-2.5 text-[11.5px] font-medium text-brand-600 hover:border-brand-400/60">Change</button>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-ink-950 px-4 pb-4 pt-3.5 shadow-[inset_0_8px_10px_-8px_rgb(16_42_84/.10)]">
        {!scopeOk ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="inline-flex h-[46px] w-[46px] items-center justify-center rounded-[13px] bg-warn/12 text-warn"><Search className="h-5 w-5" /></span>
            <span className="text-[13px] font-semibold text-fg">Browse a class and subject first</span>
            <span className="max-w-[280px] text-[12.5px] leading-relaxed text-ink-500">
              This lesson plan isn’t linked to a class and subject you teach, so its resource library can’t be loaded.
              You can still create the session — or recreate the plan from one of your assigned classes to pick resources.
            </span>
          </div>
        ) : !sel ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <span className="inline-flex h-[46px] w-[46px] items-center justify-center rounded-[13px] bg-brand-500/12 text-brand-600"><Search className="h-5 w-5" /></span>
            <span className="max-w-[260px] text-center text-[13px] leading-normal text-ink-500">Choose a class, subject and chapter to load {assetType.toLowerCase()}</span>
            <Button onClick={onBrowse}><Search className="h-3.5 w-3.5" />Browse</Button>
          </div>
        ) : busy ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-7 w-7 animate-spin text-brand-500" />
            <span className="text-[12.5px] text-ink-500">Loading {assetType.toLowerCase()}…</span>
          </div>
        ) : err ? (
          <div className="flex flex-col items-center gap-2.5 py-6 text-center">
            <span className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-bad/12 text-bad"><TriangleAlert className="h-[19px] w-[19px]" /></span>
            <span className="max-w-[280px] text-[12.5px] leading-normal text-bad">{err}</span>
            <Button size="sm" variant="secondary" onClick={onRetry}>Try again</Button>
          </div>
        ) : lib.groups.length === 0 ? (
          <div className="py-5 text-center text-[12.5px] leading-relaxed text-ink-500">
            {q ? `No resources match “${q}”` : `No ${assetType.toLowerCase()} have been added for this selection yet.`}
          </div>
        ) : lib.groups.map((g, gi) => (
          <div key={g.chapter} className={cn('flex flex-col gap-2.5 py-3.5', gi > 0 ? 'border-t border-line' : 'pt-0.5')}>
            <div className="flex items-center gap-2">
              <span className={cn('whitespace-nowrap text-[11.5px] font-semibold uppercase tracking-[.04em]', g.chapter === currentChapter ? 'text-brand-600' : 'text-ink-500')}>
                {g.chapter}{g.chapter === currentChapter ? ' · current' : ''}
              </span>
              <span className="h-px flex-1 bg-line" />
              <span className="rounded-full bg-ink-800 px-2 py-px text-[11.5px] font-semibold text-ink-500">{g.items.length}</span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
              {g.items.map((x) => <LibCard key={`${x.sourceKind}-${x.resourceId}`} x={x} added={isAdded(x)} onAdd={() => onPick(x)}
                onDelete={x.canDelete ? () => onDeleteItem(x) : undefined} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
