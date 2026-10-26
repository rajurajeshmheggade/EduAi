/** ISO <-> <input type="datetime-local"> value, in the browser's timezone. */
export const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)

export const greeting = (d = new Date()) => { const h = d.getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' }
export const longDate = (iso?: string) =>
  new Date(iso ? `${iso.slice(0, 10)}T00:00:00` : Date.now()).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
export const shortDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
export const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—'

/** Date-range presets for exports, as local YYYY-MM-DD strings. */
export type RangePreset = 'this_month' | 'last_month' | 'last_3_months' | 'year_to_date' | 'custom'
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export function presetRange(p: Exclude<RangePreset, 'custom'>, now = new Date()): { start: string; end: string } {
  const y = now.getFullYear(), m = now.getMonth()
  switch (p) {
    case 'this_month': return { start: ymd(new Date(y, m, 1)), end: ymd(now) }
    case 'last_month': return { start: ymd(new Date(y, m - 1, 1)), end: ymd(new Date(y, m, 0)) }
    case 'last_3_months': return { start: ymd(new Date(y, m - 2, 1)), end: ymd(now) }
    // Academic year starts in June (Indian schools); exports are capped at one year.
    case 'year_to_date': return { start: ymd(new Date(m >= 5 ? y : y - 1, 5, 1)), end: ymd(now) }
  }
}
