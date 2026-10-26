import { AI_MODULES } from '@/lib/modules'
import { cn } from '@/lib/utils'
import type { AIModule } from '@/types'

export function ModuleToggles({ value, onChange, disabled }: { value: AIModule[]; onChange: (v: AIModule[]) => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {AI_MODULES.map((m) => {
        const on = value.includes(m.id)
        return (
          <label key={m.id} className={cn('flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
            on ? 'border-brand-400/50 bg-brand-500/8 text-fg' : 'border-line text-ink-300', disabled && 'cursor-not-allowed opacity-60')}>
            <input type="checkbox" className="accent-[var(--color-brand-500)]" checked={on} disabled={disabled}
              onChange={() => onChange(on ? value.filter((x) => x !== m.id) : [...value, m.id])} />
            {m.label}
          </label>
        )
      })}
    </div>
  )
}
