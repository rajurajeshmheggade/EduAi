import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TINT, type Tint } from './read'

/* Building blocks of the Session Plan screen: the tinted-header content card, numbered bullets and the stat
   strip cell. */

export function PlanCard({ icon: Icon, title, tint = 'brand', subtitle, children }: {
  icon: LucideIcon; title: string; tint?: Tint; subtitle?: string; children: ReactNode
}) {
  return (
    <section className="glass overflow-hidden rounded-2xl">
      <div className={cn('flex items-center gap-3 border-b border-line bg-gradient-to-b to-transparent px-5 py-4', TINT[tint])}>
        <span className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] bg-brand-500/12 text-brand-600 ring-1 ring-inset ring-brand-500/15">
          <Icon className="h-[15px] w-[15px]" aria-hidden="true" />
        </span>
        <h2 className="font-display text-[15.5px] font-semibold text-fg">{title}</h2>
        {subtitle ? <span className="ml-auto text-[12.5px] text-ink-500">{subtitle}</span> : null}
      </div>
      <div className="px-5 py-[18px]">{children}</div>
    </section>
  )
}

export function Bullets({ items, accent = 'brand' }: { items: string[]; accent?: 'brand' | 'green' }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-2 p-0">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2.5">
          <span aria-hidden="true" className={cn('mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold',
            accent === 'green' ? 'bg-ok/12 text-ok' : 'bg-brand-500/12 text-brand-600')}>{i + 1}</span>
          <span className="text-[14.5px] leading-[1.7] text-ink-300">{t}</span>
        </li>
      ))}
    </ol>
  )
}

export function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex shrink-0 items-center gap-2.5 border-l border-line px-[18px] py-1">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-brand-500/12 text-brand-600"><Icon className="h-4 w-4" aria-hidden="true" /></span>
      <span>
        <span className="block whitespace-nowrap text-[12.5px] text-ink-500">{label}</span>
        <span className="block whitespace-nowrap text-[15px] font-semibold text-fg">{value || '—'}</span>
      </span>
    </div>
  )
}

/** A bordered sub-block inside a card (vocabulary tile, example, question …). */
export function SubBlock({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-2xl border border-line bg-ink-950 px-4 py-3', className)}>{children}</div>
}

export const bodyText = 'text-[14.5px] leading-[1.7] text-ink-300'
