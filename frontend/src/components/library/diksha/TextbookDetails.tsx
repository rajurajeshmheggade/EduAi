import { useMemo, useState } from 'react'
import { BookOpen, CheckCircle2, Eye, FileText, Layers, ListTree, PlayCircle } from 'lucide-react'
import { ChapterTree } from '@/components/library/diksha/ChapterTree'
import { EmptyState } from '@/components/library/diksha/LibraryStates'
import { ResourceViewer } from '@/components/library/diksha/ResourceViewer'
import { SourceAttribution } from '@/components/library/diksha/SourceAttribution'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { boardText, classText, RESOURCE_LABEL, unitResources, VIEWER_LABEL } from '@/lib/diksha'
import { coverClass } from '@/lib/library'
import { cn } from '@/lib/utils'
import type { DikshaItem, DikshaTextbook, DikshaUnit } from '@/services/dikshaService'

const ICON = { pdf: FileText, video: PlayCircle, youtube: PlayCircle, audio: PlayCircle, epub: BookOpen, interactive: Layers, collection: Layers, other: Layers }

function firstUnit(units: DikshaUnit[]): DikshaUnit | null {
  return units.find((u) => u.resource_count > 0) ?? units[0] ?? null
}

const containsResource = (u: DikshaUnit, id: string): boolean =>
  u.resources.some((r) => r.source_id === id) || u.units.some((c) => containsResource(c, id))

/** The top-level chapter that contains a resource anywhere below it. */
function findUnitOf(units: DikshaUnit[], resourceId: string): DikshaUnit | null {
  return units.find((u) => containsResource(u, resourceId)) ?? null
}

/**
 * Textbook details: cover, metadata, attribution, chapter hierarchy and the resources linked to the chosen chapter.
 * `selection` (teacher mode) adds checkboxes for the whole textbook and for individual eligible resources.
 */
export function TextbookDetails({ tree, initialResource, selection }: {
  tree: DikshaTextbook
  initialResource?: string | null
  selection?: { isSelected: (id: string) => boolean; toggleBook: () => void; toggleResource: (r: DikshaItem) => void }
}) {
  const b = tree.book
  const startUnit = (initialResource && findUnitOf(tree.units, initialResource)) || firstUnit(tree.units)
  const [unit, setUnit] = useState<DikshaUnit | null>(startUnit)
  const allResources = useMemo(() => {
    const list: DikshaItem[] = [...tree.resources]
    const walk = (us: DikshaUnit[]) => us.forEach((u) => { list.push(...u.resources); walk(u.units) })
    walk(tree.units)
    return list
  }, [tree])
  const [active, setActive] = useState<DikshaItem | null>(() => allResources.find((r) => r.source_id === initialResource) ?? null)
  const groups = unit ? unitResources(unit) : tree.resources.length ? [{ group: null, items: tree.resources }] : []
  const [broken, setBroken] = useState(false)

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-5 rounded-2xl border border-line bg-ink-900 p-4 sm:flex-row">
        <div className={cn('relative h-48 w-full shrink-0 overflow-hidden rounded-xl bg-gradient-to-br sm:h-52 sm:w-40', coverClass(b.subjects[0] ?? 'Textbook'))}>
          {b.cover_url && !broken
            ? <img src={b.cover_url} alt={`Cover of ${b.name ?? 'textbook'}`} referrerPolicy="no-referrer" onError={() => setBroken(true)} className="h-full w-full object-cover" />
            : <BookOpen className="absolute bottom-3 right-3 h-10 w-10 text-white/40" />}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="font-display text-xl font-bold text-fg">{b.name ?? 'Untitled textbook'}</h2>
          {b.description && <p className="line-clamp-3 text-sm text-ink-300">{b.description}</p>}
          <div className="flex flex-wrap gap-1.5">
            {b.boards.map((x) => <Badge key={x} tone="brand">{boardText(x)}</Badge>)}
            {classText(b.classes) && <Badge tone="neutral">{classText(b.classes)}</Badge>}
            {b.subjects.map((x) => <Badge key={x} tone="neutral">{x}</Badge>)}
            {b.mediums.map((x) => <Badge key={x} tone="neutral">{x}</Badge>)}
          </div>
          <p className="text-xs text-ink-500">
            {tree.units.length} chapter{tree.units.length === 1 ? '' : 's'} · {tree.resource_count} linked resource{tree.resource_count === 1 ? '' : 's'}
            {tree.empty_units > 0 ? ` · ${tree.empty_units} unit${tree.empty_units === 1 ? '' : 's'} without resources` : ''}
            {b.published_on ? ` · updated on DIKSHA ${new Date(b.published_on).toLocaleDateString()}` : ''}
          </p>
          <SourceAttribution item={b} />
          {selection && (
            <div className="pt-1">
              <Button size="sm" variant={selection.isSelected(b.source_id) ? 'default' : 'outline'} disabled={!b.permissions.eligible} onClick={selection.toggleBook}>
                {selection.isSelected(b.source_id) ? <><CheckCircle2 className="h-3.5 w-3.5" /> Textbook selected</> : 'Select whole textbook'}
              </Button>
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[19rem_1fr]">
        <aside className="h-fit rounded-2xl border border-line bg-ink-900 p-2 lg:sticky lg:top-2 lg:max-h-[75vh] lg:overflow-y-auto">
          <h3 className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500"><ListTree className="h-3.5 w-3.5" /> Chapters</h3>
          <ChapterTree units={tree.units} selected={unit?.id ?? null} onSelect={(u) => setUnit(u)} />
        </aside>

        <div className="min-w-0 space-y-4">
          {active && <ResourceViewer key={active.source_id} item={active} height="62vh" />}
          <section className="rounded-2xl border border-line bg-ink-900 p-4">
            <h3 className="mb-3 font-display text-base font-semibold text-fg">{unit?.name ?? 'Resources'}</h3>
            {groups.length === 0 ? (
              <EmptyState title="No resources are linked to this chapter on DIKSHA" icon={Layers}>Choose another chapter, or open the textbook on DIKSHA.</EmptyState>
            ) : groups.map((g) => (
              <div key={g.group ?? 'direct'} className="mb-3 last:mb-0">
                {g.group && <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">{g.group}</div>}
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {g.items.map((r) => {
                    const Icon = ICON[r.resource_type]
                    const v = VIEWER_LABEL[r.access.viewer]
                    return (
                      <li key={r.source_id} className={cn('flex flex-wrap items-center gap-3 p-2.5', active?.source_id === r.source_id && 'bg-brand-500/5')}>
                        {selection && (
                          <input type="checkbox" aria-label={`Select ${r.name ?? r.source_id}`} disabled={!r.permissions.eligible}
                            checked={selection.isSelected(r.source_id)} onChange={() => selection.toggleResource(r)} className="h-4 w-4 accent-indigo-600" />
                        )}
                        <Icon className="h-4 w-4 shrink-0 text-ink-500" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-fg">{r.name ?? 'Untitled resource'}</div>
                          <div className="truncate text-xs text-ink-500">{[RESOURCE_LABEL[r.resource_type], r.primary_category, r.license.name ?? 'Licence not stated'].filter(Boolean).join(' · ')}</div>
                        </div>
                        <Badge tone={v.tone}>{v.label}</Badge>
                        <Button size="sm" variant={active?.source_id === r.source_id ? 'default' : 'secondary'} onClick={() => setActive(r)} aria-label={`Open ${r.name ?? 'resource'}`}>
                          <Eye className="h-3.5 w-3.5" /> Open
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  )
}
