import { FolderOpen, Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PickedResource } from '../resourcesModel'
import { ResourceRow } from './cards'

/* "Picked resources for your lesson" — the tray of rows picked into the stage being edited. A row that was
   just added pulses once and the count badge pops, so a pick from the library on the right reads as landing. */
export function PickedTray({ files, stage, scopeLine, countKey, pulseFrom, onRemove }: {
  files: PickedResource[]
  stage: string
  scopeLine: string
  countKey: number
  pulseFrom: number
  onRemove: (id: string) => void
}) {
  return (
    <div className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
      <div className="flex min-w-0 items-center gap-3 border-b border-line bg-gradient-to-b from-brand-500/[0.06] to-transparent px-4 py-3">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-500/12 text-brand-600"><FolderOpen className="h-3.5 w-3.5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold text-fg">Picked resources for your lesson</span>
          <span className="block truncate text-[11.5px] text-ink-500">{scopeLine}</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5">
          <span className="hidden whitespace-nowrap rounded-full bg-brand-500/12 px-2.5 py-0.5 text-[11.5px] font-medium text-brand-600 sm:inline">{stage}</span>
          <span key={countKey} aria-label={`${files.length} picked`}
            className={cn('inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-600 px-2 text-xs font-semibold text-white shadow-glow', countKey > 0 && 'lp-count')}>
            {files.length}
          </span>
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(170px,1fr))] content-start gap-3 overflow-y-auto p-3.5">
        {files.length === 0 ? (
          <div className="col-span-full flex h-full min-h-[220px] flex-col items-center justify-center gap-3 px-4 py-6 text-center">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-500/12 text-brand-600 shadow-[0_4px_12px_-6px_rgb(79_70_229/.35)]">
              <Inbox className="h-[26px] w-[26px]" strokeWidth={1.8} />
            </span>
            <span className="text-sm font-semibold text-fg">No resources added to this stage yet</span>
            <span className="max-w-[280px] text-[12.5px] leading-relaxed text-ink-500">
              Pick items from the Resource Library — use the <b className="font-semibold text-brand-600">+</b> on any card and it will appear here for <b className="font-semibold text-fg">{stage}</b>.
            </span>
          </div>
        ) : files.map((r, i) => (
          <div key={r.id} className={cn('rounded-2xl', pulseFrom >= 0 && i >= pulseFrom && 'lp-picked')}>
            <ResourceRow r={r} onRemove={() => onRemove(r.id)} />
          </div>
        ))}
      </div>
    </div>
  )
}
