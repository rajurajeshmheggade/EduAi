import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Label, Select } from '@/components/ui/field'
import { defaultOptions, estimatedMarks, newRow } from '@/lib/questionGen/blueprint'
import type { BlueprintRow, QgenMeta, QType } from '@/types/questionGen'
import { HIGHER_ORDER } from '@/types/questionGen'

/* The generation blueprint: one row per question type with count, difficulty, Bloom level, marks per question
   (blank = automatic) and the type's own inputs (options per MCQ, statements per True/False, pairs to match …).
   Every list comes from the server's catalogue (GET /qgen/meta). */

export function BlueprintEditor({ meta, rows, onChange }: { meta: QgenMeta; rows: BlueprintRow[]; onChange: (rows: BlueprintRow[]) => void }) {
  const set = (i: number, patch: Partial<BlueprintRow>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const setType = (i: number, code: QType) => {
    const t = meta.types.find((x) => x.code === code)!
    set(i, { type: code, options: defaultOptions(t), bloom: code === 'HOTS' && !HIGHER_ORDER.includes(rows[i].bloom) ? 'ANALYZE' : rows[i].bloom })
  }
  const groups = [...new Set(meta.types.map((t) => t.group))]
  const total = rows.reduce((s, r) => s + r.count, 0)
  const marks = rows.reduce((s, r) => s + estimatedMarks(r, meta), 0)

  return (
    <div className="space-y-3">
      {rows.map((r, i) => {
        const t = meta.types.find((x) => x.code === r.type)
        const blooms = r.type === 'HOTS' ? meta.blooms.filter((b) => HIGHER_ORDER.includes(b.code)) : meta.blooms
        return (
          <fieldset key={i} className="rounded-xl border border-line bg-ink-900/40 p-3">
            <legend className="sr-only">Question type {i + 1}</legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_0.8fr_1fr_1fr_0.9fr_auto]">
              <div>
                <Label htmlFor={`bp-type-${i}`}>Question type</Label>
                <Select id={`bp-type-${i}`} value={r.type} onChange={(e) => setType(i, e.target.value as QType)}>
                  {groups.map((g) => (
                    <optgroup key={g} label={g}>
                      {meta.types.filter((x) => x.group === g).map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
                    </optgroup>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor={`bp-count-${i}`}>How many</Label>
                <Input id={`bp-count-${i}`} type="number" min={1} max={20} value={r.count}
                  onChange={(e) => set(i, { count: Math.max(0, Math.min(20, Math.round(Number(e.target.value) || 0))) })} />
              </div>
              <div>
                <Label htmlFor={`bp-diff-${i}`}>Difficulty</Label>
                <Select id={`bp-diff-${i}`} value={r.difficulty} onChange={(e) => set(i, { difficulty: e.target.value as BlueprintRow['difficulty'] })}>
                  {meta.difficulties.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor={`bp-bloom-${i}`}>Bloom’s level</Label>
                <Select id={`bp-bloom-${i}`} value={r.bloom} onChange={(e) => set(i, { bloom: e.target.value as BlueprintRow['bloom'] })}>
                  {blooms.map((b) => <option key={b.code} value={b.code}>{b.label}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor={`bp-marks-${i}`}>Marks each</Label>
                <Input id={`bp-marks-${i}`} type="number" min={0.5} max={100} step={0.5} placeholder="Auto" value={r.marks ?? ''}
                  onChange={(e) => set(i, { marks: e.target.value === '' ? null : Number(e.target.value) })} />
              </div>
              <div className="flex items-end">
                <Button variant="ghost" size="icon" aria-label={`Remove ${t?.label ?? 'row'}`} disabled={rows.length === 1}
                  onClick={() => onChange(rows.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
            {t && Object.keys(t.options).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-3 border-t border-line pt-3">
                {Object.entries(t.options).map(([k, s]) => {
                  const id = `bp-${k}-${i}`
                  const v = r.options[k] ?? s.default
                  if (s.kind === 'bool') return (
                    <label key={k} htmlFor={id} className="flex cursor-pointer items-center gap-2 self-end pb-2 text-sm text-ink-200">
                      <input id={id} type="checkbox" checked={!!v} onChange={(e) => set(i, { options: { ...r.options, [k]: e.target.checked } })} className="h-4 w-4 accent-brand-500" />
                      {s.label}
                    </label>
                  )
                  if (s.kind === 'choice') return (
                    <div key={k} className="w-48">
                      <Label htmlFor={id}>{s.label}</Label>
                      <Select id={id} value={String(v)} onChange={(e) => set(i, { options: { ...r.options, [k]: e.target.value } })}>
                        {s.choices?.map(([val, lab]) => <option key={val} value={val}>{lab}</option>)}
                      </Select>
                    </div>
                  )
                  return (
                    <div key={k} className="w-40">
                      <Label htmlFor={id}>{s.label} ({s.min}–{s.max})</Label>
                      <Input id={id} type="number" min={s.min} max={s.max} value={Number(v)}
                        onChange={(e) => set(i, { options: { ...r.options, [k]: Math.round(Number(e.target.value) || 0) } })} />
                    </div>
                  )
                })}
              </div>
            )}
            {t && <p className="mt-2 text-xs text-ink-500">{t.description}</p>}
          </fieldset>
        )
      })}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="secondary" size="sm" onClick={() => onChange([...rows, newRow(meta, meta.types.find((t) => !rows.some((r) => r.type === t.code))?.code)])}
          disabled={rows.length >= meta.types.length}>
          <Plus className="h-3.5 w-3.5" /> Add question type
        </Button>
        <p className="text-sm text-ink-300"><b className="text-fg">{total}</b> question{total === 1 ? '' : 's'} · about <b className="text-fg">{marks}</b> marks</p>
      </div>
    </div>
  )
}
