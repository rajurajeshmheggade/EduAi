import { forwardRef, useId, useState, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'
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

/**
 * Password field with a show/hide toggle (eye icon), reused everywhere a password is entered: login, change /
 * reset password, teacher and student creation. Never shown by default; toggling never clears or mutates the
 * entered value, and the value itself is never logged or persisted anywhere by this component.
 */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  ({ className, id, ...p }, ref) => {
    const [show, setShow] = useState(false)
    const autoId = useId()
    const inputId = id ?? autoId
    return (
      <div className="relative">
        <input ref={ref} id={inputId} type={show ? 'text' : 'password'} className={cn(field, 'h-10 pr-10', className)} {...p} />
        <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
          aria-controls={inputId} tabIndex={0}
          className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 cursor-pointer place-items-center rounded-lg text-ink-500 hover:bg-ink-800 hover:text-fg">
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    )
  },
)
PasswordInput.displayName = 'PasswordInput'
