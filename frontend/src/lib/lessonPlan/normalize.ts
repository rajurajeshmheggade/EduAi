/* Single normalization chokepoint for AI-generated payloads (port of Rapid's lib/normalizeResource.js).
   EVERY AI "resource" ({ title, body }) and plain-text AI value (ELOs, pedagogical approaches) passes through
   here before it reaches a renderer or the database. A success can only ever carry validated content — it is
   structurally impossible to hand raw model text back as a success. */

export type NormResult<T> = { ok: true; data: T } | { ok: false; error: string; stage: string; raw: string }
export interface ResourceBlock { title: string; body: string }

const RAW_EXCERPT = 4000
const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const excerpt = (v: unknown): string => {
  try { return String(typeof v === 'string' ? v : JSON.stringify(v)).slice(0, RAW_EXCERPT) } catch { return '' }
}

const TITLE_KEYS = ['title', 'heading', 'name', 'activityTitle', 'activity_title', 'Title', 'Heading']
const BODY_KEYS = ['body', 'content', 'markdown', 'text', 'activity', 'description', 'Body', 'Content']
const WRAPPER_KEYS = ['block', 'data', 'resource', 'result', 'output', 'response']
const TEXT_KEYS = ['elo', 'outcome', 'approach', 'value', ...TITLE_KEYS, ...BODY_KEYS]

function stripFences(s: string): string {
  const t = String(s).trim()
  const m = t.match(/```(?:json|javascript|js)?\s*([\s\S]*?)```/i)
  return m && m[1].trim() ? m[1].trim() : t
}

/** First balanced { … } or [ … ] — brace- and string-aware. null when it never closes (truncated). */
function extractBalanced(s: string): string | null {
  const start = s.search(/[{[]/)
  if (start < 0) return null
  const open = s[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i += 1) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === open) depth += 1
    else if (c === close) { depth -= 1; if (depth === 0) return s.slice(start, i + 1) }
  }
  return null
}

/** Recursively un-double-encode string values that are themselves JSON. */
function unwrap(v: unknown, depth = 0): unknown {
  if (depth > 6) return v
  if (typeof v === 'string') {
    const t = v.trim()
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
      try { return unwrap(JSON.parse(t), depth + 1) } catch { return v }
    }
    return v
  }
  if (Array.isArray(v)) return v.map((x) => unwrap(x, depth + 1))
  if (isPlainObject(v)) {
    const o: Record<string, unknown> = {}
    for (const k of Object.keys(v)) o[k] = unwrap(v[k], depth + 1)
    return o
  }
  return v
}

/** Unescape literal \n \t \" — only when the string carries literal escapes and no real newlines. */
export function unescapeLiterals(s: string): string {
  if (typeof s !== 'string') return s
  if (/\n/.test(s) || !/\\[nt"]/.test(s)) return s
  return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"')
}

/** Does a string LOOK like serialized data rather than prose / Markdown? */
export function looksLikeSerialized(s: unknown): boolean {
  if (typeof s !== 'string') return false
  const t = s.trim()
  if (!t) return false
  const jsonKeyed = (t.startsWith('{') || t.startsWith('[')) && /"(title|body|content|heading|name)"\s*:/i.test(t)
  const doubleEscaped = /\\[nt"]/.test(t) && !/\n/.test(t) && t.length > 40
  return jsonKeyed || doubleEscaped
}

const pick = (obj: Record<string, unknown>, keys: string[]): string => {
  for (const k of keys) { const v = obj[k]; if (typeof v === 'string' && v.trim()) return v }
  return ''
}

/** Plain-text AI value → validated prose (ELOs, pedagogical approaches). */
export function normalizeText(raw: unknown, depth = 0): NormResult<string> {
  if (depth > 6) return { ok: false, error: 'too-deep', stage: 'parse', raw: excerpt(raw) }
  if (raw == null) return { ok: false, error: 'empty', stage: 'input', raw: excerpt(raw) }
  if (Array.isArray(raw)) {
    const first = raw.find((v) => v != null && (typeof v !== 'string' || v.trim()))
    return first === undefined ? { ok: false, error: 'empty', stage: 'input', raw: excerpt(raw) } : normalizeText(first, depth + 1)
  }
  if (isPlainObject(raw)) {
    const v = pick(raw, TEXT_KEYS)
    return v ? normalizeText(v, depth + 1) : { ok: false, error: 'no-text', stage: 'shape', raw: excerpt(raw) }
  }
  if (typeof raw !== 'string') return { ok: false, error: 'not-text', stage: 'shape', raw: excerpt(raw) }
  const s = unescapeLiterals(stripFences(raw)).trim()
  if (!s) return { ok: false, error: 'empty', stage: 'input', raw: excerpt(raw) }
  if (looksLikeSerialized(s) || /^[{[]/.test(s)) {
    const candidate = extractBalanced(s)
    if (candidate == null) return { ok: false, error: 'no-json-or-truncated', stage: 'extract', raw: excerpt(s) }
    let parsed: unknown
    try { parsed = JSON.parse(candidate) } catch { return { ok: false, error: 'parse-failed', stage: 'parse', raw: excerpt(s) } }
    return normalizeText(parsed, depth + 1)
  }
  return { ok: true, data: s }
}

/** AI resource payload → validated { title, body }. */
export function normalizeResource(raw: unknown): NormResult<ResourceBlock> {
  if (raw == null || (typeof raw === 'string' && !raw.trim())) return { ok: false, error: 'empty', stage: 'input', raw: excerpt(raw) }
  let obj: unknown = raw
  if (typeof raw === 'string') {
    const candidate = extractBalanced(stripFences(raw.trim()))
    if (candidate == null) return { ok: false, error: 'no-json-or-truncated', stage: 'extract', raw: excerpt(raw) }
    try { obj = JSON.parse(candidate) } catch { return { ok: false, error: 'parse-failed', stage: 'parse', raw: excerpt(raw) } }
  }
  obj = unwrap(obj)
  if (Array.isArray(obj)) obj = obj.find(isPlainObject) ?? null
  if (isPlainObject(obj)) {
    const top = obj
    if (!TITLE_KEYS.concat(BODY_KEYS).some((k) => k in top)) {
      for (const w of WRAPPER_KEYS) { const inner = top[w]; if (isPlainObject(inner)) { obj = inner; break } }
    }
  }
  if (!isPlainObject(obj)) return { ok: false, error: 'not-object', stage: 'shape', raw: excerpt(raw) }
  let o: Record<string, unknown> = obj
  for (let hop = 0; hop < 6; hop += 1) {
    const bodyVal = BODY_KEYS.map((k) => o[k]).find((v) => v !== undefined)
    if (isPlainObject(bodyVal) && TITLE_KEYS.concat(BODY_KEYS).some((k) => k in bodyVal)) o = bodyVal
    else break
  }
  const title = unescapeLiterals(pick(o, TITLE_KEYS)).trim()
  const body = unescapeLiterals(pick(o, BODY_KEYS))
  if (!body || !body.trim()) return { ok: false, error: 'no-body', stage: 'validate', raw: excerpt(o) }
  if (looksLikeSerialized(body)) return { ok: false, error: 'body-serialized', stage: 'validate', raw: excerpt(body) }
  return { ok: true, data: { title, body } }
}

/** Structured failure telemetry (console only — never shown to the teacher). */
export function logNormFailure(ctx: Record<string, unknown>) {
  if (typeof console !== 'undefined') console.warn('[lesson-plan] AI payload could not be validated', ctx)
}

export const AI_TEXT_FALLBACK = 'This content couldn’t be loaded. Please regenerate it.'

/** Layer 2 (ingest): normalize BEFORE it enters state; '' when nothing can be validated. */
export function cleanAiText(raw: unknown, ctx?: Record<string, unknown>): string {
  const res = normalizeText(raw)
  if (res.ok) return res.data
  logNormFailure({ ...(ctx ?? {}), stage: res.stage, error: res.error })
  return ''
}

/** Layer 3 (render): re-check at the DOM boundary; swaps anything unvalidated for a graceful fallback. */
export function showAiText(raw: unknown): string {
  const t = String(raw ?? '').trim()
  if (!t) return AI_TEXT_FALLBACK
  const res = normalizeText(t)
  return res.ok ? res.data : AI_TEXT_FALLBACK
}

/** five-e-resource reply → { title, body } | { error }. Never raw model text. */
export function parseBlock(apiRes: { block?: unknown } | null | undefined, ctx?: Record<string, unknown>): ResourceBlock | { error: string } {
  if (!apiRes) return { error: 'empty' }
  const res = normalizeResource(apiRes.block != null ? apiRes.block : apiRes)
  if (res.ok) return res.data
  logNormFailure({ ...(ctx ?? {}), stage: res.stage, error: res.error })
  return { error: res.error || 'unparseable' }
}
