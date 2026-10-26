import { BookMarked } from 'lucide-react'
import { cn } from '@/lib/utils'

export function PageCitationBadge({ page, onJump, active, className }: { page: number; onJump: (page: number) => void; active?: boolean; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => onJump(page)}
      title={`Jump to page ${page} in the textbook`}
      className={cn(
        'mx-0.5 inline-flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-px align-baseline text-[11px] font-semibold transition-all',
        'border-aqua-400/40 bg-aqua-500/10 text-aqua-400 hover:-translate-y-px hover:bg-aqua-500/25',
        active && 'bg-aqua-500/30 ring-1 ring-aqua-400/60',
        className,
      )}
    >
      <BookMarked className="h-3 w-3" />Page {page}
    </button>
  )
}
