import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Shared loading kit: one look for every page, panel and long operation in the LMS. */

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-label={label} className={cn('inline-block h-5 w-5 animate-spin rounded-full border-2 border-brand-400 border-t-transparent', className)} />
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton', className)} />
}

/** Placeholder layouts shaped like the page that is coming, so nothing jumps when it arrives. */
export function SkeletonPage({ variant = 'dashboard', className }: { variant?: 'dashboard' | 'table' | 'cards' | 'detail'; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn('space-y-5', className)}>
      <Skeleton className="h-8 w-56" />
      {variant === 'dashboard' && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
          <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-64 lg:col-span-2" /><Skeleton className="h-64" /></div>
        </>
      )}
      {variant === 'table' && (
        <div className="space-y-2"><Skeleton className="h-10" />{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12" />)}</div>
      )}
      {variant === 'cards' && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-40" />)}</div>
      )}
      {variant === 'detail' && (
        <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-96 lg:col-span-2" /><div className="space-y-4"><Skeleton className="h-40" /><Skeleton className="h-52" /></div></div>
      )}
      <span className="sr-only">Loading</span>
    </div>
  )
}

/**
 * Centred loader for a page or a heavy component (3D avatar, proctoring models, AI generation).
 * After `slowAfterMs` it says so instead of spinning silently; `progress` (0–100) shows a bar for long operations.
 */
export function PageLoader({
  message = 'Loading…', detail, progress, slowAfterMs = 8000, className, children,
}: { message?: string; detail?: string; progress?: number; slowAfterMs?: number; className?: string; children?: ReactNode }) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), slowAfterMs)
    return () => window.clearTimeout(t)
  }, [slowAfterMs])
  return (
    <div role="status" aria-live="polite" className={cn('grid min-h-[40vh] place-items-center p-6', className)}>
      {/* No fade-in: loaders often replace one another (route -> page -> step), and each would start invisible. */}
      <div className="flex max-w-sm flex-col items-center text-center">
        <div className="relative mb-4 h-12 w-12">
          <span className="absolute inset-0 rounded-full bg-brand-500/20 animate-pulse-ring" />
          <span className="absolute inset-0 animate-spin rounded-full border-2 border-brand-400 border-t-transparent" />
        </div>
        <p className="font-display text-sm font-semibold text-fg">{message}</p>
        {detail && <p className="mt-1 text-xs text-ink-300">{detail}</p>}
        {progress !== undefined && (
          <div className="mt-3 h-1.5 w-56 overflow-hidden rounded-full bg-ink-700" aria-label={`${Math.round(progress)}%`}>
            <div className="h-full rounded-full bg-brand-500 transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
          </div>
        )}
        {slow && <p className="mt-3 text-xs text-ink-400">This is taking longer than usual…</p>}
        {children}
      </div>
    </div>
  )
}

export function ErrorState({ title = 'Something went wrong', message, onRetry, className }: { title?: string; message: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn('flex flex-wrap items-center gap-3 rounded-2xl border border-bad/30 bg-bad/5 p-4 text-sm', className)}>
      <AlertTriangle className="h-5 w-5 shrink-0 text-bad" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-fg">{title}</p>
        <p className="text-ink-300">{message}</p>
      </div>
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}><RotateCcw className="h-3.5 w-3.5" /> Try again</Button>}
    </div>
  )
}
