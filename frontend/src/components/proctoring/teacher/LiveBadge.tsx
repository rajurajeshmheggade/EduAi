import { cn } from '@/lib/utils'
import type { LiveState } from './useProctorLive'

const META: Record<LiveState, { label: string; dot: string; hint: string }> = {
  live: { label: 'Live', dot: 'bg-ok animate-pulse', hint: 'Updates arrive as they happen' },
  connecting: { label: 'Connecting…', dot: 'bg-ink-500', hint: 'Opening the live connection' },
  polling: { label: 'Refreshing every 10 s', dot: 'bg-warn', hint: 'The live connection dropped; reconnecting in the background' },
}

export function LiveBadge({ state }: { state: LiveState }) {
  const m = META[state]
  return (
    <span role="status" title={m.hint} className="inline-flex items-center gap-2 rounded-full border border-line bg-ink-900 px-3 py-1 text-xs text-ink-300">
      <span className={cn('h-2 w-2 rounded-full', m.dot)} aria-hidden />{m.label}
    </span>
  )
}
