import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium border', {
  variants: {
    tone: {
      neutral: 'bg-ink-800 text-ink-300 border-line',
      brand: 'bg-brand-500/15 text-brand-300 border-brand-400/30',
      ok: 'bg-ok/15 text-ok border-ok/30',
      warn: 'bg-warn/15 text-warn border-warn/30',
      bad: 'bg-bad/15 text-bad border-bad/30',
      aqua: 'bg-aqua-500/15 text-aqua-400 border-aqua-400/30',
    },
  },
  defaultVariants: { tone: 'neutral' },
})

export function Badge({ className, tone, ...p }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...p} />
}
