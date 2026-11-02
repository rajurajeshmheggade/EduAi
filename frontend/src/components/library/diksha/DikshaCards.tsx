import { useState, type ReactNode } from 'react'
import { BookOpen, CheckCircle2, Layers, PlayCircle, ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { boardText, classText, RESOURCE_LABEL, VIEWER_LABEL } from '@/lib/diksha'
import { coverClass } from '@/lib/library'
import { cn } from '@/lib/utils'
import type { DikshaItem } from '@/services/dikshaService'

type CardItem = Pick<DikshaItem, 'source_id' | 'name' | 'cover_url' | 'subjects' | 'classes' | 'boards' | 'mediums' | 'license' | 'kind'
  | 'resource_type' | 'primary_category' | 'leaf_count' | 'organisation'> & Partial<Pick<DikshaItem, 'access' | 'permissions' | 'published_to'>>

function Cover({ item }: { item: CardItem }) {
  const [broken, setBroken] = useState(false)
  const subject = item.subjects[0] ?? item.primary_category ?? 'Library'
  return (
    <div className={cn('relative h-36 overflow-hidden bg-gradient-to-br', coverClass(subject))}>
      {item.cover_url && !broken && (
        <img src={item.cover_url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)}
          className="absolute inset-0 h-full w-full object-cover" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-3 text-white">
        <div className="text-[11px] font-medium uppercase tracking-wide text-white/85">{subject}</div>
        <h3 className="line-clamp-2 font-display text-sm font-bold leading-tight text-white">{item.name ?? 'Untitled'}</h3>
      </div>
      {classText(item.classes) && <span className="absolute left-3 top-3 rounded-md bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-fg shadow-sm">{classText(item.classes)}</span>}
    </div>
  )
}

function Shell({ item, selectable, selected, onToggle, children, footer }: {
  item: CardItem; selectable?: boolean; selected?: boolean; onToggle?: () => void; children: ReactNode; footer?: ReactNode
}) {
  const ineligible = item.permissions && !item.permissions.eligible
  return (
    <article aria-label={item.name ?? item.source_id} className={cn('group relative flex flex-col overflow-hidden rounded-2xl border bg-ink-900 transition-all hover:-translate-y-0.5 hover:shadow-glow',
      selected ? 'border-brand-500 ring-2 ring-brand-400/40' : 'border-line')}>
      <Cover item={item} />
      {selectable && (
        <label className="absolute right-3 top-3 grid h-7 w-7 cursor-pointer place-items-center rounded-lg bg-white/90 shadow" title={ineligible ? 'Licence needs review — cannot be published' : selected ? 'Selected' : 'Select'}>
          <input type="checkbox" checked={!!selected} disabled={ineligible} onChange={onToggle} aria-label={`Select ${item.name ?? item.source_id}`} className="h-4 w-4 cursor-pointer accent-indigo-600" />
        </label>
      )}
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        {children}
        {!!item.published_to?.length && (
          <p className="flex items-start gap-1 text-xs font-medium text-ok"><CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" />
            Published to {item.published_to.map((p) => `${p.class_name} · ${p.subject_code}`).join(', ')}</p>
        )}
        {ineligible && <p className="flex items-center gap-1 text-xs text-warn"><ShieldAlert className="h-3.5 w-3.5" /> Licence needs review</p>}
        {footer && <div className="mt-auto flex flex-wrap gap-2 pt-1">{footer}</div>}
      </div>
    </article>
  )
}

/** DIKSHA Digital Textbook card. */
export function TextbookCard(props: { item: CardItem; selectable?: boolean; selected?: boolean; onToggle?: () => void; footer?: ReactNode }) {
  const { item } = props
  return (
    <Shell {...props}>
      <div className="flex flex-wrap gap-1.5">
        {item.boards.slice(0, 1).map((b) => <Badge key={b} tone="brand">{boardText(b)}</Badge>)}
        {item.mediums.slice(0, 2).map((m) => <Badge key={m} tone="neutral">{m}</Badge>)}
        <Badge tone="neutral"><BookOpen className="h-3 w-3" /> Textbook</Badge>
      </div>
      <p className="text-xs text-ink-500">
        {item.leaf_count ? `${item.leaf_count} linked resource${item.leaf_count === 1 ? '' : 's'}` : 'No linked resources listed'}
        {item.license.name ? ` · ${item.license.name}` : ''}
      </p>
    </Shell>
  )
}

/** DIKSHA learning resource card (video, PDF, interactive, …). */
export function ResourceCard(props: { item: CardItem; selectable?: boolean; selected?: boolean; onToggle?: () => void; footer?: ReactNode }) {
  const { item } = props
  const v = item.access ? VIEWER_LABEL[item.access.viewer] : null
  return (
    <Shell {...props}>
      <div className="flex flex-wrap gap-1.5">
        <Badge tone="neutral">{item.resource_type === 'video' || item.resource_type === 'youtube' ? <PlayCircle className="h-3 w-3" /> : <Layers className="h-3 w-3" />} {RESOURCE_LABEL[item.resource_type]}</Badge>
        {item.mediums.slice(0, 1).map((m) => <Badge key={m} tone="neutral">{m}</Badge>)}
        {v && <Badge tone={v.tone}>{v.label}</Badge>}
      </div>
      <p className="text-xs text-ink-500">{[item.primary_category, item.license.name].filter(Boolean).join(' · ')}</p>
    </Shell>
  )
}
