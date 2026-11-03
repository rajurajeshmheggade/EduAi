import { Input, Select, Textarea } from '@/components/ui/field'
import { cn } from '@/lib/utils'
import { CORE, type AnswerValue, type Answers, type FieldDef, type SectionDef } from '@/lib/admissionForm'

export interface GradeOption { value: number; label: string }

const INPUT_TYPE: Partial<Record<FieldDef['type'], string>> = { email: 'email', phone: 'tel', date: 'date', number: 'number' }
const AUTOCOMPLETE: Partial<Record<string, string>> = {
  student_name: 'off', guardian_name: 'name', guardian_phone: 'tel', guardian_email: 'email', date_of_birth: 'off',
}

/** One form field as the applicant sees it (also used, live, in the teacher's preview). Labels, hints and errors are
 * wired with aria-describedby / aria-invalid; required fields are marked for screen readers too. */
export function FieldInput({ f, value, onChange, error, grades, idPrefix = 'f', disabled = false }: {
  f: FieldDef; value: AnswerValue | undefined; onChange: (v: AnswerValue | null) => void; error?: string | null
  grades: GradeOption[]; idPrefix?: string; disabled?: boolean
}) {
  const id = `${idPrefix}-${f.key}`
  const required = !!(f.required || (f.core && CORE[f.core].required))
  const describedBy = [f.help ? `${id}-help` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined
  const common = { id, disabled, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy, 'aria-required': required || undefined }
  const str = value === undefined || value === null ? '' : String(value)
  let control: React.ReactNode
  if (f.type === 'checkbox') {
    return (
      <div className="space-y-1">
        <label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-ink-900/70 p-3 text-sm text-ink-100">
          <input type="checkbox" {...common} checked={value === true} onChange={(e) => onChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-brand-500)]" />
          <span>{f.label}{required && <span className="text-bad" aria-hidden> *</span>}</span>
        </label>
        {f.help && <p id={`${id}-help`} className="text-xs text-ink-500">{f.help}</p>}
        {error && <p id={`${id}-error`} role="alert" className="text-xs font-medium text-bad">{error}</p>}
      </div>
    )
  }
  if (f.type === 'textarea') {
    control = <Textarea {...common} rows={4} maxLength={f.max_length ?? 2000} placeholder={f.placeholder ?? undefined} value={str}
      onChange={(e) => onChange(e.target.value)} />
  } else if (f.type === 'select') {
    control = (
      <Select {...common} value={str} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Choose…</option>
        {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
      </Select>
    )
  } else if (f.type === 'grade') {
    control = (
      <Select {...common} value={str} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
        <option value="">Choose a class…</option>
        {grades.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
      </Select>
    )
  } else {
    control = <Input {...common} type={INPUT_TYPE[f.type] ?? 'text'} inputMode={f.type === 'phone' ? 'tel' : f.type === 'number' ? 'decimal' : undefined}
      autoComplete={(f.core && AUTOCOMPLETE[f.core]) || 'off'} placeholder={f.placeholder ?? undefined} value={str}
      min={f.type === 'number' && f.min != null ? f.min : undefined} max={f.type === 'number' && f.max != null ? f.max : undefined}
      maxLength={f.type === 'text' ? f.max_length ?? 200 : undefined}
      onChange={(e) => onChange(f.type === 'number' ? (e.target.value === '' ? null : e.target.value) : e.target.value)} />
  }
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-fg">
        {f.label}{required ? <span className="text-bad" aria-hidden> *</span> : <span className="ml-1 text-xs font-normal text-ink-500">(optional)</span>}
      </label>
      {control}
      {f.help && <p id={`${id}-help`} className="text-xs text-ink-500">{f.help}</p>}
      {error && <p id={`${id}-error`} role="alert" className="text-xs font-medium text-bad">{error}</p>}
    </div>
  )
}

export function SectionFields({ section, answers, onChange, errors = {}, grades, idPrefix, disabled, className }: {
  section: SectionDef; answers: Answers; onChange: (key: string, v: AnswerValue | null) => void; errors?: Record<string, string>
  grades: GradeOption[]; idPrefix?: string; disabled?: boolean; className?: string
}) {
  return (
    <div className={cn('grid gap-4 sm:grid-cols-2', className)}>
      {section.fields.map((f) => (
        <div key={f.key} className={f.type === 'textarea' || f.type === 'checkbox' ? 'sm:col-span-2' : undefined}>
          <FieldInput f={f} value={answers[f.key]} onChange={(v) => onChange(f.key, v)} error={errors[f.key]} grades={grades}
            idPrefix={idPrefix} disabled={disabled} />
        </div>
      ))}
    </div>
  )
}

/** Plain text with paragraph breaks (instructions, consent notice): never rendered as HTML. */
export function PlainText({ text, className }: { text: string; className?: string }) {
  return <div className={cn('space-y-2 whitespace-pre-line text-sm leading-relaxed text-ink-300', className)}>{text}</div>
}
