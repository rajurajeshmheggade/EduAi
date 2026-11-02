import { useState, type ReactNode } from 'react'
import { Info, RotateCcw, ShieldAlert } from 'lucide-react'
import { Credits } from '@/components/library/diksha/Credits'
import { HtmlFrame } from '@/components/library/diksha/HtmlFrame'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RESOURCE_LABEL, VIEWER_LABEL } from '@/lib/diksha'
import type { DikshaItem } from '@/services/dikshaService'

/**
 * Shows one catalogue resource inside the app, with the method the server permits (files stay on their source host —
 * no copy, no proxy, no redirect):
 *   pdf     — the browser's PDF view of the source file, in a frame
 *   video   — our HTML5 video player streaming from the source host
 *   audio   — HTML5 audio from the source host
 *   youtube — YouTube's own embedded player (privacy-enhanced domain), inside the page
 *   html    — an HTML5 package (e.g. a virtual-lab simulation) running in a sandboxed frame
 *   none    — cannot be shown here (the server does not list such items; this covers a file that fails to load)
 */
export function ResourceViewer({ item, height = '70vh', onFrameLoad, player }: {
  item: DikshaItem
  height?: string
  /** Called when an in-app HTML package has loaded. */
  onFrameLoad?: () => void
  /** Replaces the built-in video / YouTube player (Virtual Labs track how much of a video was watched). */
  player?: ReactNode
}) {
  const [failed, setFailed] = useState(0)
  const a = item.access
  const broken = failed > 0 && (a.viewer === 'video' || a.viewer === 'audio')
  const viewer = broken ? 'none' : a.viewer
  const badge = VIEWER_LABEL[viewer]
  const media = player && (viewer === 'video' || viewer === 'youtube')

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-ink-900">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-base font-semibold text-fg">{item.name ?? 'Untitled resource'}</h3>
          <p className="truncate text-xs text-ink-500">{[item.primary_category, RESOURCE_LABEL[item.resource_type], item.path?.join(' › ')].filter(Boolean).join(' · ')}</p>
        </div>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>

      <div className="bg-ink-800/40">
        {media ? player : (
          <>
            {viewer === 'pdf' && a.src && (
              <iframe title={item.name ?? 'Document'} src={a.src} style={{ height }} className="w-full border-0 bg-white" referrerPolicy="no-referrer" />
            )}
            {viewer === 'video' && a.src && (
              <video key={`${a.src}#${failed}`} controls preload="metadata" src={a.src} style={{ maxHeight: height }} className="mx-auto block w-full bg-black"
                controlsList="nodownload" onError={() => setFailed((n) => n + 1)} aria-label={item.name ?? 'Video'}>
                Your browser cannot play this video.
              </video>
            )}
            {viewer === 'audio' && a.src && (
              <div className="p-6"><audio key={`${a.src}#${failed}`} controls preload="metadata" src={a.src} className="w-full" onError={() => setFailed((n) => n + 1)} aria-label={item.name ?? 'Audio'} /></div>
            )}
            {viewer === 'html' && a.src && <HtmlFrame src={a.src} title={item.name ?? 'Interactive resource'} height={height} onLoad={onFrameLoad} />}
            {viewer === 'youtube' && a.src && (
              <div className="relative w-full" style={{ paddingTop: '56.25%' }}>
                <iframe title={item.name ?? 'Video'} src={a.src} className="absolute inset-0 h-full w-full border-0"
                  allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
              </div>
            )}
            {viewer === 'none' && (
              <div className="grid place-items-center px-6 py-12 text-center" data-testid="unavailable">
                <div className="max-w-md">
                  <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-ink-500" />
                  <p className="font-display text-base font-semibold text-fg">{broken ? 'This file could not be played' : 'This resource can’t be shown here'}</p>
                  <p className="mt-1 text-sm text-ink-300">{broken ? 'Check your connection and try again.' : a.reason ?? 'It is not available in the app.'}</p>
                  {broken && <Button className="mt-4" variant="secondary" onClick={() => setFailed(0)}><RotateCcw className="h-4 w-4" /> Try again</Button>}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="space-y-1.5 border-t border-line px-4 py-3">
        <Credits item={item} />
        {item.permissions.notes.length > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-ink-500"><Info className="mt-0.5 h-3 w-3 shrink-0" />{item.permissions.notes.join(' ')}</p>
        )}
      </div>
    </div>
  )
}
