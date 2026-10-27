import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, Bot, ClipboardList, Loader2, Plus, RefreshCw, Star, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/field'
import { cn } from '@/lib/utils'

/** Portalled modal overlay (an animated ancestor would otherwise trap a fixed overlay). */
export function Overlay({ children, onClose, z = 'z-[300]' }: { children: ReactNode; onClose?: () => void; z?: string }) {
  useEffect(() => {
    if (!onClose) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return createPortal(
    <div className={cn('fixed inset-0 grid place-items-center overflow-y-auto bg-fg/40 p-6 backdrop-blur-sm animate-fade-up', z)}
      onClick={(e) => { if (e.target === e.currentTarget && onClose) onClose() }}>
      {children}
    </div>,
    document.body,
  )
}

/** "Regenerate with Additional Instructions" — optional guidance (≤500 chars) for any AI regenerate action.
    onConfirm does NOT close it: the caller owns `busy` and closes it when the AI call returns. */
export function RegenerateDialog({ open, ...rest }: {
  open: boolean; title?: string; subtitle?: string; busy?: boolean; onCancel: () => void; onConfirm: (instructions: string) => void
}) {
  // Mounted fresh on every open, so the instructions box always starts empty.
  return open ? <RegenerateBody {...rest} /> : null
}

function RegenerateBody({ title = 'Regenerate Content', subtitle, busy = false, onCancel, onConfirm }: {
  title?: string; subtitle?: string; busy?: boolean; onCancel: () => void; onConfirm: (instructions: string) => void
}) {
  const [text, setText] = useState('')
  return (
    <Overlay onClose={busy ? undefined : onCancel}>
      <div className="glass w-[min(460px,94vw)] rounded-2xl" role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-start justify-between gap-3 px-6 pb-1 pt-5">
          <div>
            <h3 className="font-display text-lg font-semibold text-fg">{title}</h3>
            {subtitle && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">{subtitle}</p>}
          </div>
          <button type="button" aria-label="Close" onClick={onCancel} disabled={busy} className="cursor-pointer rounded-lg p-1 text-ink-500 hover:bg-ink-800 hover:text-fg"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-6 pb-1 pt-2">
          <label htmlFor="regen-instructions" className="mb-1.5 block text-xs font-semibold text-ink-300">Additional Instructions</label>
          <Textarea id="regen-instructions" rows={4} maxLength={500} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Enter any specific requirements or modifications you want for the regenerated content…" />
          <div className="mt-1 text-right text-[11.5px] text-ink-500">{text.length}/500 characters</div>
        </div>
        <div className="flex justify-end gap-2.5 px-6 pb-5 pt-3">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button onClick={() => onConfirm(text.trim())} disabled={busy}>
            <RefreshCw className={cn('h-4 w-4', busy && 'animate-spin')} />{busy ? 'Regenerating…' : 'Regenerate'}
          </Button>
        </div>
      </div>
    </Overlay>
  )
}

/** Shared "AI Bot / Manual" chooser (Create Lesson Plan). */
export function AiManualDialog({ badge, title, subtitle, aiDesc, manualDesc, onPick, onClose }: {
  badge?: string; title: string; subtitle: string; aiDesc: string; manualDesc: string
  onPick: (mode: 'ai' | 'manual') => void; onClose: () => void
}) {
  return (
    <Overlay onClose={onClose}>
      <div className="glass relative w-[min(820px,100%)] overflow-hidden rounded-[28px]" role="dialog" aria-modal="true" aria-label={title}>
        <button type="button" aria-label="Close" onClick={onClose} className="absolute right-5 top-5 z-10 cursor-pointer rounded-lg p-2 text-ink-500 hover:bg-ink-800 hover:text-fg"><X className="h-4 w-4" /></button>
        <div className="px-10 pb-6 pt-9">
          {badge && <span className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-brand-500/10 px-3.5 py-1.5 text-xs font-medium uppercase tracking-wider text-brand-600"><Plus className="h-3.5 w-3.5" />{badge}</span>}
          <h2 className="font-display text-3xl font-semibold tracking-tight text-fg">{title}</h2>
          <p className="mt-2.5 text-base text-ink-300">{subtitle}</p>
        </div>
        <div className="grid gap-5 px-10 pb-10 sm:grid-cols-2">
          <ChoiceCard tone="ai" title="AI Bot" desc={aiDesc} recommended onClick={() => onPick('ai')} icon={<Bot className="h-6 w-6" />} />
          <ChoiceCard tone="manual" title="Manual" desc={manualDesc} onClick={() => onPick('manual')} icon={<ClipboardList className="h-6 w-6" />} />
        </div>
      </div>
    </Overlay>
  )
}

function ChoiceCard({ tone, title, desc, icon, recommended, onClick }: { tone: 'ai' | 'manual'; title: string; desc: string; icon: ReactNode; recommended?: boolean; onClick: () => void }) {
  const t = tone === 'ai'
    ? { tile: 'bg-purple-500/12 text-purple-600 group-hover:bg-purple-600 group-hover:text-white', ring: 'hover:border-purple-400 hover:shadow-[0_18px_38px_-16px_rgb(168_85_247/.35)]', pill: 'bg-purple-500/12 text-purple-600', cta: 'group-hover:text-purple-600' }
    : { tile: 'bg-brand-500/12 text-brand-600 group-hover:bg-brand-600 group-hover:text-white', ring: 'hover:border-brand-400 hover:shadow-[0_18px_38px_-16px_rgb(79_70_229/.35)]', pill: '', cta: 'group-hover:text-brand-600' }
  return (
    <button type="button" onClick={onClick} id={`create-${tone}`}
      className={cn('group flex cursor-pointer flex-col items-start rounded-[20px] border-2 border-line bg-ink-900 p-6 text-left transition-all duration-300 hover:-translate-y-1', t.ring)}>
      <div className="mb-5 flex w-full items-start justify-between">
        <span className={cn('relative grid h-14 w-14 place-items-center rounded-2xl transition-all duration-300 group-hover:scale-105', t.tile)}>
          {icon}
          {tone === 'ai' && <Star className="absolute -right-1.5 -top-1.5 h-4.5 w-4.5 fill-amber-400 text-amber-400" />}
        </span>
        {recommended && <span className={cn('rounded-full px-3 py-1 text-xs font-medium', t.pill)}>Recommended</span>}
      </div>
      <h3 className="mb-2.5 font-display text-xl font-semibold text-fg">{title}</h3>
      <p className="mb-5 text-sm leading-relaxed text-ink-300">{desc}</p>
      <span className={cn('mt-auto inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 transition-all group-hover:gap-2.5', t.cta)}>Continue <ArrowRight className="h-4 w-4" /></span>
    </button>
  )
}

/** Delete / discard confirmation. Dismissed deliberately (Cancel / Esc) — a backdrop click does not close it. */
export function ConfirmDialog({ title, message, confirmLabel = 'Delete', danger = true, busy, onConfirm, onClose }: {
  title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void
}) {
  return (
    <Overlay onClose={onClose}>
      <div className="glass w-[min(440px,100%)] rounded-2xl" role="alertdialog" aria-modal="true" aria-label={title}>
        <div className="flex gap-3.5 px-6 pb-2 pt-6">
          <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl', danger ? 'bg-bad/12 text-bad' : 'bg-brand-500/12 text-brand-600')}><Trash2 className="h-5 w-5" /></span>
          <div className="min-w-0">
            <h3 className="font-display text-lg font-semibold text-fg">{title}</h3>
            <div className="mt-1.5 text-sm leading-relaxed text-ink-300">{message}</div>
          </div>
        </div>
        <div className="flex justify-end gap-2.5 px-6 pb-5 pt-4">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'default'} onClick={onConfirm} disabled={busy} className={danger ? '!bg-bad !text-white hover:!brightness-110' : undefined}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{confirmLabel}
          </Button>
        </div>
      </div>
    </Overlay>
  )
}
