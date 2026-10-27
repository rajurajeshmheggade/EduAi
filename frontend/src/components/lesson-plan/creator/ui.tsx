/* Lesson Plan Creator — shared presentational pieces (Rapid's Section / CardHead / MiniBtn / ChipCard /
   GenerateCta / EmptyHint / AddResources), restyled on EduAI's tokens. */
import { useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Bot, ChevronDown, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/field'
import { cn } from '@/lib/utils'
import { LE_RESOURCES } from '../data'
import { useDismiss } from './hooks'

/* Per-step colour coding (light tints, not loud blocks). Literal class strings so Tailwind can see them. */
const TONES = {
  brand: { band: 'from-brand-500/[0.05]', line: 'via-brand-400/40', tile: 'from-brand-500 to-brand-600 shadow-brand-500/30', title: 'from-brand-500 to-brand-600' },
  purple: { band: 'from-purple-500/[0.05]', line: 'via-purple-400/40', tile: 'from-purple-500 to-purple-600 shadow-purple-500/30', title: 'from-purple-600 to-purple-800' },
  emerald: { band: 'from-emerald-500/[0.05]', line: 'via-emerald-400/40', tile: 'from-emerald-500 to-emerald-600 shadow-emerald-500/30', title: 'from-emerald-600 to-emerald-800' },
  indigo: { band: 'from-indigo-500/[0.05]', line: 'via-indigo-400/40', tile: 'from-indigo-500 to-purple-600 shadow-indigo-500/30', title: 'from-indigo-600 to-purple-800' },
  pink: { band: 'from-pink-500/[0.05]', line: 'via-pink-400/40', tile: 'from-pink-500 to-pink-600 shadow-pink-500/30', title: 'from-pink-600 to-pink-800' },
  teal: { band: 'from-teal-500/[0.05]', line: 'via-teal-400/40', tile: 'from-teal-500 to-cyan-600 shadow-teal-500/30', title: 'from-teal-600 to-cyan-800' },
  amber: { band: 'from-amber-400/[0.07]', line: 'via-amber-400/40', tile: 'from-amber-400 to-orange-500 shadow-amber-400/30', title: 'from-amber-600 to-orange-700' },
} as const
export type SectionTone = keyof typeof TONES

/** A colour-coded step band. `data-step` lets the creator observe it (current step) and scroll to it. */
export function Section({ step, tone, icon: Icon, title, subtitle, children }: {
  step: number; tone: SectionTone; icon: LucideIcon; title: string; subtitle: string; children: ReactNode
}) {
  const t = TONES[tone]
  return (
    <section data-step={step} aria-label={title} className={cn('relative scroll-mt-14 bg-gradient-to-br to-transparent py-12 md:py-14', t.band)}>
      <div className={cn('absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent', t.line)} />
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="mb-10 text-center">
          <div className={cn('mx-auto mb-5 grid h-20 w-20 place-items-center rounded-3xl bg-gradient-to-br text-white shadow-lg', t.tile)}>
            <Icon className="h-10 w-10" />
          </div>
          <h2 className={cn('bg-gradient-to-r bg-clip-text pb-0.5 font-display text-3xl font-semibold tracking-tight text-transparent md:text-[34px]', t.title)}>{title}</h2>
          <p className="mx-auto mt-2 max-w-xl text-base text-ink-500 md:text-[17px]">{subtitle}</p>
        </div>
        {children}
      </div>
    </section>
  )
}

/** Card header: tinted icon tile + title + subtitle, with an optional right-hand action. */
export function CardHead({ tile, icon: Icon, title, subtitle, right }: {
  tile: string; icon: LucideIcon; title: string; subtitle?: string; right?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl', tile)}><Icon className="h-5 w-5" /></span>
        <div>
          <h4 className="text-base font-semibold text-fg">{title}</h4>
          {subtitle && <p className="text-[13px] text-ink-500">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  )
}

const ICON_TONES = {
  brand: 'border-brand-400/30 text-brand-600 hover:bg-brand-500/10',
  green: 'border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/10',
  red: 'border-bad/30 text-bad hover:bg-bad/10',
  gray: 'border-line text-ink-300 hover:bg-ink-800',
} as const

/** Small square icon-only action (edit / regenerate / delete …). */
export function IconBtn({ label, tone = 'gray', onClick, disabled, children }: {
  label: string; tone?: keyof typeof ICON_TONES; onClick: () => void; disabled?: boolean; children: ReactNode
}) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}
      className={cn('inline-grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg border bg-ink-900 transition-colors disabled:cursor-not-allowed disabled:opacity-50', ICON_TONES[tone])}>
      {children}
    </button>
  )
}

export function Chip({ className, title, children }: { className?: string; title?: string; children: ReactNode }) {
  return <span title={title} className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', className)}>{children}</span>
}

/** Rapid's "dot + label" field header (Basic Setup). */
export function DotLabel({ dot, htmlFor, children }: { dot: string; htmlFor?: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-2 flex items-center gap-2 text-[13px] font-medium text-ink-300">
      <span aria-hidden className={cn('h-3 w-3 rounded-full', dot)} />{children}
    </label>
  )
}

export function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-ink-300">{children}</label>
}

export function EmptyHint({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-line bg-ink-900/60 px-5 py-9 text-center text-sm text-ink-500">{text}</div>
}

/** Big centred call-to-action. */
export function GenerateCta({ className, label, onClick, icon: Icon, disabled, title }: {
  className: string; label: string; onClick: () => void; icon: LucideIcon; disabled?: boolean; title?: string
}) {
  return (
    <div className="flex justify-center">
      <Button size="lg" onClick={onClick} disabled={disabled} title={title} className={cn('rounded-xl px-8 font-semibold', className)}>
        <Icon className="h-[18px] w-[18px]" />{label}
      </Button>
    </div>
  )
}

/** Skills / Competencies card: generate button + AI chips + a custom entry box (Enter / comma / blur commits). */
export function ChipCard({ id, title, icon, tile, genLabel, genClass, onGenerate, items, onRemove, chipClass, heading, headClass,
  custom, setCustom, placeholder, onAddCustom }: {
  id: string; title: string; icon: LucideIcon; tile: string; genLabel: string; genClass: string; onGenerate: () => void
  items: string[]; onRemove: (v: string) => void; chipClass: string; heading: string; headClass: string
  custom: string; setCustom: (v: string) => void; placeholder: string; onAddCustom: () => void
}) {
  return (
    <Card className="p-6">
      <CardHead tile={tile} icon={icon} title={title} right={
        <Button size="sm" onClick={onGenerate} className={cn('h-9 px-4', genClass)}><Bot className="h-4 w-4" />{genLabel}</Button>
      } />
      {items.length > 0 && (
        <div className={cn('mb-3.5 rounded-xl border p-4', headClass)}>
          <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold"><Bot className="h-4 w-4" />{heading}</div>
          <div className="flex flex-wrap gap-2">
            {items.map((it) => (
              <span key={it} className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[13px] font-semibold', chipClass)}>
                <Bot className="h-3 w-3" />{it}
                <button type="button" aria-label={`Remove ${it}`} title="Remove" onClick={() => onRemove(it)} className="ml-0.5 inline-flex cursor-pointer rounded hover:opacity-70">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
      <Input id={id} aria-label={placeholder} value={custom} placeholder={placeholder} className="bg-ink-800"
        onChange={(e) => setCustom(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); onAddCustom() } }}
        onBlur={onAddCustom} />
    </Card>
  )
}

/** "+ Add Resources" floating menu — click a resource (or add a custom one) to append a resource card.
    Duplicates are allowed. Its parent card must not be overflow-hidden, or the menu is clipped. */
export function AddResources({ onAdd }: { onAdd: (name: string) => void }) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const wrapRef = useDismiss<HTMLDivElement>(open, () => setOpen(false))
  const add = () => { const v = custom.trim(); if (v) { onAdd(v); setCustom('') } }
  return (
    <div ref={wrapRef} className="relative">
      <Button variant="secondary" size="sm" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}
        className={cn('h-9 bg-ink-900', open && 'bg-teal-500/10')}>
        <Plus className="h-3.5 w-3.5" />Add Resources
        <ChevronDown className={cn('h-3.5 w-3.5 text-ink-500 transition-transform', open && 'rotate-180')} />
      </Button>
      {open && (
        <div role="menu" className="glass absolute right-0 top-11 z-50 w-[min(340px,85vw)] overflow-hidden rounded-xl shadow-xl">
          <div className="border-b border-line px-3.5 py-3">
            <div className="text-[13px] font-semibold text-fg">Add Resources</div>
            <div className="mt-0.5 text-[11.5px] text-ink-500">Click a resource to add it, or add a custom one</div>
            <label htmlFor="le-custom-resource" className="mb-1 mt-2.5 block text-[11.5px] font-medium text-ink-300">Custom Resource:</label>
            <div className="flex gap-2">
              <Input id="le-custom-resource" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Enter custom resource..." className="h-9"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
              <Button size="sm" variant="secondary" className="h-9" onClick={add}>Add</Button>
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {LE_RESOURCES.map((r) => (
              <button key={r} type="button" role="menuitem" onClick={() => onAdd(r)}
                className="flex w-full cursor-pointer items-center gap-2 px-3.5 py-2 text-left text-[13px] text-ink-300 transition-colors hover:bg-ink-800 hover:text-fg">
                <Plus className="h-3 w-3 shrink-0 text-teal-600" />{r}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Layer-3 fallback for a resource block that could not be validated — never renders raw JSON. */
export function ResourceFallback({ onRegenerate }: { onRegenerate: () => void }) {
  return (
    <div className="flex flex-col gap-2 py-1">
      <p className="text-[13px] text-ink-500">This resource couldn’t be loaded. Please regenerate it.</p>
      <div>
        <Button size="sm" variant="secondary" onClick={onRegenerate} className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15">Regenerate</Button>
      </div>
    </div>
  )
}
