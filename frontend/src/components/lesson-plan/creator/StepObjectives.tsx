import { Bot, Check, Lightbulb, Pencil, Plus, RefreshCw, Save, Sparkles, Target, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label, Select, Textarea } from '@/components/ui/field'
import { cn } from '@/lib/utils'
import { FACTOR_OPTIONS, catClass } from '../data'
import { Chip, EmptyHint, IconBtn } from './ui'
import type { Creator } from './useCreator'

/** Step 2 — Manage Objectives: AI course outcomes (edit / regenerate / delete / undo) + "Write & Save Objectives". */
export function StepObjectives({ c }: { c: Creator }) {
  if (!c.gen.co) return <EmptyHint text="Generate course outcomes in Step 1 to manage objectives here." />
  const n = c.activeObjectives.length
  return (
    <div className="flex flex-col gap-6">
      {/* AI Generated Objectives */}
      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-brand-600"><Target className="h-5 w-5" /><h4 className="text-base font-semibold text-fg">AI Generated Objectives ({n})</h4></div>
          <Button variant="secondary" size="sm" className="h-9" onClick={c.undoDelete} disabled={!c.deletedStack.length}>Undo</Button>
        </div>
        <div className="flex flex-col gap-3.5">
          {c.activeObjectives.map((o) => {
            const editing = c.editObjId === o.id
            return (
              <div key={o.id} className="rounded-xl border border-l-4 border-line border-l-brand-500 bg-ink-900 px-4.5 py-4 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Chip className={catClass(o.category)}>{o.category || 'General'}</Chip>
                      {o.ai && <Chip className="bg-brand-500/10 text-brand-600"><Bot className="h-3 w-3" />AI</Chip>}
                    </div>
                    {editing
                      ? <Textarea aria-label="Objective description" value={c.editObjText} onChange={(e) => c.setEditObjText(e.target.value)} className="min-h-20 resize-y" />
                      : <p className="text-sm leading-relaxed text-ink-100">{o.description}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    {editing ? (
                      <>
                        <IconBtn label="Save" tone="green" onClick={() => c.saveEditObj(o.id)}><Check className="h-4 w-4" /></IconBtn>
                        <IconBtn label="Cancel" onClick={() => c.setEditObjId(null)}><X className="h-4 w-4" /></IconBtn>
                      </>
                    ) : (
                      <>
                        <IconBtn label="Edit" tone="brand" onClick={() => c.startEditObj(o)}><Pencil className="h-4 w-4" /></IconBtn>
                        <IconBtn label="Regenerate" tone="brand" onClick={() => c.regenObj(o)}><RefreshCw className="h-4 w-4" /></IconBtn>
                        <IconBtn label="Delete" tone="red" onClick={() => c.deleteObj(o.id)}><Trash2 className="h-4 w-4" /></IconBtn>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          {!n && <p className="py-4 text-center text-sm text-ink-500">All objectives were removed — undo a delete or write your own below.</p>}
        </div>
      </Card>

      {/* Write & Save Objectives */}
      <div className="rounded-2xl border border-orange-300/50 bg-gradient-to-r from-orange-500/[0.06] to-yellow-400/[0.06] p-6">
        <div className="mb-4 flex items-center gap-2 text-orange-700"><Lightbulb className="h-5 w-5" /><h4 className="text-base font-semibold text-orange-900">Write &amp; Save Objectives</h4></div>
        <div className="flex flex-col gap-4">
          {c.customRows.map((r, i) => (
            <div key={i} className="rounded-xl border border-orange-300/50 bg-ink-900 p-4">
              <div className="mb-3.5 grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor={`co-factor-${i}`}>Factor</Label>
                  <Select id={`co-factor-${i}`} value={r.factor} onChange={(e) => c.updateCustomRow(i, 'factor', e.target.value)} className="border-orange-300/60">
                    <option value="">Select Factor</option>
                    {FACTOR_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </Select>
                </div>
                <div className="flex items-end gap-2">
                  {r.description.trim() && r.factor.trim() && (
                    <Button variant="secondary" className="flex-1 border-emerald-500/40 bg-ink-900 text-emerald-700 hover:bg-emerald-500/10" onClick={() => c.saveCustomRow(i)}>
                      <Save className="h-4 w-4" />Save
                    </Button>
                  )}
                  {c.customRows.length > 1 && (
                    <Button variant="secondary" size="icon" className="h-10 w-10 border-bad/30 bg-ink-900 text-bad hover:bg-bad/10" aria-label="Remove this row" title="Remove this row" onClick={() => c.removeCustomRow(i)}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
              <Label htmlFor={`co-text-${i}`}>Core Objective</Label>
              <Textarea id={`co-text-${i}`} value={r.description} onChange={(e) => c.updateCustomRow(i, 'description', e.target.value)}
                className="min-h-20 resize-y border-orange-300/60"
                placeholder="e.g., Students gain a holistic understanding of food production and its socio-economic impact in the country." />
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={c.addCustomRow} className="h-9 self-start border-orange-300/70 bg-ink-900 text-orange-700 hover:bg-orange-500/10">
            <Plus className="h-4 w-4" />Add More
          </Button>
        </div>
      </div>

      {/* Continue */}
      <div className="text-center">
        <Button size="lg" onClick={c.continueObjectives} disabled={!n} className={cn('rounded-xl from-purple-600 to-brand-600 px-8 font-semibold')}>
          <Sparkles className="h-[18px] w-[18px]" />
          {n ? `Continue with ${n} objective${n > 1 ? 's' : ''}! 🚀` : 'Choose at least one objective'}
        </Button>
        {n > 0 && <p className="mt-3 text-[13px] text-ink-500">Ready to proceed with {n} objective{n > 1 ? 's' : ''}!</p>}
      </div>
    </div>
  )
}
