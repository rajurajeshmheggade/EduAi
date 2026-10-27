import type { DikshaItem, DikshaUnit, DikshaViewer } from '@/services/dikshaService'

type Tone = 'brand' | 'ok' | 'warn' | 'bad' | 'aqua' | 'neutral'

export const RESOURCE_LABEL: Record<DikshaItem['resource_type'], string> = {
  pdf: 'PDF', video: 'Video', youtube: 'YouTube video', audio: 'Audio', epub: 'eBook', interactive: 'Interactive',
  collection: 'Collection', other: 'Resource',
}

export const VIEWER_LABEL: Record<DikshaViewer, { label: string; tone: Tone }> = {
  pdf: { label: 'Read in app', tone: 'ok' },
  video: { label: 'Watch in app', tone: 'ok' },
  audio: { label: 'Listen in app', tone: 'ok' },
  youtube: { label: 'Watch in app', tone: 'ok' },
  official: { label: 'Opens on DIKSHA', tone: 'aqua' },
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
