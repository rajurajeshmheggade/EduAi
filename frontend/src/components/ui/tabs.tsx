import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface TabItem<T extends string> { id: T; label: string; icon?: LucideIcon; count?: number }

/** Accessible segmented tab bar (content is rendered by the caller based on `value`). */
export function Tabs<T extends string>({ items, value, onChange, className }: {
  items: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  className?: string
}) {
  return (
    <div role="tablist" className={cn('flex gap-1 overflow-x-auto rounded-xl border border-line bg-ink-800 p-1', className)}>
      {items.map(({ id, label, icon: Icon, count }) => (
        <button
          key={id}
          role="tab"
          id={`tab-${id}`}
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={cn(
            'flex shrink-0 cursor-pointer items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-all',
            value === id ? 'bg-ink-900 text-brand-600 shadow-sm ring-1 ring-line' : 'text-ink-300 hover:text-fg',
          )}
        >
          {Icon && <Icon className="h-4 w-4" />}
          {label}
          {count !== undefined && <span className="rounded-full bg-ink-700 px-1.5 text-[11px] tabular-nums text-ink-300">{count}</span>}
        </button>
      ))}
    </div>
  )
}
