import { cn } from '@/lib/utils'

export function Progress({ value, className, tone = 'brand' }: { value: number; className?: string; tone?: 'brand' | 'ok' | 'bad' }) {
  const v = Math.max(0, Math.min(100, value))
  const bar = tone === 'ok' ? 'from-ok to-aqua-400' : tone === 'bad' ? 'from-bad to-rose-400' : 'from-brand-500 to-aqua-400'
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-ink-700', className)} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full bg-gradient-to-r transition-[width] duration-500 ease-out', bar)} style={{ width: `${v}%` }} />
    </div>
  )
}
