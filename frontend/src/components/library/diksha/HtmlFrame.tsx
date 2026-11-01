import { useEffect, useRef, useState } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Runs an HTML5 package (e.g. an OLabs virtual-lab simulation) unmodified from DIKSHA's own host. The frame keeps the
 * content's own origin (obj.diksha.gov.in), so it cannot reach this app; the sandbox still blocks top-level navigation.
 */
export function HtmlFrame({ src, title, height = '70vh', onLoad }: { src: string; title: string; height?: string; onLoad?: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)

  // The iframe's height is a fixed vh (sized for the normal page). Without this, going fullscreen only grows the
  // surrounding <div> to fill the screen — the iframe itself stays at its old, small height, leaving the rest of
  // the screen blank/white. Track fullscreen state so the iframe can stretch to fill the screen while it's active.
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === box.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = () => {
    if (document.fullscreenElement === box.current) void document.exitFullscreen?.().catch(() => {})
    else void box.current?.requestFullscreen?.().catch(() => {})
  }

  return (
    <div ref={box} className={cn('relative bg-white', full && 'h-screen w-screen')}>
      <iframe title={title} src={src} style={{ height: full ? '100vh' : height }} className="block w-full border-0 bg-white" onLoad={onLoad}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-pointer-lock allow-modals allow-downloads"
        allow="fullscreen; autoplay" referrerPolicy="no-referrer" />
      <Button size="icon" variant="secondary" onClick={toggleFullscreen} aria-label={full ? 'Exit full screen' : 'Full screen'} title={full ? 'Exit full screen' : 'Full screen'}
        className="absolute right-2 bottom-2 h-8 w-8 bg-ink-900/80 backdrop-blur">
        {full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </Button>
    </div>
  )
}
