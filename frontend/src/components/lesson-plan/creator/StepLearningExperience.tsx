import { Brain, Check, ChevronDown, GitMerge, Plus, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Label, Select } from '@/components/ui/field'
import { showAiText } from '@/lib/lessonPlan/normalize'
import { cn } from '@/lib/utils'
import { FIVE_E_PHASES, INTELLIGENCE_TYPES, LEARNING_MODELS } from '../data'
import { useDismiss } from './hooks'
import { LePreview } from './LePreview'
import { MergedResources, SingleResources } from './LeResources'
import type { Elo, TabUnit } from './model'
import { AddResources, EmptyHint } from './ui'
import type { Creator } from './useCreator'

/** Step 6 — Learning Experience: model + pedagogical approaches + intelligence types, the per-ELO 5E design
    (tabs, merge, phase time, resources) and the read-only combined preview. */
export function StepLearningExperience({ c }: { c: Creator }) {
  if (!c.gen.elo) return <EmptyHint text="Generate learning outcomes in Step 3 first, then design the 5E learning experience." />
  return (
    <div className="flex flex-col gap-5">
      <ConfigCard c={c} />
      {c.pedDone && c.activeUnit && c.activeElo && (
        <div>
          <h3 className="bg-gradient-to-r from-purple-600 to-purple-800 bg-clip-text text-xl font-semibold text-transparent">5E Model Design</h3>
          <p className="mb-4 mt-1 text-sm text-ink-500">Organize your learning activities using the 5E instructional model</p>
          <DesignCard c={c} unit={c.activeUnit} elo={c.activeElo} />
          {/* Merge every ELO's 5E content into the read-only Learning Experience view */}
          <div className="mt-5.5 flex justify-center">
            <Button size="lg" disabled={!!c.busy} onClick={c.generateLE} className="h-12.5 rounded-xl bg-none bg-fg px-7.5 font-semibold text-white shadow-xl shadow-fg/30 hover:brightness-125">
              <Brain className="h-[18px] w-[18px]" />{c.busy === '5e' ? 'Building experience…' : 'Generate Learning Experience'}
            </Button>
          </div>
        </div>
      )}
      {c.gen.le && <LePreview c={c} />}
    </div>
  )
}

function ConfigCard({ c }: { c: Creator }) {
  return (
    <Card className="px-6 py-5.5">
      <h4 className="text-base font-semibold text-fg">Learning Experience</h4>
      <p className="mt-0.5 text-[13px] text-ink-500">By default, all ELOs are selected</p>
      <div className="mt-4.5">
        <Label htmlFor="le-model">Select Learning Model</Label>
        <Select id="le-model" value={c.leModel} onChange={(e) => c.setLeModel(e.target.value)}>
          {LEARNING_MODELS.map((m) => <option key={m.v} value={m.v} disabled={!m.enabled}>{m.label}</option>)}
        </Select>
      </div>
      <div className="mt-4.5 flex justify-end">
        <Button disabled={!!c.busy} onClick={() => void c.generatePedagogical()} className="font-semibold">
          <Brain className="h-4 w-4" />{c.busy === 'ped' ? 'Generating…' : 'Generate Pedagogical Approaches'}
        </Button>
      </div>

      {/* Pedagogical approaches + intelligence types */}
      {c.pedDone && (
        <div className="mt-4.5 flex flex-col gap-4">
          <div>
            <div className="flex flex-wrap gap-2">
              {c.pedApproaches.length ? c.pedApproaches.map((a) => (
                <span key={a} className="inline-flex items-center gap-1.5 rounded-full border border-brand-400/25 bg-brand-500/[0.07] px-2.5 py-1 text-[12.5px] font-medium text-brand-600">
                  {a}
                  <button type="button" aria-label={`Remove ${a}`} title="Remove" onClick={() => c.removePed(a)} className="inline-flex cursor-pointer hover:opacity-70"><X className="h-3.5 w-3.5" /></button>
                </span>
              )) : <span className="text-[12.5px] text-ink-500">No approaches yet — add your own below.</span>}
            </div>
            <Input aria-label="Custom pedagogical approach" value={c.pedInput} className="mt-3"
              placeholder="Type a custom pedagogical approach and press Enter or comma to add..."
              onChange={(e) => c.setPedInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); c.addPedFromInput() } }}
              onBlur={c.addPedFromInput} />
          </div>
          <div>
            <div className="text-[13px] font-medium text-ink-300">Select Intelligence Types</div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {INTELLIGENCE_TYPES.map((t) => {
                const on = c.intelSel.includes(t)
                return (
                  <button key={t} type="button" aria-pressed={on} onClick={() => c.toggleIntel(t)}
                    className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                      on ? 'border-teal-500 bg-teal-500/10 text-teal-700' : 'border-line bg-ink-900 text-ink-500 hover:border-line-strong')}>
                    {on ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <Plus className="h-3.5 w-3.5" />}{t}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

/** "Select ELOs to merge" menu — selected & already-merged ELOs are disabled; remove a pick from the chips. */
function MergePicker({ c }: { c: Creator }) {
  const ref = useDismiss<HTMLDivElement>(c.mergeOpen, () => c.setMergeOpen(false))
  return (
    <div className="flex items-center gap-2.5">
      <div ref={ref} className="relative">
        <Button variant="secondary" size="sm" aria-expanded={c.mergeOpen} aria-haspopup="listbox" className="h-9 bg-ink-900" onClick={() => c.setMergeOpen(!c.mergeOpen)}>
          Select ELOs to merge <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', c.mergeOpen && 'rotate-180')} />
        </Button>
        {c.mergeOpen && (
          <div className="glass absolute right-0 top-[calc(100%+6px)] z-50 w-[min(360px,88vw)] rounded-xl p-2 shadow-xl">
            <div className="px-2 pb-2 pt-1 text-[11px] text-ink-500">Pick ELOs to merge. Selected &amp; already-merged ELOs are disabled here — remove a selection from the chips below.</div>
            <div className="max-h-64 overflow-y-auto">
              {c.elos.map((e) => {
                const inGroup = !!c.groupOf(e.id)
                const picked = c.mergePick.includes(e.id)
                return (
                  <button key={e.id} type="button" disabled={inGroup || picked} onClick={() => c.pickForMerge(e.id)}
                    className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                      picked ? 'bg-teal-500/10' : 'enabled:hover:bg-ink-800', inGroup ? 'cursor-not-allowed opacity-50' : picked ? 'cursor-not-allowed' : 'cursor-pointer')}>
                    <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded border-[1.5px] text-white', picked ? 'border-teal-500 bg-teal-500' : 'border-line-strong bg-ink-900')}>
                      {picked && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-100"><b>ELO {e.num}:</b> {showAiText(e.elo)}</span>
                    {inGroup ? <span className="shrink-0 rounded-full bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700">merged</span>
                      : picked ? <span className="shrink-0 rounded-full bg-brand-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand-600">selected</span> : null}
                  </button>
                )
              })}
            </div>
            <div className="mt-1.5 flex justify-end border-t border-line px-1.5 pb-1 pt-2">
              <Button variant="secondary" size="sm" onClick={() => c.setMergeOpen(false)}>Done</Button>
            </div>
          </div>
        )}
      </div>
      <Button size="sm" disabled={c.mergePick.length < 2} onClick={c.mergePicked} className="h-9 from-teal-500 to-teal-500 font-semibold shadow-none">
        <GitMerge className="h-4 w-4" />Merge{c.mergePick.length >= 2 ? ` (${c.mergePick.length})` : ''}
      </Button>
    </div>
  )
}

function DesignCard({ c, unit, elo }: { c: Creator; unit: TabUnit; elo: Elo }) {
  const isGroup = unit.type === 'group'
  const activeIdx = Math.min(c.activeEloTab, c.tabUnits.length - 1)
  return (
    // No overflow-hidden here — it would clip the floating Add-Resources menu on the lower phase rows.
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <span className="text-[15px] font-semibold text-fg">5E Model Design by ELO</span>
        {c.elos.length > 1 ? <MergePicker c={c} /> : <span className="text-xs text-ink-500">{c.elos.length} ELO</span>}
      </div>

      {/* ELOs picked for merging — chips with an ✕ to drop each from the pending selection. */}
      {c.mergePick.length > 0 && (
        <div className="border-b border-line bg-brand-500/[0.04] px-5 py-3">
          <div className="mb-2 text-[12.5px] font-semibold text-brand-600">Selected ELOs for merging:</div>
          <div className="flex flex-wrap gap-2">
            {c.mergePick.map((id) => {
              const e = c.elos.find((x) => x.id === id)
              if (!e) return null
              return (
                <span key={id} title={showAiText(e.elo)} className="inline-flex items-center gap-2 rounded-lg border border-line bg-ink-900 py-1 pl-3 pr-2 text-[12.5px] font-semibold text-ink-100">
                  ELO {e.num}
                  <button type="button" aria-label={`Remove ELO ${e.num} from the merge`} title="Remove" onClick={() => c.unpickForMerge(id)} className="inline-flex cursor-pointer text-bad hover:opacity-70"><X className="h-3.5 w-3.5" /></button>
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Tabs — standalone ELOs + merged groups ("Merged: N ELOs", with an un-merge ✕) */}
      <div role="tablist" aria-label="5E design by ELO" className="flex gap-1 overflow-x-auto border-b border-line px-4 pt-2.5">
        {c.tabUnits.map((u, i) => {
          const on = i === activeIdx
          const group = u.type === 'group'
          return (
            <div key={u.key} className={cn('flex shrink-0 items-center border-b-2', on ? 'border-teal-500' : 'border-transparent')}>
              <button type="button" role="tab" aria-selected={on} onClick={() => c.setActiveEloTab(i)}
                className={cn('inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap px-3 py-2 text-[13.5px] font-semibold transition-colors', on ? 'text-teal-700' : 'text-ink-500 hover:text-fg')}>
                {group && <Plus className="h-3.5 w-3.5" />}{group ? `Merged: ${u.elos.length} ELOs` : `ELO ${u.elos[0].num}`}
                {u.elos.some((e) => c.eloHasContent(e)) && <span aria-label="has content" className="h-[7px] w-[7px] rounded-full bg-emerald-500" />}
              </button>
              {group && (
                <button type="button" aria-label="Un-merge" title="Un-merge" onClick={() => c.unmerge(u.elos[0].id)}
                  className={cn('-ml-1.5 mr-1 inline-flex cursor-pointer rounded p-0.5 hover:bg-ink-800', on ? 'text-teal-700' : 'text-ink-500')}>
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div className="px-5 py-4.5">
        {/* Expected Learning Outcome(s) */}
        <div className="mb-4 rounded-xl border border-teal-300/40 bg-teal-500/[0.05] px-3.5 py-3">
          <div className="mb-1 text-xs font-semibold text-teal-700">Expected Learning Outcome{isGroup ? 's (merged)' : ''}</div>
          {isGroup
            ? <div className="flex flex-col gap-1.5">{unit.elos.map((e) => <p key={e.id} className="text-[13px] leading-relaxed text-ink-100"><b className="text-teal-700">ELO {e.num}:</b> {showAiText(e.elo)}</p>)}</div>
            : <p className="text-[13px] leading-relaxed text-ink-100">{showAiText(elo.elo)}</p>}
        </div>

        <div className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold text-teal-700"><Plus className="h-4 w-4" />5E Learning Sequence</div>

        {/* Phase rows — each selected resource becomes its own content card */}
        <div className="flex flex-col gap-3">
          {FIVE_E_PHASES.map((ph) => {
            const pc = c.phaseCfg(elo.id, ph.key)
            const timeId = `le-time-${elo.id}-${ph.key}`
            return (
              <div key={ph.key} className="rounded-xl border border-line bg-ink-900 px-4 py-3.5 shadow-sm">
                <div className="flex flex-wrap items-center gap-3.5">
                  <span className="inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-[12.5px] font-semibold" style={{ background: ph.tint, color: ph.color }}>{ph.key}</span>
                  <div className="flex items-center gap-1.5 text-[13px] text-ink-300">
                    <label htmlFor={timeId}>Time:</label>
                    {/* Pre-filled by the Time Duration split equally across the 5 phases; the teacher can override any
                        phase. On a merged tab the edit applies to all its ELOs. */}
                    <Input id={timeId} type="number" min={0} value={pc.time} className="h-8.5 w-16 px-2 text-center"
                      title="Pre-filled from the Time Duration split equally across the 5 phases — edit to override"
                      onChange={(e) => c.setPhaseTime((isGroup ? unit.elos : [elo]).map((x) => x.id), ph.key, e.target.value)} />
                    mins
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-ink-300">
                    <input type="checkbox" checked={pc.genImages} onChange={(e) => c.setPhaseImages(elo.id, ph.key, e.target.checked)} className="h-4 w-4 cursor-pointer accent-teal-600" />
                    Generate Images for this Phase
                  </label>
                  <div className="ml-auto"><AddResources onAdd={(name) => c.addPhaseResource(elo.id, ph.key, name)} /></div>
                </div>
                {isGroup ? <MergedResources c={c} phaseKey={ph.key} members={unit.elos} /> : <SingleResources c={c} elo={elo} phaseKey={ph.key} />}
              </div>
            )
          })}
        </div>

        <div className="mt-4.5 flex justify-center">
          <Button size="lg" disabled={!!c.busy} onClick={() => void c.generate5EAll()} className="rounded-xl from-purple-500 to-purple-600 font-semibold shadow-lg shadow-purple-500/30">
            <Sparkles className="h-4 w-4" />{c.busy === '5e' ? 'Generating & saving…' : 'Generate 5E Model & Saving'}
          </Button>
        </div>
      </div>
    </Card>
  )
}
