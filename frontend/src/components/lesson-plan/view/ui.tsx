/* Lesson Plan View — small presentational pieces shared by the sections. */

import type { ReactNode } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/field'
import { cn } from '@/lib/utils'
import { rowsFor } from './edit'

/** Rounded chip (Rapid's `pill(bg, color)`); colour comes from the caller's Tailwind tint classes. */
export function Pill({ className, children }: { className: string; children: ReactNode }) {
  return <span className={cn('inline-flex items-center rounded-full px-3 py-0.5 text-xs font-medium', className)}>{children}</span>
}

/** Section title with its bottom rule and the Edit → Save / Cancel controls. */
export function SectionHead({ title, showEdit, editing, editLocked, onEdit, onSave, onCancel }: {
  title: string; showEdit: boolean; editing: boolean; editLocked: boolean
  onEdit: () => void; onSave: () => void; onCancel: () => void
}) {
  return (
    <div className="mb-6 flex items-center justify-between gap-3 border-b border-line pb-2 break-after-avoid">
      <h2 className="font-display text-2xl font-bold text-fg">{title}</h2>
      {showEdit && (editing ? (
        <div className="flex items-center gap-2 print:hidden">
          <Button size="sm" onClick={onSave} aria-label={`Save ${title}`}><Check className="h-3.5 w-3.5" />Save</Button>
          <Button size="sm" variant="secondary" onClick={onCancel} aria-label={`Cancel editing ${title}`}><X className="h-3.5 w-3.5" />Cancel</Button>
        </div>
      ) : (
        <Button size="sm" variant="secondary" className="print:hidden" onClick={onEdit} disabled={editLocked} aria-label={`Edit ${title}`}>
          <Pencil className="h-3.5 w-3.5" />Edit
        </Button>
      ))}
    </div>
  )
}

/** One label / value pair of the meta grid. Empty values show an em dash. */
export function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-sm font-medium uppercase tracking-wider text-ink-500">{label}</span>
      <span className="break-words text-lg font-semibold text-fg">{value || '—'}</span>
    </div>
  )
}

/** Stored plain text, line breaks kept (the display model already reduced legacy HTML to text). */
export function TextView({ text, className }: { text: string; className?: string }) {
  if (!text) return null
  return <div className={cn('whitespace-pre-wrap break-words leading-relaxed', className)}>{text}</div>
}

/** Auto-height plain-text editor. */
export function EditArea({ value, onChange, label, minRows = 2, className, placeholder }: {
  value: string; onChange: (v: string) => void; label: string; minRows?: number; className?: string; placeholder?: string
}) {
  return (
    <Textarea value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} placeholder={placeholder}
      rows={rowsFor(value, minRows)} className={cn('resize-y', className)} />
  )
}

/** Single-line editor (titles, MCQ options, answers). */
export function EditInput({ value, onChange, label, className, placeholder }: {
  value: string; onChange: (v: string) => void; label: string; className?: string; placeholder?: string
}) {
  return <Input value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} placeholder={placeholder} className={className} />
}

/** Muted italic note ("No content generated yet.", empty sections). */
export function Muted({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-xs italic text-ink-500', className)}>{children}</p>
}
