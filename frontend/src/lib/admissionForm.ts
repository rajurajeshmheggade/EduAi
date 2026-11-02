/**
 * Admission form definitions, shared by the teacher's form builder / preview and the standalone applicant app.
 * Mirrors backend/app/services/admission/forms.py (the server re-checks everything).
 */
import type { CSSProperties } from 'react'

export type FieldType = 'text' | 'textarea' | 'email' | 'phone' | 'date' | 'number' | 'select' | 'checkbox' | 'grade'
export type SectionKind = 'student' | 'guardian' | 'academic' | 'custom'
export type DocKind = 'pdf' | 'jpg' | 'png'
export type CoreKey = 'student_name' | 'date_of_birth' | 'grade_applying' | 'gender' | 'previous_school' | 'guardian_name'
  | 'guardian_relationship' | 'guardian_phone' | 'guardian_email'

export interface FieldDef {
  key: string; label: string; type: FieldType; required?: boolean; help?: string | null; placeholder?: string | null
  options?: string[]; min?: number | null; max?: number | null; max_length?: number | null; core?: CoreKey | null
}
export interface SectionDef { key: string; title: string; description?: string | null; kind: SectionKind; fields: FieldDef[] }
export interface DocumentDef { key: string; label: string; required?: boolean; accept: DocKind[]; max_mb: number; max_files: number; help?: string | null }
export interface FormDefinition { instructions: string; declaration: string; sections: SectionDef[]; documents: DocumentDef[] }
export type AnswerValue = string | number | boolean
export type Answers = Record<string, AnswerValue>

/** Shown after the issuer copies applicant credentials and acknowledges them (wording fixed by the product owner). */
export const ACK_MESSAGE = 'Admission application credentials have been copied successfully. Please save these credentials securely.'

export const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Short text' }, { value: 'textarea', label: 'Paragraph' }, { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' }, { value: 'date', label: 'Date' }, { value: 'number', label: 'Number' },
  { value: 'select', label: 'Choice list' }, { value: 'checkbox', label: 'Tick box' }, { value: 'grade', label: 'Class applying for' },
]
export const SECTION_KINDS: { value: SectionKind; label: string }[] = [
  { value: 'student', label: 'Student information' }, { value: 'guardian', label: 'Parent / guardian' },
  { value: 'academic', label: 'Academic details' }, { value: 'custom', label: 'Other' },
]
export const DOC_KINDS: { value: DocKind; label: string; mime: string; ext: string[] }[] = [
  { value: 'pdf', label: 'PDF', mime: 'application/pdf', ext: ['.pdf'] },
  { value: 'jpg', label: 'JPEG', mime: 'image/jpeg', ext: ['.jpg', '.jpeg'] },
  { value: 'png', label: 'PNG', mime: 'image/png', ext: ['.png'] },
]

export const CORE: Record<CoreKey, { types: FieldType[]; required: boolean; label: string }> = {
  student_name: { types: ['text'], required: true, label: "Student's name" },
  date_of_birth: { types: ['date'], required: true, label: 'Date of birth' },
  grade_applying: { types: ['grade'], required: true, label: 'Class applying for' },
  gender: { types: ['select'], required: false, label: 'Gender' },
  previous_school: { types: ['text'], required: false, label: 'Previous school' },
  guardian_name: { types: ['text'], required: true, label: 'Parent / guardian name' },
  guardian_relationship: { types: ['select'], required: true, label: 'Relationship' },
  guardian_phone: { types: ['phone'], required: true, label: 'Parent / guardian phone' },
  guardian_email: { types: ['email'], required: false, label: 'Parent / guardian email' },
}
export const REQUIRED_CORE = (Object.keys(CORE) as CoreKey[]).filter((k) => CORE[k].required)

export const GRADES = [-2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
const GRADE_NAMES: Record<number, string> = { [-2]: 'Nursery', [-1]: 'LKG', 0: 'UKG' }
export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
export const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
export const gradeLabel = (g: number | null | undefined) => (g === null || g === undefined ? '' : GRADE_NAMES[g] ?? `Class ${g}`)

const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/
const PHONE_RE = /^\+?[0-9][0-9 \-()]{5,19}$/
export const MIN_AGE = 2
export const MAX_AGE = 25

/** A stable key from a label, unique among `taken` (keys never change after creation). */
export function keyFrom(label: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  let base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32)
  if (!base) base = 'field'
  else if (!/^[a-z]/.test(base)) base = `f_${base}`
  if (base.length < 2) base = `${base}_field`
  let key = base
  for (let i = 2; used.has(key) || !KEY_RE.test(key); i++) key = `${base.slice(0, 34)}_${i}`
  return key
}

export const allFields = (d: FormDefinition) => d.sections.flatMap((s) => s.fields)
export const allKeys = (d: FormDefinition) => [...allFields(d).map((f) => f.key), ...d.documents.map((x) => x.key), ...d.sections.map((s) => s.key)]

export function newField(type: FieldType, label: string, taken: Iterable<string>): FieldDef {
  return { key: keyFrom(label, taken), label, type, required: false, help: null, placeholder: null,
    options: type === 'select' ? ['Option 1', 'Option 2'] : [], min: null, max: null, max_length: null, core: null }
}

/** Structural problems (would be refused on save) plus the extra checks made at publication. */
export function definitionProblems(d: FormDefinition, { publishing = false } = {}): string[] {
  const out: string[] = []
  if (!d.sections.length) out.push('Add at least one section')
  const keys = allFields(d).map((f) => f.key)
  const dup = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))]
  if (dup.length) out.push(`Field keys must be unique: ${dup.join(', ')}`)
  if (new Set(d.sections.map((s) => s.key)).size !== d.sections.length) out.push('Section keys must be unique')
  if (new Set(d.documents.map((x) => x.key)).size !== d.documents.length) out.push('Document keys must be unique')
  for (const s of d.sections) {
    if (!s.title.trim()) out.push('Every section needs a title')
    for (const f of s.fields) {
      if (!f.label.trim()) out.push(`A field in “${s.title || 'untitled'}” has no label`)
      if (f.type === 'select') {
        const opts = (f.options ?? []).map((o) => o.trim())
        if (!opts.length || opts.some((o) => !o)) out.push(`“${f.label}” needs at least one option, none empty`)
        else if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) out.push(`“${f.label}” has repeated options`)
      }
      if (f.min != null && f.max != null && f.min > f.max) out.push(`“${f.label}”: minimum is above maximum`)
      if (f.core && !CORE[f.core].types.includes(f.type)) out.push(`“${f.label}” must stay a ${f.type} field`)
    }
  }
  for (const x of d.documents) {
    if (!x.label.trim()) out.push('Every document needs a name')
    if (!x.accept.length) out.push(`“${x.label}”: allow at least one file type`)
  }
  if (publishing) {
    const cores = new Set(allFields(d).map((f) => f.core).filter(Boolean))
    const missing = REQUIRED_CORE.filter((k) => !cores.has(k))
    if (missing.length) out.push(`Add the required fields: ${missing.map((k) => CORE[k].label.toLowerCase()).join(', ')}`)
    if (!d.declaration.trim()) out.push('Add the declaration the applicant confirms before submitting')
    for (const s of d.sections) if (!s.fields.length) out.push(`Section “${s.title}” has no fields`)
  }
  return out
}

export function ageOn(dob: string, when = new Date()): number {
  const [y, m, day] = dob.split('-').map(Number)
  let age = when.getFullYear() - y
  if (when.getMonth() + 1 < m || (when.getMonth() + 1 === m && when.getDate() < day)) age -= 1
  return age
}

const isEmpty = (f: FieldDef, v: AnswerValue | undefined) =>
  v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (f.type === 'checkbox' && v === false)

/** Error message for one field, or null. Same rules as the server's submission check. */
export function validateField(f: FieldDef, v: AnswerValue | undefined, grades: number[]): string | null {
  if (isEmpty(f, v)) return f.required || (f.core && CORE[f.core].required) ? 'This field is required' : null
  const s = typeof v === 'string' ? v.trim() : v
  switch (f.type) {
    case 'text': case 'textarea': {
      const limit = f.max_length ?? (f.type === 'text' ? 200 : 2000)
      return String(s).length > limit ? `Use at most ${limit} characters` : null
    }
    case 'email': return typeof s === 'string' && EMAIL_RE.test(s) && s.length <= 254 ? null : 'Enter a valid email address'
    case 'phone': return typeof s === 'string' && PHONE_RE.test(s) ? null : 'Enter a valid phone number'
    case 'date': {
      if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) return 'Enter a valid date'
      if (f.core === 'date_of_birth') {
        const age = ageOn(s)
        if (age < MIN_AGE || age > MAX_AGE) return `The date of birth gives an age outside ${MIN_AGE}–${MAX_AGE} years`
      }
      return null
    }
    case 'number': {
      const n = typeof s === 'number' ? s : Number(s)
      if (typeof s === 'boolean' || Number.isNaN(n) || String(s).trim() === '') return 'Enter a number'
      if (f.min != null && n < f.min) return `Must be at least ${f.min}`
      if (f.max != null && n > f.max) return `Must be at most ${f.max}`
      return null
    }
    case 'select': return (f.options ?? []).includes(String(s)) ? null : 'Choose one of the options'
    case 'checkbox': return typeof s === 'boolean' ? null : 'Tick or untick the box'
    case 'grade': return grades.includes(Number(s)) ? null : 'Choose one of the classes offered'
  }
}

export function validateSection(s: SectionDef, answers: Answers, grades: number[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of s.fields) {
    const e = validateField(f, answers[f.key], grades)
    if (e) out[f.key] = e
  }
  return out
}

export function validateAnswers(d: FormDefinition, answers: Answers, grades: number[]): Record<string, string> {
  return Object.assign({}, ...d.sections.map((s) => validateSection(s, answers, grades)))
}

export function documentProblems(d: FormDefinition, counts: Record<string, number>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const x of d.documents) {
    const n = counts[x.key] ?? 0
    if (x.required && n === 0) out[x.key] = 'Upload this document'
    else if (n > x.max_files) out[x.key] = `Upload at most ${x.max_files} file(s)`
  }
  return out
}

/** Client-side pre-check before an upload (the server checks the real content). */
export function fileProblem(doc: DocumentDef, file: { name: string; size: number }): string | null {
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'))
  const ok = DOC_KINDS.filter((k) => doc.accept.includes(k.value)).flatMap((k) => k.ext)
  if (!ok.includes(ext)) return `Choose a ${DOC_KINDS.filter((k) => doc.accept.includes(k.value)).map((k) => k.label).join(' / ')} file`
  if (file.size > doc.max_mb * 1024 * 1024) return `The file is larger than ${doc.max_mb} MB`
  if (file.size === 0) return 'The file is empty'
  return null
}

export const acceptAttr = (doc: DocumentDef) => DOC_KINDS.filter((k) => doc.accept.includes(k.value)).flatMap((k) => [k.mime, ...k.ext]).join(',')

export function sectionProgress(s: SectionDef, answers: Answers): { done: number; total: number } {
  const req = s.fields.filter((f) => f.required || (f.core && CORE[f.core].required))
  return { done: req.filter((f) => !isEmpty(f, answers[f.key])).length, total: req.length }
}

// ---------------------------------------------------------------- statuses
export type ApplicationStatus = 'draft' | 'test_pending' | 'submitted' | 'under_review' | 'correction_requested' | 'resubmitted' | 'approved' | 'rejected'
export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  draft: 'Draft', test_pending: 'Awaiting admission test', submitted: 'Submitted', under_review: 'Under review',
  correction_requested: 'Corrections requested', resubmitted: 'Resubmitted', approved: 'Approved', rejected: 'Not approved',
}
export const STATUS_TONE: Record<ApplicationStatus, 'neutral' | 'brand' | 'ok' | 'warn' | 'bad' | 'aqua'> = {
  draft: 'neutral', test_pending: 'aqua', submitted: 'brand', under_review: 'brand', correction_requested: 'warn',
  resubmitted: 'brand', approved: 'ok', rejected: 'bad',
}
export type CredentialStatus = 'issued' | 'in_use' | 'submitted' | 'revoked' | 'expired'
export const CREDENTIAL_LABEL: Record<CredentialStatus, string> = {
  issued: 'Issued', in_use: 'In use', submitted: 'Submitted · removed', revoked: 'Revoked', expired: 'Expired',
}
export const CREDENTIAL_TONE: Record<CredentialStatus, 'neutral' | 'brand' | 'ok' | 'warn' | 'bad' | 'aqua'> = {
  issued: 'brand', in_use: 'aqua', submitted: 'ok', revoked: 'bad', expired: 'warn',
}

// ---------------------------------------------------------------- branding
function hexToHsl(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => x / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s * 100, l * 100]
}

/**
 * CSS variables that re-tint the brand utilities for a school's accent colour. Lightness is clamped so white text on
 * the accent and accent text on white both stay readable (WCAG AA for normal text).
 */
export function accentVars(hex: string | null | undefined): CSSProperties {
  const hsl = hex ? hexToHsl(hex) : null
  if (!hsl) return {}
  const [h, s0, l0] = hsl
  const s = Math.min(s0, 85)
  const l = Math.max(22, Math.min(l0, 42))
  const c = (light: number) => `hsl(${h.toFixed(0)} ${s.toFixed(0)}% ${Math.max(12, Math.min(light, 60)).toFixed(0)}%)`
  return { '--color-brand-300': c(l - 4), '--color-brand-400': c(l + 4), '--color-brand-500': c(l), '--color-brand-600': c(l - 6) } as CSSProperties
}
