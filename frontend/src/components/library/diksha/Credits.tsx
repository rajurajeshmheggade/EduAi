import { useId, useState } from 'react'
import { ChevronDown, Scale } from 'lucide-react'
import { attributionParts } from '@/lib/diksha'
import { cn } from '@/lib/utils'
import type { DikshaItem } from '@/services/dikshaService'

type CreditItem = Pick<DikshaItem, 'author' | 'creator' | 'attributions' | 'copyright' | 'copyright_year' | 'organisation' | 'license'>

/**
 * Per-item credit required by the item's own licence (Creative Commons attribution; the source's Terms forbid removing
 * copyright notices). The copyright notice and the licence — linked to its legal code — are always visible; author,
 * creator, attributions and organisation are listed in full, or one click away in the compact form. Values come only
 * from the item's metadata, nothing is filled in, and no platform branding or link to the source platform is shown.
 */
export function Credits({ item, compact, className }: { item: CreditItem; compact?: boolean; className?: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const parts = attributionParts(item)
  const copyright = parts.find((p) => p.label === 'Copyright')
  const people = parts.filter((p) => p.label !== 'Copyright')
  return (
    <div className={cn('text-xs text-ink-500', className)} data-testid="credits">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-ink-300">Credits</span>
        {copyright && <span>{copyright.value}</span>}
        <span className="inline-flex items-center gap-1"><Scale className="h-3 w-3" />
          {item.license.name
            ? item.license.url
              ? <a href={item.license.url} target="_blank" rel="noopener noreferrer license" className="text-brand-600 hover:underline">{item.license.name}</a>
              : item.license.name
            : <span className="text-warn">Licence not stated — needs review</span>}
        </span>
        {compact && people.length > 0 && (
          <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}
            className="inline-flex cursor-pointer items-center gap-0.5 text-ink-300 hover:text-fg">
            {people[0].value}{people.length > 1 ? ` +${people.length - 1}` : ''}
            <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
          </button>
        )}
      </div>
      {people.length > 0 && (
        <dl id={id} hidden={compact && !open} className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
          {people.map((p) => <div key={p.label} className="flex gap-1"><dt>{p.label}:</dt><dd className="text-ink-300">{p.value}</dd></div>)}
        </dl>
      )}
    </div>
  )
}
