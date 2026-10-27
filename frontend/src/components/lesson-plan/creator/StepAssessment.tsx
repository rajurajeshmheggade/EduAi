import { Check, ChevronDown, Eye, Minus, Pencil, Plus, RefreshCw, Sparkles, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/field'
import { showAiText } from '@/lib/lessonPlan/normalize'
import { cn } from '@/lib/utils'
import { ITEM_TYPES, bloomClass, bloomIcon } from '../data'
import { Overlay } from '../dialogs'
import { itemsFromAssessRes, type Elo, type NormItem } from './model'
import { Chip, EmptyHint, IconBtn } from './ui'
import type { Creator } from './useCreator'

/** Step 5 — Assessment: one accordion per ELO with the teacher's config rows → AI items, each previewable /
    editable / regenerable / deletable. */
export function StepAssessment({ c }: { c: Creator }) {
  if (!c.gen.elo) return <EmptyHint text="Generate learning outcomes in Step 3 first, then configure assessments per ELO." />
  return <div className="flex flex-col gap-4">{c.elos.map((e) => <EloAssessment key={e.id} c={c} e={e} />)}</div>
}

function EloAssessment({ c, e }: { c: Creator; e: Elo }) {
  const rows = c.rowsFor(e.id)
  const open = !!c.assessOpen[e.id]
  const items = itemsFromAssessRes(c.assessByElo[e.id])
  const gening = c.busy === `assess:${e.id}`
  const rowsValid = rows.length > 0 && rows.every((r) => (Number(r.noOfItems) || 0) >= 1 && !!r.itemType)
  const panelId = `assess-panel-${e.id}`
  return (
    <div className="glass overflow-hidden rounded-2xl">
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => c.toggleAssessOpen(e.id)}
        className={cn('flex w-full cursor-pointer items-center gap-3 bg-gradient-to-r from-pink-500/[0.07] to-transparent px-5 py-4 text-left', open && 'border-b border-line')}>
        <span className="whitespace-nowrap text-sm font-semibold text-fg">ELO {e.num}</span>
        <Chip className={bloomClass(e.bloom)}><span aria-hidden>{bloomIcon(e.bloom)}</span> {e.bloom}</Chip>
        <span className="min-w-20 flex-1 truncate text-[13px] text-ink-300">{showAiText(e.elo)}</span>
        {items.length > 0 && <Chip className="bg-emerald-500/10 text-emerald-700">{items.length} items</Chip>}
        <span className="whitespace-nowrap text-xs text-ink-500">{rows.length} row{rows.length > 1 ? 's' : ''}</span>
        <ChevronDown className={cn('h-[18px] w-[18px] shrink-0 text-ink-500 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div id={panelId} className="px-5 py-4.5">
          <p className="mb-4 text-[13.5px] leading-relaxed text-ink-100">{showAiText(e.elo)}</p>
          <div className="mb-2.5 text-[13px] font-semibold text-fg">Assessment Items:</div>

          {/* Config rows — each becomes an assessment_details entry sent to the AI */}
          <div className="flex flex-col gap-2.5">
            {rows.map((r, i) => {
              const rid = `${e.id}-row-${i}`
              return (
                <div key={i} className="flex flex-wrap items-end gap-3.5 rounded-xl border border-line bg-ink-800/60 px-3.5 py-3">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`${rid}-n`} className="text-xs font-medium text-ink-300">No Of Items</label>
                    <Input id={`${rid}-n`} type="number" min={0} max={10} value={r.noOfItems} className="h-9 w-24"
                      onChange={(ev) => { const v = ev.target.value; c.updateAssessRow(e, i, 'noOfItems', v === '' ? '' : Math.max(0, Math.min(10, parseInt(v, 10) || 0))) }} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`${rid}-t`} className="text-xs font-medium text-ink-300">Item Type</label>
                    <Select id={`${rid}-t`} value={r.itemType} className="h-9 min-w-52" onChange={(ev) => c.updateAssessRow(e, i, 'itemType', ev.target.value)}>
                      <option value="">Select the Item Type</option>
                      {ITEM_TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
                    </Select>
                  </div>
                  <label className="flex h-9 cursor-pointer items-center gap-2">
                    <input type="checkbox" checked={!!r.includeLOTS} onChange={(ev) => c.updateAssessRow(e, i, 'includeLOTS', ev.target.checked)} className="h-4 w-4 cursor-pointer accent-pink-600" />
                    <span className="text-[13px] font-medium text-ink-300">Include LOTS</span>
                  </label>
                  <span className="ml-auto self-center whitespace-nowrap text-xs text-ink-500">Row {i + 1}</span>
                  {rows.length > 1 && <IconBtn label="Remove row" tone="red" onClick={() => c.removeAssessRow(e, i)}><Minus className="h-4 w-4" /></IconBtn>}
                </div>
              )
            })}
          </div>

          {/* Add row + generate */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => c.addAssessRow(e)} className="border-dashed border-pink-500/60 bg-pink-500/5 text-pink-600 hover:bg-pink-500/10">
              <Plus className="h-4 w-4" />Add Row
            </Button>
            <Button disabled={!!c.busy || !rowsValid} title={rowsValid ? undefined : 'Set the number of items and choose an item type first'}
              onClick={() => void c.generateAssessForElo(e)} className="from-pink-500 to-pink-600 font-semibold shadow-lg shadow-pink-500/25">
              <Sparkles className="h-4 w-4" />{gening ? 'Generating…' : 'Generate All Items'}
            </Button>
          </div>

          {items.length > 0 && (
            <div className="mt-4.5 border-t border-line/70 pt-1.5">
              {items.map((it, k) => <AssessItem key={k} c={c} e={e} it={it} k={k} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AssessItem({ c, e, it, k }: { c: Creator; e: Elo; it: NormItem; k: number }) {
  const ed = c.editItem && c.editItem.eloId === e.id && c.editItem.idx === k ? c.editItem : null
  const regenning = c.regenItemBusy === `${e.id}:${k}`
  return (
    <div className={cn('py-3.5', k > 0 && 'border-t border-line/70')}>
      <div className="mb-1.5 flex flex-wrap items-start gap-2">
        <span className="text-[12.5px] font-semibold text-ink-300">{k + 1}.</span>
        <Chip className="bg-ink-800 text-ink-300">{String(it.itemType).toUpperCase()}</Chip>
        <span className="self-center text-[11px] text-ink-500">{it.bloomsLevel}</span>
        {/* Visible in-flight state — without it a regeneration looked inert. */}
        {regenning && <span className="self-center text-[11.5px] font-semibold text-emerald-600">Regenerating…</span>}
        <div className="flex-1" />
        <div className="flex items-center gap-1.5">
          <IconBtn label="Preview" onClick={() => c.setPreviewItem({ ...it, n: k + 1 })}><Eye className="h-4 w-4" /></IconBtn>
          <IconBtn label="Edit" tone="brand" onClick={() => c.startEditItem(e.id, k, it)}><Pencil className="h-4 w-4" /></IconBtn>
          <IconBtn label={regenning ? 'Regenerating…' : 'Regenerate'} tone="green" onClick={() => c.askRegenItem(e, k)}><RefreshCw className={cn('h-4 w-4', regenning && 'animate-spin')} /></IconBtn>
          <IconBtn label="Delete" tone="red" onClick={() => c.deleteAssessItem(e.id, k)}><Trash2 className="h-4 w-4" /></IconBtn>
        </div>
      </div>
      {it.context && !ed && <p className="mb-1.5 text-[12.5px] italic leading-relaxed text-ink-500">{it.context}</p>}
      {ed ? (
        <div className="flex flex-col gap-2">
          <Textarea aria-label="Question" rows={3} value={ed.question} className="resize-y"
            onChange={(ev) => { const v = ev.target.value; c.setEditItem((x) => (x ? { ...x, question: v } : x)) }} />
          {ed.options && Object.keys(ed.options).map((ok) => (
            <div key={ok} className="flex items-center gap-2">
              <b className="w-4 shrink-0 text-[13px] text-brand-600">{ok}.</b>
              <Input aria-label={`Option ${ok}`} value={ed.options?.[ok] ?? ''} className="h-9"
                onChange={(ev) => { const v = ev.target.value; c.setEditItem((x) => (x && x.options ? { ...x, options: { ...x.options, [ok]: v } } : x)) }} />
            </div>
          ))}
          <Input aria-label="Answer" value={ed.answer} placeholder="Answer (optional)"
            onChange={(ev) => { const v = ev.target.value; c.setEditItem((x) => (x ? { ...x, answer: v } : x)) }} />
          <div className="flex gap-2">
            <IconBtn label="Save" tone="green" onClick={c.saveEditItem}><Check className="h-4 w-4" /></IconBtn>
            <IconBtn label="Cancel" onClick={() => c.setEditItem(null)}><X className="h-4 w-4" /></IconBtn>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-fg">{it.question}</p>
          {it.options && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {Object.entries(it.options).map(([kk, v]) => (
                <div key={kk} className={cn('flex gap-1.5 rounded-md bg-ink-800 px-2.5 py-1.5 text-[13px] text-ink-300', kk === it.answer && 'ring-[1.5px] ring-emerald-500')}>
                  <b className="text-brand-600">{kk}.</b>{v}
                </div>
              ))}
            </div>
          )}
          {!it.options && it.answer && <p className="mt-1.5 text-[12.5px] text-emerald-700">Answer: {it.answer}</p>}
        </>
      )}
    </div>
  )
}

/** Read-only preview of one assessment item (portalled so the app shell can't paint over it). */
export function ItemPreview({ c }: { c: Creator }) {
  const p = c.previewItem
  if (!p) return null
  const close = () => c.setPreviewItem(null)
  return (
    <Overlay onClose={close}>
      <div role="dialog" aria-modal="true" aria-label={`Item ${p.n} preview`} className="glass max-h-[88vh] w-[min(640px,96vw)] overflow-y-auto rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5.5 py-4.5">
          <div className="flex items-center gap-2.5">
            <span className="text-sm font-semibold text-ink-300">Item {p.n}</span>
            <Chip className="bg-ink-800 text-ink-300">{String(p.itemType).toUpperCase()}</Chip>
            {p.bloomsLevel && <span className="text-[11px] text-ink-500">{p.bloomsLevel}</span>}
          </div>
          <Button variant="ghost" size="icon" aria-label="Close" title="Close" onClick={close}><X className="h-4 w-4" /></Button>
        </div>
        <div className="px-5.5 py-5">
          {p.context && <p className="mb-2.5 text-[13px] italic leading-relaxed text-ink-500">{p.context}</p>}
          <p className="text-[15px] font-medium leading-relaxed text-fg">{p.question}</p>
          {p.options && (
            <div className="mt-3.5 flex flex-col gap-2">
              {Object.entries(p.options).map(([kk, v]) => (
                <div key={kk} className={cn('flex gap-2 rounded-lg bg-ink-800 px-3 py-2.5 text-sm text-ink-100', kk === p.answer && 'bg-emerald-500/10 ring-[1.5px] ring-emerald-500')}>
                  <b className="text-brand-600">{kk}.</b>{v}
                  {kk === p.answer && <span className="ml-auto text-xs font-semibold text-emerald-700">Correct</span>}
                </div>
              ))}
            </div>
          )}
          {p.answer && <p className="mt-3.5 text-[13.5px] font-medium text-emerald-700">Answer: {p.answer}</p>}
        </div>
      </div>
    </Overlay>
  )
}
