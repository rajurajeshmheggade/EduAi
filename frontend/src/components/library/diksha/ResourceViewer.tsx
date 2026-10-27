import { useState } from 'react'
import { Download, ExternalLink, Info, PlayCircle } from 'lucide-react'
import { SourceAttribution } from '@/components/library/diksha/SourceAttribution'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RESOURCE_LABEL, VIEWER_LABEL } from '@/lib/diksha'
import type { DikshaItem } from '@/services/dikshaService'

/**
 * Shows one DIKSHA resource with the method the server permits:
 *   pdf     — the browser's PDF view of DIKSHA's own file (no copy, no proxy)
 *   video   — HTML5 video streamed from DIKSHA's host
 *   audio   — HTML5 audio from DIKSHA's host
 *   youtube — YouTube's own embedded player (privacy-enhanced domain)
 *   official — a link to DIKSHA's official player (interactive content, NonCommercial / unknown licences, failures)
 */
export function ResourceViewer({ item, height = '70vh' }: { item: DikshaItem; height?: string }) {
  const [failed, setFailed] = useState(false)
  const a = item.access
  const viewer = failed ? 'official' : a.viewer
  const reason = failed ? 'The file could not be played here.' : a.reason
  const badge = VIEWER_LABEL[viewer]

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-ink-900">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-base font-semibold text-fg">{item.name ?? 'Untitled resource'}</h3>
          <p className="truncate text-xs text-ink-500">{[item.primary_category, RESOURCE_LABEL[item.resource_type], item.path?.join(' › ')].filter(Boolean).join(' · ')}</p>
        </div>
        <Badge tone={badge.tone}>{badge.label}</Badge>
        {item.permissions.download && a.src && viewer === 'pdf' && (
          <a href={a.src} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="secondary"><Download className="h-3.5 w-3.5" /> Open file</Button></a>
        )}
        <a href={a.official_url} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="outline"><ExternalLink className="h-3.5 w-3.5" /> Open on DIKSHA</Button></a>
      </div>

      <div className="bg-ink-800/40">
        {viewer === 'pdf' && a.src && (
          <iframe title={item.name ?? 'Document'} src={a.src} style={{ height }} className="w-full border-0 bg-white" referrerPolicy="no-referrer" />
        )}
        {viewer === 'video' && a.src && (
          <video key={a.src} controls preload="metadata" src={a.src} style={{ maxHeight: height }} className="mx-auto block w-full bg-black"
            onError={() => setFailed(true)} aria-label={item.name ?? 'Video'}>
            Your browser cannot play this video. <a href={a.official_url}>Open it on DIKSHA</a>.
          </video>
        )}
        {viewer === 'audio' && a.src && (
          <div className="p-6"><audio controls preload="metadata" src={a.src} className="w-full" onError={() => setFailed(true)} aria-label={item.name ?? 'Audio'} /></div>
        )}
        {viewer === 'youtube' && a.src && (
          <div className="relative w-full" style={{ paddingTop: '56.25%' }}>
            <iframe title={item.name ?? 'YouTube video'} src={a.src} className="absolute inset-0 h-full w-full border-0"
              allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
          </div>
        )}
        {viewer === 'official' && (
          <div className="grid place-items-center px-6 py-12 text-center" data-testid="official-fallback">
            <div className="max-w-md">
              <PlayCircle className="mx-auto mb-3 h-10 w-10 text-brand-600" />
              <p className="font-display text-base font-semibold text-fg">Open this resource on DIKSHA</p>
              {reason && <p className="mt-1 text-sm text-ink-300">{reason}</p>}
              <a href={a.official_url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block">
                <Button><ExternalLink className="h-4 w-4" /> Open on DIKSHA</Button>
              </a>
              <p className="mt-2 text-xs text-ink-500">Opens in a new tab. DIKSHA may ask you to sign in.</p>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-1.5 border-t border-line px-4 py-3">
        <SourceAttribution item={item} />
        {item.permissions.notes.length > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-ink-500"><Info className="mt-0.5 h-3 w-3 shrink-0" />{item.permissions.notes.join(' ')}</p>
        )}
      </div>
    </div>
  )
}
