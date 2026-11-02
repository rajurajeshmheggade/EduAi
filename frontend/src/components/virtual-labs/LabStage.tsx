import { useState } from 'react'
import { ResourceViewer } from '@/components/library/diksha/ResourceViewer'
import { ROLE_META, shortName } from '@/lib/virtualLabs'
import { cn } from '@/lib/utils'
import type { Lab, LabResource } from '@/services/virtualLabService'

/**
 * The experiment's DIKSHA resources, simulation first. Each one is shown the way its licence allows: in app (HTML5
 * simulation / PDF / video from DIKSHA's host) or on DIKSHA's official player.
 */
export function LabStage({ lab, height = '68vh', onLaunch }: {
  lab: Lab
  height?: string
  /** A simulation was opened: in the app (frame loaded) or on DIKSHA. */
  onLaunch?: (resource: LabResource, inApp: boolean) => void
}) {
  const [selected, setSelected] = useState(lab.resources[0]?.source_id ?? null)
  const current = lab.resources.find((r) => r.source_id === selected) ?? lab.resources[0]
  if (!current) return <p className="p-6 text-sm text-ink-300">This experiment has no resources available.</p>
  const perRole: Record<string, number> = {}
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Lab resources" className="flex gap-1.5 overflow-x-auto pb-1">
        {lab.resources.map((r) => {
          const n = (perRole[r.role] = (perRole[r.role] ?? 0) + 1)
          const many = (lab.roles[r.role] ?? 0) > 1
          const Icon = ROLE_META[r.role].icon
          const on = r.source_id === current.source_id
          return (
            <button key={r.source_id} role="tab" aria-selected={on} title={r.name ?? undefined} onClick={() => setSelected(r.source_id)}
              className={cn('flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                on ? 'border-brand-400/50 bg-brand-500/10 text-brand-600' : 'border-line text-ink-300 hover:bg-ink-800 hover:text-fg')}>
              <Icon className="h-3.5 w-3.5" />
              {ROLE_META[r.role].label}{many ? ` ${n}` : ''}
              {r.access.viewer === 'official' && <span className="text-[10px] font-normal text-ink-500">· External</span>}
            </button>
          )
        })}
      </div>
      <ResourceViewer key={current.source_id} item={{ ...current, name: shortName(current) }} height={height} brandless
        onFrameLoad={current.role === 'simulation' ? () => onLaunch?.(current, true) : undefined}
        onOpenOfficial={current.role === 'simulation' ? () => onLaunch?.(current, false) : undefined} />
    </div>
  )
}
