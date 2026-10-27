import { ExternalLink, Scale } from 'lucide-react'
import { attributionParts } from '@/lib/diksha'
import { cn } from '@/lib/utils'
import type { DikshaItem } from '@/services/dikshaService'

/**
 * Source, licence and attribution exactly as DIKSHA provides them. DIKSHA's Terms of Use forbid removing copyright or
 * licence notices, so this is shown wherever a DIKSHA item is displayed.
 */
export function SourceAttribution({ item, compact, className }: {
  item: Pick<DikshaItem, 'author' | 'creator' | 'attributions' | 'copyright' | 'copyright_year' | 'organisation' | 'license' | 'official_url'>
  compact?: boolean
  className?: string
}) {
  const parts = attributionParts(item)
  return (
    <div className={cn('text-xs text-ink-500', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1">Source:
          <a href={item.official_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-medium text-brand-600 hover:underline">
            DIKSHA <ExternalLink className="h-3 w-3" />
          </a>
        </span>
        <span className="inline-flex items-center gap-1"><Scale className="h-3 w-3" />
          {item.license.name
            ? item.license.url
              ? <a href={item.license.url} target="_blank" rel="noopener noreferrer license" className="text-brand-600 hover:underline">{item.license.name}</a>
              : item.license.name
            : <span className="text-warn">Licence not stated — needs review</span>}
        </span>
        {compact && parts[0] && <span>{parts[0].label}: {parts[0].value}</span>}
      </div>
      {!compact && parts.length > 0 && (
        <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
          {parts.map((p) => <div key={p.label} className="flex gap-1"><dt>{p.label}:</dt><dd className="text-ink-300">{p.value}</dd></div>)}
        </dl>
      )}
    </div>
  )
}
