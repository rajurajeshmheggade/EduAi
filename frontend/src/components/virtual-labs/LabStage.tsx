import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { ResourceViewer } from '@/components/library/diksha/ResourceViewer'
import { TrackedLabVideo } from '@/components/virtual-labs/LabVideo'
import { ROLE_META, shortName } from '@/lib/virtualLabs'
import { cn } from '@/lib/utils'
import type { Lab, LabResource, VideoProgress, VideoReport } from '@/services/virtualLabService'

/** Watch tracking for the student's attempt: what was recorded so far, and where new progress goes. */
export interface VideoTracking {
  progress: Record<string, VideoProgress | null>
  report: (report: VideoReport) => Promise<VideoProgress | null>
}

/**
 * The experiment's resources, simulation first, all inside the app: the HTML5 simulation in a sandboxed frame, PDFs in
 * the browser's PDF view, videos in our player (YouTube-licensed ones in YouTube's embedded player) — streamed from the
 * source host, never copied, never opened elsewhere. With `tracking` (the student's attempt) videos record how much was
 * really watched. `selected` / `onSelect` let the page switch tabs (e.g. "go to the video").
 */
export function LabStage({ lab, height = '68vh', onLaunch, tracking, selected, onSelect }: {
  lab: Lab
  height?: string
  /** A simulation was opened in the app (its frame loaded). */
  onLaunch?: (resource: LabResource) => void
  tracking?: VideoTracking
  selected?: string | null
  onSelect?: (resourceId: string) => void
}) {
  const [own, setOwn] = useState(lab.resources[0]?.source_id ?? null)
  const choice = selected !== undefined && selected !== null ? selected : own
  const current = lab.resources.find((r) => r.source_id === choice) ?? lab.resources[0]
  if (!current) return <p className="p-6 text-sm text-ink-300">This experiment has no resources available.</p>
  const shown = { ...current, name: shortName(current) }
  const perRole: Record<string, number> = {}
  const pick = (id: string) => { setOwn(id); onSelect?.(id) }
  const isVideo = (r: LabResource) => r.access.viewer === 'video' || r.access.viewer === 'youtube'
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Lab resources" className="flex gap-1.5 overflow-x-auto pb-1">
        {lab.resources.map((r) => {
          const n = (perRole[r.role] = (perRole[r.role] ?? 0) + 1)
          const many = (lab.roles[r.role] ?? 0) > 1
          const Icon = ROLE_META[r.role].icon
          const on = r.source_id === current.source_id
          const watched = tracking && isVideo(r) ? tracking.progress[r.source_id] : undefined
          return (
            <button key={r.source_id} role="tab" aria-selected={on} title={r.name ?? undefined} onClick={() => pick(r.source_id)}
              className={cn('flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                on ? 'border-brand-400/50 bg-brand-500/10 text-brand-600' : 'border-line text-ink-300 hover:bg-ink-800 hover:text-fg')}>
              <Icon className="h-3.5 w-3.5" />
              {ROLE_META[r.role].label}{many ? ` ${n}` : ''}
              {watched !== undefined && (watched?.completed
                ? <CheckCircle2 className="h-3.5 w-3.5 text-ok" aria-label="watched" />
                : <span className="text-[10px] font-normal text-ink-500">· {Math.round((watched?.coverage ?? 0) * 100)}%</span>)}
            </button>
          )
        })}
      </div>
      <ResourceViewer key={current.source_id} item={shown} height={height}
        onFrameLoad={current.role === 'simulation' ? () => onLaunch?.(current) : undefined}
        player={tracking && isVideo(current)
          ? <TrackedLabVideo resource={shown} initial={tracking.progress[current.source_id] ?? null} onReport={tracking.report} height={height} />
          : undefined} />
    </div>
  )
}
