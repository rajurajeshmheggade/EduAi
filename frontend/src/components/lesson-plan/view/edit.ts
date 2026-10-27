/* Lesson Plan View — editing helpers (no components, so react-refresh stays happy).
   Edits patch the STORED plan JSON immutably along a path, keeping every other key (incl. __creatorState). */

import { hasHtml, healRich, htmlToText, isObj, str } from '../lessonPlanPrint'
import type { LessonPlanModel } from '../lessonPlanPrint'
import type { PlanContent } from '@/types/lessonPlan'

export type Path = (string | number)[]
export type SectionKey = 'core' | 'elo' | 'assess' | 'assign' | '5e' | 'fed'

/** What every section receives from the container. */
export interface SectionProps {
  model: LessonPlanModel
  /** The stored (edited) plan JSON — editors bind to its raw values, not the trimmed display model. */
  doc: Partial<PlanContent>
  /** This section is being edited. */
  editing: boolean
  /** Edit buttons are rendered at all (false in Preview). */
  showEdit: boolean
  /** Edit is temporarily unavailable (another section is open, or a save is in flight). */
  editLocked: boolean
  onEdit: () => void
  onSave: () => void
  onCancel: () => void
  /** Write `value` at `path` in the stored plan. `create` builds missing containers (5E generated content). */
  set: (path: Path, value: string, create?: boolean) => void
}

/** Immutable set-in: copies only the containers along `path`. A path through the wrong shape is a no-op
 *  unless `create` is set, in which case missing containers become objects. */
export function setIn(node: unknown, path: Path, value: unknown, create = false): unknown {
  if (path.length === 0) return value
  const [k, ...rest] = path
  if (Array.isArray(node)) {
    const i = Number(k)
    if (!Number.isInteger(i) || i < 0 || i >= node.length) return node
    const copy = node.slice()
    copy[i] = setIn(node[i], rest, value, create)
    return copy
  }
  if (isObj(node)) {
    const key = String(k)
    if (rest.length > 0 && !create && !isObj(node[key]) && !Array.isArray(node[key])) return node
    return { ...node, [key]: setIn(node[key], rest, value, create) }
  }
  return create ? { [String(k)]: setIn(undefined, rest, value, create) } : node
}

export function getAt(node: unknown, path: Path): unknown {
  let cur = node
  for (const k of path) {
    if (Array.isArray(cur)) cur = cur[Number(k)]
    else if (isObj(cur)) cur = cur[String(k)]
    else return undefined
  }
  return cur
}

/** The value a plain-text editor shows: the raw stored string (so trailing spaces / newlines survive typing);
 *  legacy HTML is reduced to its text, and is only replaced in storage once the teacher actually types. */
export function editableText(raw: unknown): string {
  if (typeof raw === 'string') return hasHtml(raw) ? htmlToText(raw) : raw
  return str(raw)
}

/** The value a 5E-content editor shows: the healed Markdown (never a raw serialized payload). */
export function editableRich(raw: unknown): string {
  if (typeof raw === 'string' && !raw.trim()) return raw
  const healed = healRich(raw)
  if (healed.fallback) return ''
  return hasHtml(healed.text) ? htmlToText(healed.text) : healed.text
}

/** Path to a core objective's text — a string entry is edited in place, an object entry via `.text`. */
export const corePath = (doc: unknown, index: number): Path =>
  typeof getAt(doc, ['coreObjectives', index]) === 'string' ? ['coreObjectives', index] : ['coreObjectives', index, 'text']

/** Rows for an auto-height textarea: enough for the content, within sensible bounds. */
export function rowsFor(value: string, min = 2, max = 24): number {
  const est = value.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 90)), 0)
  return Math.min(max, Math.max(min, est + 1))
}

/** dd/mm/yyyy in local time, '' for an unparseable date. */
export function ddmmyyyy(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}
