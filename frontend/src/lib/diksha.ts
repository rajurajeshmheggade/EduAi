import { DEFAULT_CONTENT_TYPE, dikshaService, type DikshaFilterOptions, type DikshaItem, type DikshaQuery, type DikshaUnit, type DikshaViewer } from '@/services/dikshaService'

type Tone = 'brand' | 'ok' | 'warn' | 'bad' | 'aqua' | 'neutral'

export const RESOURCE_LABEL: Record<DikshaItem['resource_type'], string> = {
  pdf: 'PDF', video: 'Video', youtube: 'Video', audio: 'Audio', epub: 'eBook', interactive: 'Interactive',
  collection: 'Collection', other: 'Resource',
}

/** Everything opens inside the app; `none` only appears if a file fails to load. */
export const VIEWER_LABEL: Record<DikshaViewer, { label: string; tone: Tone }> = {
  pdf: { label: 'Read in app', tone: 'ok' },
  video: { label: 'Watch in app', tone: 'ok' },
  audio: { label: 'Listen in app', tone: 'ok' },
  youtube: { label: 'Watch in app', tone: 'ok' },
  html: { label: 'Runs in app', tone: 'ok' },
  none: { label: 'Not available', tone: 'neutral' },
}

/** "Class 9", "Classes 9–10" or null when the source gives no class. */
export function classText(classes: number[]): string | null {
  if (!classes.length) return null
  const sorted = [...classes].sort((a, b) => a - b)
  return sorted.length === 1 ? `Class ${sorted[0]}` : `Classes ${sorted[0]}–${sorted[sorted.length - 1]}`
}

export const boardText = (b: string) => (b.toLowerCase() === 'state (karnataka)' ? 'Karnataka State Board' : b)

/** Attribution line built only from fields the source provides. */
export function attributionParts(m: Pick<DikshaItem, 'author' | 'creator' | 'attributions' | 'copyright' | 'copyright_year' | 'organisation'>) {
  const parts: { label: string; value: string }[] = []
  if (m.author) parts.push({ label: 'Author', value: m.author })
  if (m.creator && m.creator !== m.author) parts.push({ label: 'Creator', value: m.creator })
  if (m.attributions.length) parts.push({ label: 'Attribution', value: m.attributions.join(', ') })
  if (m.organisation.length) parts.push({ label: 'Organisation', value: m.organisation.join(', ') })
  if (m.copyright) parts.push({ label: 'Copyright', value: `© ${m.copyright_year ? `${m.copyright_year} ` : ''}${m.copyright}` })
  return parts
}

/** All resources of a unit including its sub-units, with the sub-unit name as a group label. */
export function unitResources(u: DikshaUnit): { group: string | null; items: DikshaUnit['resources'] }[] {
  const out: { group: string | null; items: DikshaUnit['resources'] }[] = []
  if (u.resources.length) out.push({ group: null, items: u.resources })
  const walk = (x: DikshaUnit, prefix: string) => {
    if (x.resources.length) out.push({ group: prefix ? `${prefix} › ${x.name}` : x.name, items: x.resources })
    x.units.forEach((c) => walk(c, prefix ? `${prefix} › ${x.name}` : x.name))
  }
  u.units.forEach((c) => walk(c, ''))
  return out
}

/** Filter options (facets) for a catalogue selection. */
export const optionsFor = (q: DikshaQuery, withSubject = true) => dikshaService.filters({
  board: q.board, class_number: q.class_number, content_type: q.content_type ?? DEFAULT_CONTENT_TYPE, ...(withSubject && q.subject ? { subject: q.subject } : {}),
})

/**
 * A new selection with its dependent choices checked against the filter options for it: a subject is kept only while
 * it has content of the chosen type, a language only while it has content of the chosen type (and subject). One
 * options request answers both (the subject list does not depend on the chosen subject); a second one is needed only
 * when the subject had to be dropped, to get the languages for the type as a whole.
 */
export async function resolveFilters(next: DikshaQuery): Promise<{ query: DikshaQuery; options: DikshaFilterOptions }> {
  let options = await optionsFor(next)
  let query = next
  if (query.subject && !options.subjects.some((x) => x.value === query.subject && x.count !== 0)) {
    query = { ...query, subject: '' }
    options = await optionsFor(query, false)
  }
  if (query.medium && !options.mediums.some((x) => x.value === query.medium && x.count !== 0)) query = { ...query, medium: '' }
  return { query, options }
}
