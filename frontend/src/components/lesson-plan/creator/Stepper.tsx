import { CircleCheckBig } from 'lucide-react'
import { cn } from '@/lib/utils'
import { STEPS } from './model'
import type { Creator } from './useCreator'

/** Sticky 7-step stepper — sticks to the top of AppShell's scrolling <main>, condenses (short labels, no
    descriptions, smaller circles) once the page scrolls past the top. */
export function Stepper({ c }: { c: Creator }) {
  const compact = c.compactStepper
  return (
    <nav aria-label="Lesson plan steps"
      className={cn('sticky top-0 z-30 overflow-x-auto border-b border-line bg-ink-900/90 backdrop-blur-md transition-[padding] duration-200', compact ? 'py-1.5' : 'py-2.5')}>
      <ol className="mx-auto flex w-max items-start px-5">
        {STEPS.map((s, i) => {
          const st = c.current === s.n ? 'active' : c.done.includes(s.n) ? 'done' : 'idle'
          const Icon = st === 'done' ? CircleCheckBig : s.icon
          return (
            <li key={s.n} className="flex items-center">
              <button type="button" onClick={() => c.scrollTo(s.n)} aria-current={st === 'active' ? 'step' : undefined}
                aria-label={`Step ${s.n}: ${s.title}${st === 'done' ? ' (done)' : ''}`}
                className={cn('flex cursor-pointer flex-col items-center rounded-lg transition-[width] duration-200', compact ? 'w-[74px]' : 'w-24')}>
                <span className={cn('grid place-items-center rounded-full transition-all duration-300',
                  compact ? 'mb-0.5 h-7 w-7' : 'mb-1.5 h-10 w-10',
                  st === 'active' ? 'scale-110 bg-gradient-to-r from-brand-500 to-brand-600 text-white shadow-glow'
                    : st === 'done' ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-500/30'
                      : 'bg-ink-700 text-ink-500')}>
                  <Icon className={compact ? 'h-[15px] w-[15px]' : 'h-[18px] w-[18px]'} />
                </span>
                <span className={cn('whitespace-nowrap text-[11.5px] font-medium leading-tight',
                  st === 'active' ? 'text-brand-600' : st === 'done' ? 'text-emerald-700' : 'text-ink-500')}>
                  {compact ? s.title.split(' ')[0] : s.title}
                </span>
                {!compact && <span className="mt-0.5 hidden text-[10.5px] leading-snug text-ink-500 md:block">{s.desc}</span>}
              </button>
              {i < STEPS.length - 1 && (
                <span aria-hidden className={cn('mx-1 h-0.5 rounded-full transition-all duration-200',
                  compact ? 'mb-[18px] w-6' : 'mb-[34px] w-[34px]',
                  c.done.includes(s.n) ? 'bg-gradient-to-r from-emerald-400 to-emerald-500' : c.current === s.n ? 'bg-gradient-to-r from-brand-400 to-brand-500' : 'bg-ink-700')} />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
