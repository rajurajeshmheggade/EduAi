/* Step 6 resource cards: one AI block per resource. The single-ELO list supports drag-reorder; the merged
   view folds same-named resources across the merged ELOs into one card, each ELO's content labelled. */
import type { DragEvent } from 'react'
import { ChevronDown, GripVertical, Pencil, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/field'
import { cn } from '@/lib/utils'
import { Rich } from '../Rich'
import { isErrBlock, type Elo, type ResourceCard } from './model'
import { IconBtn, ResourceFallback } from './ui'
import type { Creator } from './useCreator'

interface ResProps { c: Creator; elo: Elo; phaseKey: string; r: ResourceCard }

export function ResourceActions({ c, elo, phaseKey, r }: ResProps) {
  const valid = !!r.content && !isErrBlock(r.content)
  return (
    <>
      {valid && (
        <IconBtn label={r.editing ? 'Finish editing' : 'Edit content'} tone="brand" onClick={() => c.patchResource(elo.id, phaseKey, r.rid, { editing: !r.editing })}>
          <Pencil className="h-3.5 w-3.5" />
        </IconBtn>
      )}
      <IconBtn label={r.content ? 'Regenerate' : 'Generate'} tone="green" onClick={() => void c.regenResource(elo, phaseKey, r)}><RefreshCw className="h-3.5 w-3.5" /></IconBtn>
      <IconBtn label="Remove resource" tone="red" onClick={() => c.removePhaseResource(elo.id, phaseKey, r.rid)}><X className="h-3.5 w-3.5" /></IconBtn>
    </>
  )
}

export function ResourceBody({ c, elo, phaseKey, r }: ResProps) {
  const content = r.content
  const patch = (p: Partial<ResourceCard>) => c.patchResource(elo.id, phaseKey, r.rid, p)
  if (c.busy === `res:${r.rid}`) return <div className="px-3.5 py-3"><p className="text-[13px] text-teal-700">Generating…</p></div>
  if (isErrBlock(content)) return <div className="px-3.5 py-3"><ResourceFallback onRegenerate={() => void c.regenResource(elo, phaseKey, r)} /></div>
  if (!content) return <div className="px-3.5 py-3"><p className="text-[12.5px] italic text-ink-500">No content generated yet.</p></div>
  if (r.editing) {
    return (
      <div className="flex flex-col gap-2 px-3.5 py-3">
        <Input aria-label="Resource title" value={content.title} className="h-9 font-semibold"
          onChange={(ev) => patch({ content: { ...content, title: ev.target.value } })} />
        <Textarea aria-label="Resource content" rows={8} value={content.body} className="resize-y text-[13px]"
          onChange={(ev) => patch({ content: { ...content, body: ev.target.value } })} />
        <div className="flex justify-end">
          <Button size="sm" onClick={() => patch({ editing: false })} className="from-teal-600 to-teal-600 shadow-none">Done</Button>
        </div>
      </div>
    )
  }
  return (
    <div className="px-3.5 py-3">
      {content.title && <div className="mb-1 text-sm font-semibold text-fg">{content.title}</div>}
      <div className={cn('relative', !r.expanded && 'max-h-24 overflow-hidden')}>
        <Rich text={content.body} />
        {!r.expanded && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-11 bg-gradient-to-b from-transparent to-ink-900" />}
      </div>
      <div className="mt-1.5 flex justify-center">
        <button type="button" aria-expanded={r.expanded} aria-label={r.expanded ? 'Collapse' : 'Expand'} title={r.expanded ? 'Collapse' : 'Expand'}
          onClick={() => c.toggleResExpanded(elo.id, phaseKey, r.rid)}
          className="grid h-7.5 w-7.5 cursor-pointer place-items-center rounded-full bg-yellow-400/20 text-yellow-700 transition-colors hover:bg-yellow-400/35">
          <ChevronDown className={cn('h-4 w-4 transition-transform', r.expanded && 'rotate-180')} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  )
}

/** One ELO's resources for a phase — each a card with drag handle, auto-allocated time and actions. */
export function SingleResources({ c, elo, phaseKey }: { c: Creator; elo: Elo; phaseKey: string }) {
  const resources = c.phaseCfg(elo.id, phaseKey).resources
  if (!resources.length) return null
  const drop = (idx: number) => (ev: DragEvent) => {
    ev.preventDefault()
    const d = c.dragRef.current
    if (d && d.eloId === elo.id && d.phaseKey === phaseKey) c.moveResource(elo.id, phaseKey, d.fromIdx, idx)
    c.dragRef.current = null
  }
  return (
    <div className="mt-3">
      <div className="mb-2 text-xs font-semibold text-ink-300">Selected Resources:</div>
      <div className="flex flex-col gap-2.5">
        {resources.map((r, idx) => (
          <div key={r.rid} onDragOver={(ev) => ev.preventDefault()} onDrop={drop(idx)} className="overflow-hidden rounded-xl border border-line bg-ink-900 shadow-sm">
            <div className="flex flex-wrap items-center gap-2 border-b border-line bg-teal-500/[0.05] px-3 py-2">
              <span draggable title="Drag to reorder" aria-label="Drag to reorder" className="inline-flex shrink-0 cursor-grab text-ink-500 active:cursor-grabbing"
                onDragStart={(ev) => { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', r.rid); c.dragRef.current = { eloId: elo.id, phaseKey, fromIdx: idx } }}
                onDragEnd={() => { c.dragRef.current = null }}>
                <GripVertical className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg">• {r.name}</span>
              <label className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-ink-500">
                Estimated Time:
                {/* Auto-allocated from the phase time split equally across resources (read-only). */}
                <input type="number" value={r.estTime} readOnly title="Auto-allocated: the phase time is split equally across its resources"
                  className="h-7 w-11 cursor-default rounded-md border border-sky-300/60 bg-sky-500/5 px-1.5 text-center text-xs text-brand-600 outline-none" />
                min
              </label>
              <ResourceActions c={c} elo={elo} phaseKey={phaseKey} r={r} />
            </div>
            <ResourceBody c={c} elo={elo} phaseKey={phaseKey} r={r} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** A merged tab's resources for a phase: same-named resources across the merged ELOs share ONE card,
    with each ELO's content labelled "from ELO N". */
export function MergedResources({ c, phaseKey, members }: { c: Creator; phaseKey: string; members: Elo[] }) {
  const entries = members.flatMap((e) => c.phaseCfg(e.id, phaseKey).resources.map((r) => ({ elo: e, r })))
  if (!entries.length) return <p className="mt-2.5 text-[12.5px] italic text-ink-500">No resources added yet — use “Add Resources” above.</p>
  const groups: { name: string; items: typeof entries }[] = []
  const byName = new Map<string, (typeof groups)[number]>()
  entries.forEach((en) => {
    const k = String(en.r.name || '').trim().toLowerCase()
    let g = byName.get(k)
    if (!g) { g = { name: en.r.name, items: [] }; byName.set(k, g); groups.push(g) }
    g.items.push(en)
  })
  return (
    <div className="mt-3">
      <div className="mb-2 text-xs font-semibold text-ink-300">Selected Resources (merged):</div>
      <div className="flex flex-col gap-2.5">
        {groups.map((g) => (
          <div key={g.name} className="overflow-hidden rounded-xl border border-line bg-ink-900 shadow-sm">
            <div className="flex items-center gap-2 border-b border-line bg-teal-500/[0.05] px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg">• {g.name}</span>
              {g.items.length > 1 && <span className="shrink-0 rounded-full bg-teal-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-teal-700">{g.items.length} ELOs</span>}
            </div>
            {g.items.map((en, ii) => (
              <div key={`${en.elo.id}_${en.r.rid}`} className={cn(ii > 0 && 'border-t border-line')}>
                <div className="flex items-center gap-2 bg-ink-800/70 px-3 py-1.5">
                  <span className="shrink-0 rounded-full border border-teal-300/50 bg-ink-900 px-2 py-0.5 text-[10.5px] font-semibold text-teal-700">from ELO {en.elo.num}</span>
                  {en.r.estTime && <span className="text-[11px] text-ink-500">{en.r.estTime} min</span>}
                  <div className="flex-1" />
                  <ResourceActions c={c} elo={en.elo} phaseKey={phaseKey} r={en.r} />
                </div>
                <ResourceBody c={c} elo={en.elo} phaseKey={phaseKey} r={en.r} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
