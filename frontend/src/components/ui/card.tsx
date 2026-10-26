import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...p }, ref) => (
  <div ref={ref} className={cn('glass rounded-2xl', className)} {...p} />
))
Card.displayName = 'Card'

export const CardHeader = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-1 p-5 pb-3', className)} {...p} />
)
export const CardTitle = ({ className, ...p }: HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn('font-display text-lg font-semibold text-fg', className)} {...p} />
)
export const CardDescription = ({ className, ...p }: HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn('text-sm text-ink-300', className)} {...p} />
)
export const CardContent = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('p-5 pt-2', className)} {...p} />
)
