import { useEffect, useState } from 'react'
import { useIsLoading } from '@/lib/navProgress'

type Phase = 'idle' | 'start' | 'run' | 'done'
const WIDTH: Record<Phase, string> = { idle: '0%', start: '0%', run: '85%', done: '100%' }

/**
 * Slim progress bar along the bottom edge of the shell header while a page's code or first data is loading. It eases
 * towards 85% while waiting, completes when everything has arrived, and stays hidden for loads under ~150 ms.
 */
export function TopProgress() {
  const loading = useIsLoading()
  const [phase, setPhase] = useState<Phase>('idle')

  useEffect(() => {
    if (loading) {
      let frame = 0
      const t = window.setTimeout(() => {
        setPhase('start')
        frame = window.requestAnimationFrame(() => setPhase('run'))
      }, 150)
      return () => { window.clearTimeout(t); window.cancelAnimationFrame(frame) }
    }
    setPhase((p) => (p === 'idle' ? p : 'done'))
    const t = window.setTimeout(() => setPhase('idle'), 450)
    return () => window.clearTimeout(t)
  }, [loading])

  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-px z-40 h-0.5 overflow-hidden" data-loading={phase !== 'idle' && phase !== 'done'}>
      <div className="h-full rounded-r-full bg-gradient-to-r from-brand-500 to-aqua-400 shadow-[0_0_8px_hsl(258_90%_60%/0.6)]"
        style={{
          width: WIDTH[phase],
          opacity: phase === 'idle' ? 0 : 1,
          transition: phase === 'run' ? 'width 8s cubic-bezier(0.1, 0.7, 0.2, 1)' : phase === 'done' ? 'width 200ms ease-out, opacity 250ms ease 200ms' : 'none',
        }} />
    </div>
  )
}
