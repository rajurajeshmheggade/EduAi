/* Generation blueprint helpers: default type inputs, automatic-marks estimate and validation (server rules). */
import type { BlueprintRow, QgenMeta, QType, TypeMeta } from '@/types/questionGen'

export const MAX_TOTAL = 50

export function defaultOptions(t: TypeMeta): BlueprintRow['options'] {
  return Object.fromEntries(Object.entries(t.options).map(([k, s]) => [k, s.default]))
}

export function newRow(meta: QgenMeta, type: QType = meta.types[0].code): BlueprintRow {
  const t = meta.types.find((x) => x.code === type) ?? meta.types[0]
  return { type: t.code, count: 3, difficulty: 'MEDIUM', bloom: t.code === 'HOTS' ? 'ANALYZE' : 'UNDERSTAND', marks: null, options: defaultOptions(t) }
}

/** Marks a row will give when its marks are left blank (the same defaults the server applies). */
export function estimatedMarks(row: BlueprintRow, meta: QgenMeta): number {
  if (row.marks) return row.marks * row.count
  const t = meta.types.find((x) => x.code === row.type)
  let per = t?.default_marks ?? 1
  if (row.type === 'TRUE_FALSE') per = Number(row.options.statements ?? 1)
  else if (row.type === 'FILL_BLANK') per = Number(row.options.blanks ?? 1)
  else if (row.type === 'MATCH') per = Math.max(2, Number(row.options.pairs ?? 4))
  else if (row.difficulty === 'HARD' && ['SHORT_ANSWER', 'LONG_ANSWER', 'HOTS', 'NUMERICAL', 'DIAGRAM'].includes(row.type)) per += 1
  return per * row.count
}

export function blueprintErrors(rows: BlueprintRow[], meta: QgenMeta): string[] {
  const out: string[] = []
  const total = rows.reduce((s, r) => s + r.count, 0)
  if (!rows.length) out.push('Add at least one question type')
  if (total > MAX_TOTAL) out.push(`At most ${MAX_TOTAL} questions per generation (now ${total})`)
  rows.forEach((r, i) => {
    if (!(r.count >= 1 && r.count <= 20)) out.push(`Row ${i + 1}: number of questions must be 1–20`)
    if (r.marks != null && !(r.marks > 0 && r.marks <= 100)) out.push(`Row ${i + 1}: marks must be more than 0 and at most 100`)
    const t = meta.types.find((x) => x.code === r.type)
    for (const [k, s] of Object.entries(t?.options ?? {})) {
      const v = r.options[k]
      if (s.kind === 'int' && (typeof v !== 'number' || v < (s.min ?? 0) || v > (s.max ?? 99))) out.push(`Row ${i + 1}: ${s.label} must be ${s.min}–${s.max}`)
    }
  })
  return out
}
