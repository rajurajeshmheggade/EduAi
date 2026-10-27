/* Defensive readers for generated session content (Rapid's str / trim / arr / texts). The content is model
   output, so no field is trusted to have its declared type. */

export type Rec = Record<string, unknown>

export const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
export const trim = (v: unknown): string => str(v).trim()
export const arr = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
export const obj = (v: unknown): Rec | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null)

/** A list whose entries are strings or objects carrying the text under text / elo / title. */
export const texts = (v: unknown): string[] => arr(v)
  .map((x) => (typeof x === 'string' ? x.trim() : trim(obj(x)?.text || obj(x)?.elo || obj(x)?.title)))
  .filter(Boolean)

/** Entries that are objects with a non-empty `key`. */
export const records = (v: unknown, key: string): Rec[] => arr(v).map(obj).filter((x): x is Rec => !!x && !!trim(x[key]))

/** Only http(s) reaches an href / src. */
export const safeUrl = (u: unknown): string => {
  const s = trim(u)
  return /^https?:\/\//i.test(s) ? s : ''
}

/** Card header tints (Rapid's per-card gradient tints, on EduAI's palette). */
export const TINT = {
  brand: 'from-brand-500/[0.07]',
  violet: 'from-violet-500/[0.07]',
  green: 'from-emerald-500/[0.07]',
  orange: 'from-orange-500/[0.08]',
  cyan: 'from-cyan-500/[0.07]',
  amber: 'from-amber-400/[0.10]',
  pink: 'from-pink-500/[0.07]',
} as const
export type Tint = keyof typeof TINT
