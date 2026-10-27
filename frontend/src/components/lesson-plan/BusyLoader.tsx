import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileText } from 'lucide-react'

/* Full-page generation loader shared by every AI step of the Lesson Plan tool. Cycles GEN_PHASES so a long
   call shows progress, and locks the page scroll while it runs. Portalled to <body> so an animated ancestor
   can never become the containing block of the fixed overlay. */

const GEN_PHASES = ['Analyzing curriculum…', 'Structuring core objectives…', 'Generating learning outcomes…', 'Mapping Bloom’s levels…', 'Polishing your plan…']

export function BusyLoader({ label }: { label: string }) {
  const [phase, setPhase] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setPhase((p) => (p + 1) % GEN_PHASES.length), 1600)
    return () => window.clearInterval(t)
  }, [])
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])
  return createPortal(
    <div role="status" aria-live="polite" aria-label={label} onWheel={(e) => e.preventDefault()} onTouchMove={(e) => e.preventDefault()}
      className="fixed inset-0 z-[9999] grid place-items-center bg-ink-950/60 p-6 backdrop-blur-md">
      <div className="glass flex w-[min(300px,86vw)] flex-col items-center rounded-3xl px-7 pb-6 pt-8 text-center" style={{ animation: 'lp-pop .3s cubic-bezier(.22,1,.36,1) both' }}>
        <div className="relative mb-5 h-[78px] w-[78px]">
          <div className="absolute -inset-1.5 rounded-full blur-md" style={{ background: 'radial-gradient(circle, hsl(236 80% 58% / .35), hsl(184 75% 38% / .15) 60%, transparent 72%)', animation: 'lp-pulse 2.2s ease-in-out infinite' }} />
          <div className="absolute inset-0 rounded-full border-[5px] border-ink-800" />
          <div className="absolute inset-0 rounded-full" style={{
            background: 'conic-gradient(var(--color-brand-500), var(--color-aqua-500), var(--color-rose-400), transparent 78%)',
            WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 5px))',
            mask: 'radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 5px))',
            animation: 'lp-spin 1.1s linear infinite',
          }} />
          <div className="absolute inset-[11px] rounded-full" style={{
            background: 'conic-gradient(from 180deg, transparent 55%, var(--color-aqua-500), var(--color-brand-500))',
            WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))',
            mask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))',
            animation: 'lp-spin-rev 1.6s linear infinite',
          }} />
          <div className="absolute inset-0" style={{ animation: 'lp-spin 2.4s linear infinite' }}>
            <span className="absolute -top-0.5 left-1/2 h-[7px] w-[7px] -translate-x-1/2 rounded-full bg-rose-400 shadow-[0_0_8px] shadow-rose-400" />
          </div>
          <div className="absolute inset-0 grid place-items-center text-brand-500">
            <FileText className="h-6 w-6" style={{ animation: 'lp-float 3s ease-in-out infinite' }} />
          </div>
        </div>
        <div className="font-display text-[15.5px] font-semibold text-fg">{label}</div>
        <div className="relative mt-1 h-[17px] w-full overflow-hidden">
          <div key={phase} className="text-[12.5px] text-ink-500" style={{ animation: 'lp-phase 1.6s ease both' }}>{GEN_PHASES[phase]}</div>
        </div>
        <div className="relative mt-4 h-[5px] w-full overflow-hidden rounded-full bg-ink-800">
          <div className="absolute top-0 h-full w-[42%] rounded-full" style={{ background: 'linear-gradient(90deg, transparent, var(--color-brand-500), var(--color-aqua-500), transparent)', animation: 'lp-comet 1.5s cubic-bezier(.65,0,.35,1) infinite' }} />
        </div>
      </div>
    </div>,
    document.body,
  )
}
