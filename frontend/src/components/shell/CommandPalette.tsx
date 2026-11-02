import { useMemo, useState, type KeyboardEvent } from 'react'
import { CornerDownLeft, Search, type LucideIcon } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export interface Command { id: string; label: string; hint?: string; icon: LucideIcon; run: () => void }

/** Ctrl/⌘-K command palette: type to filter pages and actions, arrows to move, Enter to open. */
export function CommandPalette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Command[] }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return commands
    return commands.filter((c) => `${c.label} ${c.hint ?? ''}`.toLowerCase().includes(s))
  }, [q, commands])
  const current = Math.min(active, Math.max(0, list.length - 1))

  function close() { setQ(''); setActive(0); onClose() }
  function run(c: Command | undefined) { if (!c) return; close(); c.run() }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((current + 1) % Math.max(1, list.length)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((current - 1 + list.length) % Math.max(1, list.length)) }
    else if (e.key === 'Enter') { e.preventDefault(); run(list[current]) }
  }

  return (
    <Dialog open={open} onClose={close} title="Go to" description="Search pages and actions" className="w-[min(36rem,calc(100vw-2rem))]">
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
          <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setActive(0) }} onKeyDown={onKey}
            role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-activedescendant={list[current] ? `cmdk-${list[current].id}` : undefined}
            aria-label="Search pages and actions" placeholder="Type a page or action…"
            className="h-11 w-full rounded-xl border border-line bg-ink-900 pl-9 pr-3 text-sm text-fg outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-400/30" />
        </div>
        <ul id="cmdk-list" role="listbox" aria-label="Results" className="max-h-80 overflow-y-auto">
          {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-500">No matches.</li>}
          {list.map((c, i) => (
            <li key={c.id} id={`cmdk-${c.id}`} role="option" aria-selected={i === current}
              onMouseEnter={() => setActive(i)} onClick={() => run(c)}
              className={cn('flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm', i === current ? 'bg-brand-500/10 text-brand-600' : 'text-ink-100')}>
              <c.icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{c.label}</span>
              {c.hint && <span className="text-xs text-ink-500">{c.hint}</span>}
              {i === current && <CornerDownLeft className="h-3.5 w-3.5 text-ink-500" aria-hidden />}
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  )
}
