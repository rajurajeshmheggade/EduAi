import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ToastTone = 'info' | 'success' | 'error'
interface ToastMsg { id: number; text: string; tone: ToastTone }

const EVENT = 'eduai:toast'
let seq = 0

/** Fire-and-forget notification, e.g. toast('Lesson plan saved', 'success'). Rendered by <Toaster/>. */
export function toast(text: string, tone?: ToastTone) {
  const t: ToastTone = tone ?? (/^✓/.test(text) ? 'success' : /^✗/.test(text) ? 'error' : 'info')
  window.dispatchEvent(new CustomEvent<ToastMsg>(EVENT, { detail: { id: ++seq, text: text.replace(/^[✓✗]\s*/, ''), tone: t } }))
}

const ICON = { info: Info, success: CheckCircle2, error: TriangleAlert }
const TONE = {
  info: 'border-brand-400/30 text-ink-100',
  success: 'border-ok/30 text-ink-100',
  error: 'border-bad/30 text-ink-100',
}
const ICON_TONE = { info: 'text-brand-400', success: 'text-ok', error: 'text-bad' }

export function Toaster() {
  const [items, setItems] = useState<ToastMsg[]>([])
  useEffect(() => {
    const on = (e: Event) => {
      const m = (e as CustomEvent<ToastMsg>).detail
      setItems((xs) => [...xs.slice(-3), m])
      window.setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== m.id)), m.tone === 'error' ? 6000 : 3500)
    }
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [])
  if (!items.length) return null
  return createPortal(
    <div className="pointer-events-none fixed bottom-5 right-5 z-[10000] flex w-[min(24rem,calc(100vw-2.5rem))] flex-col gap-2" role="status" aria-live="polite">
      {items.map((m) => {
        const Icon = ICON[m.tone]
        return (
          <div key={m.id} className={cn('glass pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm shadow-lg animate-fade-up', TONE[m.tone])}>
            <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', ICON_TONE[m.tone])} />
            <span className="flex-1 leading-snug">{m.text}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setItems((xs) => xs.filter((x) => x.id !== m.id))}
              className="cursor-pointer rounded p-0.5 text-ink-500 hover:text-fg"><X className="h-3.5 w-3.5" /></button>
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
