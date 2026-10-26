import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Modal built on <dialog>: focus trapping, Esc to close and backdrop come from the browser. */
export function Dialog({ open, onClose, title, description, children, className }: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal?.()
    if (!open && d.open) d.close?.()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose() }}
      aria-labelledby="dialog-title"
      className={cn(
        'm-auto w-[min(34rem,calc(100vw-2rem))] rounded-2xl border border-line bg-ink-900 p-0 text-ink-100 shadow-2xl backdrop:bg-fg/30 backdrop:backdrop-blur-sm',
        className,
      )}
    >
      {open && (
        <div className="p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 id="dialog-title" className="font-display text-lg font-semibold">{title}</h2>
              {description && <p className="mt-0.5 text-sm text-ink-300">{description}</p>}
            </div>
            <button onClick={onClose} aria-label="Close" className="cursor-pointer rounded-lg p-1 text-ink-500 hover:bg-ink-800 hover:text-fg"><X className="h-4 w-4" /></button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  )
}
