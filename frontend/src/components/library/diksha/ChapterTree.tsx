import { useState } from 'react'
import { ChevronDown, ChevronRight, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DikshaUnit } from '@/services/dikshaService'

/** Chapter / unit hierarchy in DIKSHA's own order. Units without linked resources are shown as such. */
export function ChapterTree({ units, selected, onSelect }: { units: DikshaUnit[]; selected: string | null; onSelect: (u: DikshaUnit) => void }) {
  if (!units.length) return <p className="px-2 py-4 text-sm text-ink-500">This textbook has no chapter structure on DIKSHA.</p>
  return (
    <ol className="space-y-0.5" aria-label="Chapters">
      {units.map((u, i) => <UnitNode key={u.id} u={u} number={i + 1} depth={0} selected={selected} onSelect={onSelect} />)}
    </ol>
  )
}

function UnitNode({ u, number, depth, selected, onSelect }: { u: DikshaUnit; number: number; depth: number; selected: string | null; onSelect: (u: DikshaUnit) => void }) {
  const [open, setOpen] = useState(depth === 0 && selected !== null && contains(u, selected))
  const hasKids = u.units.length > 0
  const empty = u.resource_count === 0
  return (
    <li>
      <div className={cn('flex items-center gap-1 rounded-lg pr-2', selected === u.id ? 'bg-brand-500/10' : 'hover:bg-ink-800')} style={{ paddingLeft: depth * 14 }}>
        {hasKids ? (
          <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${u.name}`}
            className="grid h-7 w-6 shrink-0 cursor-pointer place-items-center text-ink-500 hover:text-fg">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : <span className="w-6 shrink-0" />}
        <button onClick={() => { onSelect(u); if (hasKids) setOpen(true) }} aria-current={selected === u.id ? 'true' : undefined}
          className={cn('flex min-w-0 flex-1 cursor-pointer items-start gap-2 py-1.5 text-left text-sm', selected === u.id ? 'font-medium text-brand-600' : 'text-ink-100')}>
          {depth === 0 && <span className="w-5 shrink-0 pt-px text-xs tabular-nums text-ink-500">{number}</span>}
          {depth > 0 && <FolderOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-500" />}
          <span className="flex-1">{u.name}</span>
          <span className={cn('shrink-0 text-xs tabular-nums', empty ? 'text-ink-500' : 'text-ink-300')} title={empty ? 'No linked resources' : `${u.resource_count} resources`}>
            {empty ? '—' : u.resource_count}
          </span>
        </button>
      </div>
      {hasKids && open && (
        <ol className="space-y-0.5">
          {u.units.map((c, i) => <UnitNode key={c.id} u={c} number={i + 1} depth={depth + 1} selected={selected} onSelect={onSelect} />)}
        </ol>
      )}
    </li>
  )
}

function contains(u: DikshaUnit, id: string): boolean {
  return u.id === id || u.units.some((c) => contains(c, id))
}

