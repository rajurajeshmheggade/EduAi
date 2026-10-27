import { Check, Plus, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LibraryItem } from '@/types/lessonPlan'
import { ResThumb } from '../ResThumb'
import { KINDS, isCardKind, type PickedResource } from '../resourcesModel'
import { fileKind, thumbKind } from './kinds'

/* The three resource cards of Session Resources: a library card (pick it), a picked row (remove it) and the
   Preview modal's tile (launch it). Thumbnails are ResThumb miniatures of the real medium. */

const pill = 'absolute rounded-full bg-white/92 text-[9.5px] font-semibold uppercase tracking-[.05em] shadow-[0_1px_3px_rgb(16_42_84/.12)]'

/** A Resource Library item. The whole card picks it; an item the teacher added themselves (`canDelete`)
 *  also carries a small remove control — a sibling button, never one nested inside the card button. */
export function LibCard({ x, added, onAdd, onDelete }: { x: LibraryItem; added: boolean; onAdd: () => void; onDelete?: () => void }) {
  const k = isCardKind(x.kind) ? KINDS[x.kind] : KINDS.reference
  return (
    <div className="group relative">
      <button type="button" disabled={added} onClick={onAdd} title={`${x.title} — ${k.label}${x.meta ? ' · ' + x.meta : ''}`}
        aria-label={added ? `${x.title} (added)` : `Add ${x.title}`}
        className={cn('flex w-full flex-col overflow-hidden rounded-2xl border bg-ink-900 text-left transition-[border-color,transform,box-shadow] duration-200',
          added ? 'cursor-default border-ok/40 shadow-sm'
            : 'cursor-pointer border-line shadow-sm hover:-translate-y-[3px] hover:border-brand-400/60 hover:shadow-[0_12px_26px_-10px_rgb(79_70_229/.32)]')}>
        <span className={cn('relative block h-24 w-full overflow-hidden', k.tint)}>
          <span className={cn('block h-full w-full transition-transform duration-300', !added && 'group-hover:scale-[1.04]')}>
            <ResThumb kind={x.kind} title={x.title} meta={x.meta} height={96} />
          </span>
          <span className={cn(pill, 'left-2.5 top-2.5 px-2.5 py-[3px]', k.fg)}>{k.label}</span>
          <span className={cn('absolute right-2.5 top-2.5 inline-flex h-[27px] w-[27px] items-center justify-center rounded-full shadow-[0_2px_8px_-2px_rgb(16_42_84/.3)] transition-[background,color,transform] duration-150',
            added ? 'lp-badge-pop bg-ok/15 text-ok' : 'bg-white/92 text-ink-500 group-hover:scale-110 group-hover:bg-brand-500 group-hover:text-white')}>
            {added ? <Check className="h-3 w-3" strokeWidth={2.5} /> : <Plus className="h-3 w-3" strokeWidth={2.5} />}
          </span>
        </span>
        <span className="block w-full border-t border-line px-3 py-2.5">
          <span className="block truncate text-[13px] font-semibold leading-snug text-fg">{x.title}</span>
          <span className="mt-0.5 block truncate text-[11.5px] text-ink-500">{x.meta}</span>
        </span>
      </button>
      {onDelete && (
        <button type="button" onClick={onDelete} aria-label={`Remove ${x.title} from the library`} title="Remove from library"
          className="absolute bottom-[54px] right-2.5 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-white/92 text-ink-500 opacity-80 shadow-[0_2px_6px_-2px_rgb(16_42_84/.25)] transition-colors hover:bg-bad/15 hover:text-bad hover:opacity-100 focus-visible:opacity-100">
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

/** A resource picked into a stage. */
export function ResourceRow({ r, onRemove }: { r: PickedResource; onRemove: () => void }) {
  const k = fileKind(r.name, r.type)
  return (
    <div title={`${r.name} — ${k.label}`}
      className="lp-fly group relative flex flex-col overflow-hidden rounded-2xl border border-line-strong bg-ink-900 shadow-sm transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-[3px] hover:border-brand-400/60 hover:shadow-[0_12px_26px_-12px_rgb(79_70_229/.3)]">
      <span className={cn('relative block h-[118px] w-full overflow-hidden', k.tint)}>
        <span className="block h-full w-full transition-transform duration-300 group-hover:scale-[1.04]">
          <ResThumb kind={thumbKind(r.name, r.type)} title={r.name} meta={r.meta || k.label} height={118} />
        </span>
        <span className={cn(pill, 'left-2 top-2 px-2 py-[3px]', k.fg)}>{k.label}</span>
        <span title="Added" className="lp-badge-pop absolute bottom-2 left-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-green-100/95 text-green-700 shadow-[0_1px_3px_rgb(16_42_84/.12)]">
          <Check className="h-[11px] w-[11px]" strokeWidth={3} />
        </span>
        <button type="button" onClick={onRemove} title="Remove" aria-label={`Remove ${r.name}`}
          className="absolute right-2 top-2 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-white/92 text-ink-500 shadow-[0_2px_6px_-2px_rgb(16_42_84/.25)] transition-colors hover:bg-bad/15 hover:text-bad">
          <X className="h-3 w-3" />
        </button>
      </span>
      <div className="border-t border-line px-3 py-2.5">
        <div className="truncate text-[12.5px] font-semibold leading-snug text-fg">{r.name}</div>
        <div className="mt-0.5 truncate text-[11px] text-ink-500">{r.meta || k.label}</div>
      </div>
    </div>
  )
}

/** A tile in the Preview modal — opens the player on this asset. */
export function PreviewTile({ r, onOpen }: { r: PickedResource; onOpen: () => void }) {
  const k = fileKind(r.name, r.type)
  return (
    <button type="button" title={`Open ${r.name}`} onClick={onOpen}
      className="block w-full cursor-pointer overflow-hidden rounded-xl border border-line bg-ink-900 p-0 text-left transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-brand-400/60 hover:shadow-[0_8px_18px_-10px_rgb(79_70_229/.45)]">
      <ResThumb kind={thumbKind(r.name, r.type)} title={r.name} meta={r.meta || k.label} height={82} />
      <div className="border-t border-line px-3 py-2">
        <div className="truncate text-[12.5px] font-semibold text-fg">{r.name}</div>
        <div className="mt-0.5 text-[11px] text-ink-500">{k.label}</div>
      </div>
    </button>
  )
}
