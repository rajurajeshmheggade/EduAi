import type { ReactNode } from 'react'
import { AlertTriangle, BookX, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function LoadingState({ rows = 8, className, label = 'Loading…' }: { rows?: number; className?: string; label?: string }) {
  return (
    <div role="status" aria-label={label} className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4', className)}>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton h-72" />)}
      <span className="sr-only">{label}</span>
    </div>
  )
}

export function EmptyState({ title, children, icon: Icon = BookX }: { title: string; children?: ReactNode; icon?: typeof BookX }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-line bg-ink-900 px-6 py-14 text-center">
      <div className="max-w-md">
        <Icon className="mx-auto mb-3 h-10 w-10 text-ink-500" />
        <p className="font-display text-base font-semibold text-fg">{title}</p>
        {children && <div className="mt-1 text-sm text-ink-300">{children}</div>}
      </div>
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-bad/30 bg-bad/5 p-4 text-sm">
      <AlertTriangle className="h-5 w-5 shrink-0 text-bad" />
      <span className="min-w-0 flex-1 text-fg">{message}</span>
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}><RotateCcw className="h-3.5 w-3.5" /> Try again</Button>}
    </div>
  )
}
