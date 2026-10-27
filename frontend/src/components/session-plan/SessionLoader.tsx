import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

/* Full-page loader for session generation (port of Rapid's SessionLoader.jsx).

   Generating a session is a genuinely long request — the plan is written by the AI provider while four
   content agents search in parallel, so 15-30s is normal. A small spinner in the corner of a form made
   that feel broken. This takes over the screen, centres a card, and shows what is actually happening step
   by step, so the wait reads as work rather than as a hang.

   Deliberately CSS-only: two counter-rotating arcs and a pulsing core give a sense of depth for nothing.

   Honest about progress: the server reports no percentage, so the bar is indeterminate and the step list
   holds on its final step until the request actually returns. It never claims to be finished. */

/** The real pipeline, in the order the server runs it. */
const STEPS = [
  { t: 'Reading your lesson plan’s outcomes', d: 2600 },
  { t: 'Organising the resources you picked', d: 3000 },
  { t: 'Writing the session plan', d: 9000 },
  { t: 'Searching news, videos and images', d: 8000 },
  { t: 'Checking everything is right for this class', d: 6000 },
  { t: 'Almost there — saving your session', d: 0 },
]

function Spinner() {
  return (
    <div className="relative flex h-[118px] w-[118px] items-center justify-center">
      <span aria-hidden="true" className="absolute -inset-[22px] rounded-full blur-[4px]"
        style={{ background: 'radial-gradient(closest-side, hsl(236 80% 58% / .20), hsl(184 75% 38% / .10) 58%, transparent 74%)' }} />
      {/* Two arcs turning against each other, plus a slow wide ring — reads as depth without a canvas. */}
      <span aria-hidden="true" className="absolute inset-0 rounded-full border-[3px] border-transparent border-r-brand-500 border-t-brand-500"
        style={{ animation: 'lp-spin 1.1s cubic-bezier(.6,.15,.4,.85) infinite' }} />
      <span aria-hidden="true" className="absolute inset-[15px] rounded-full border-[3px] border-transparent border-b-aqua-500 border-l-aqua-500"
        style={{ animation: 'lp-spin-rev 1.5s cubic-bezier(.6,.15,.4,.85) infinite' }} />
      <span aria-hidden="true" className="absolute inset-[30px] rounded-full border-[3px] border-transparent border-t-brand-300 opacity-75"
        style={{ animation: 'lp-spin 2.1s linear infinite' }} />
      <span aria-hidden="true" className="h-[22px] w-[22px] rounded-full bg-gradient-to-br from-brand-500 to-aqua-500 shadow-glow"
        style={{ animation: 'lp-pulse 1.4s ease-in-out infinite' }} />
    </div>
  )
}

export function SessionLoader({ open, title = 'Generating your session', subtitle }: { open: boolean; title?: string; subtitle?: string }) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    let timer: number | undefined
    const advance = (i: number) => {
      if (cancelled || i >= STEPS.length - 1) return   // hold on the final step until the request lands
      timer = window.setTimeout(() => { if (!cancelled) { setStep(i + 1); advance(i + 1) } }, STEPS[i].d)
    }
    advance(0)
    return () => { cancelled = true; window.clearTimeout(timer); setStep(0) }
  }, [open])

  // The page behind must not scroll while this is up.
  useEffect(() => {
    if (!open) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  if (!open) return null

  return createPortal(
    <div role="status" aria-live="polite" aria-label={title}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-ink-950/60 p-5 backdrop-blur-md">
      <div className="glass relative w-[min(540px,100%)] overflow-hidden rounded-[22px] px-8 pb-7 pt-[34px] text-center"
        style={{ animation: 'lp-pop .32s cubic-bezier(.2,.9,.3,1.15) both' }}>
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-[38%] -skew-x-[16deg]"
          style={{ background: 'linear-gradient(100deg, transparent, hsl(0 0% 100% / .7), transparent)', animation: 'lp-comet 3.4s ease-in-out infinite' }} />

        <div className="mb-3.5 flex items-center justify-center"><Spinner /></div>

        <h2 className="mb-1.5 font-display text-xl font-semibold text-fg">{title}</h2>
        <p className="mx-auto mb-5 max-w-[390px] text-[13.5px] leading-relaxed text-ink-500">
          {subtitle || 'This takes a few moments — the plan is written for your class while we gather matching resources.'}
        </p>

        <div className="mx-auto mb-5 flex max-w-[390px] flex-col gap-2 text-left">
          {STEPS.map((s, i) => {
            if (i > step) return null   // reveal progressively rather than showing the whole plan up front
            const done = i < step
            const now = i === step
            return (
              <div key={s.t} className={cn('flex items-center gap-2.5 text-[13px]', now ? 'font-semibold text-fg' : 'text-ink-500')}
                style={now ? { animation: 'lp-row .3s ease both' } : undefined}>
                <span className={cn('inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                  done ? 'bg-ok/15 text-ok' : 'bg-brand-500/12 text-brand-600')}>
                  {done
                    ? <Check className="h-3 w-3" strokeWidth={3.2} />
                    : <span className="block h-[7px] w-[7px] animate-pulse rounded-full bg-current" />}
                </span>
                <span>{s.t}</span>
              </div>
            )
          })}
        </div>

        {/* Indeterminate — the server gives no percentage, so this never pretends to know one. */}
        <div className="mx-auto h-[5px] max-w-[390px] overflow-hidden rounded-full bg-ink-800">
          <span className="block h-full w-[38%] rounded-full bg-gradient-to-r from-brand-500 via-aqua-500 to-brand-500"
            style={{ animation: 'lp-bar 1.5s cubic-bezier(.65,0,.35,1) infinite' }} />
        </div>
      </div>
    </div>,
    document.body,
  )
}
