import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const field =
  'w-full rounded-xl border border-line bg-ink-900/70 px-3.5 text-sm text-ink-100 placeholder:text-ink-500 ' +
  'transition-colors focus:border-brand-400/70 focus:bg-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:opacity-50'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(field, 'h-10', className)} {...p} />
))
Input.displayName = 'Input'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(field, 'py-2.5 leading-relaxed', className)} {...p} />
))
Textarea.displayName = 'Textarea'

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => (
  <select ref={ref} className={cn(field, 'h-10 cursor-pointer pr-8', className)} {...p} />
))
Select.displayName = 'Select'

export function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-300">{children}</label>
}
