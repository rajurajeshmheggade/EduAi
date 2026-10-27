import { Brain, Check, FileCheck, Heart, Lightbulb, Pencil, Plus, RefreshCw, Target, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Label, Select, Textarea } from '@/components/ui/field'
import { showAiText } from '@/lib/lessonPlan/normalize'
import { cn } from '@/lib/utils'
import { ATTITUDES, HOTS, bloomClass, bloomIcon } from '../data'
import { CardHead, Chip, ChipCard, GenerateCta, IconBtn } from './ui'
import type { Creator } from './useCreator'

/** Step 3 — Expected Learning Outcomes: Bloom HOTS counts, skills / competencies / attitudes, generated ELOs. */
export function StepElos({ c }: { c: Creator }) {
  const customAttitudes = c.attitudes.filter((a) => !ATTITUDES.includes(a))
  return (
    <div className="flex flex-col gap-5">
      {/* Bloom's Taxonomy - HOTS */}
      <Card className="p-6">
        <CardHead tile="bg-gradient-to-br from-purple-500/10 to-pink-500/10 text-purple-600" icon={Brain} title="Bloom's Taxonomy - Higher Order Thinking Skills" />
        <div className="flex flex-col gap-3">
          {HOTS.map((b) => {
            const on = c.blooms.includes(b.label)
            const id = `bloom-${b.label}`
            return (
              <div key={b.label} className="flex flex-wrap items-center gap-4 rounded-xl bg-purple-500/[0.06] px-4 py-3.5">
                <label htmlFor={id} className="flex flex-1 cursor-pointer items-center gap-3">
                  <input id={id} type="checkbox" checked={on} onChange={() => c.toggleBloom(b.label)} className="h-5 w-5 shrink-0 cursor-pointer accent-purple-600" />
                  <span className="text-lg" aria-hidden>{b.icon}</span>
                  <span>
                    <span className="block text-sm font-semibold text-fg">{b.label}</span>
                    <span className="block text-xs text-ink-500">{b.desc}</span>
                  </span>
                </label>
                {on && (
                  <div className="flex items-center gap-2">
                    <label htmlFor={`${id}-n`} className="whitespace-nowrap text-[13px] font-medium text-ink-300">Number of ELOs:</label>
                    <Input id={`${id}-n`} value={c.bloomCounts[b.label] ?? ''} placeholder="1" inputMode="numeric" className="h-9 w-14 text-center"
                      onChange={(e) => c.setBloomCount(b.label, e.target.value)} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      {/* Skills */}
      <ChipCard id="lp-custom-skills" title="Skills" icon={Target} tile="bg-gradient-to-br from-brand-500/10 to-indigo-500/10 text-brand-600"
        genLabel="Generate Skills" genClass="from-brand-500 to-indigo-600" onGenerate={() => void c.generateSkills()}
        items={c.skills} onRemove={c.removeSkill} chipClass="bg-brand-500/10 text-brand-600"
        heading="AI Generated Skills:" headClass="border-brand-400/30 bg-brand-500/5 text-brand-600"
        custom={c.customSkill} setCustom={c.setCustomSkill} placeholder="Add custom skills (comma separated)…" onAddCustom={c.addCustomSkill} />

      {/* Competencies */}
      <ChipCard id="lp-custom-comps" title="Competencies" icon={Heart} tile="bg-gradient-to-br from-red-500/10 to-pink-500/10 text-red-600"
        genLabel="Generate Competencies" genClass="from-emerald-500 to-emerald-600" onGenerate={() => void c.generateComps()}
        items={c.comps} onRemove={c.removeComp} chipClass="bg-emerald-500/10 text-emerald-700"
        heading="AI Generated Competencies:" headClass="border-emerald-500/30 bg-emerald-500/5 text-emerald-700"
        custom={c.customComp} setCustom={c.setCustomComp} placeholder="Add custom competencies (comma separated)…" onAddCustom={c.addCustomComp} />

      {/* Attitudes */}
      <Card className="p-6">
        <CardHead tile="bg-gradient-to-br from-amber-400/10 to-orange-500/10 text-orange-700" icon={Heart} title="Attitudes" />
        <div className="mb-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {ATTITUDES.map((a) => {
            const on = c.attitudes.includes(a)
            return (
              <button key={a} type="button" aria-pressed={on} onClick={() => c.toggleAttitude(a)}
                className={cn('flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left transition-colors',
                  on ? 'border-orange-300 bg-orange-500/[0.07]' : 'border-line bg-ink-800 hover:border-line-strong')}>
                <span className={cn('grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border-2 text-white',
                  on ? 'border-orange-500 bg-orange-500' : 'border-line-strong bg-ink-900')}>
                  {on && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className="text-sm font-medium text-fg">{a}</span>
              </button>
            )
          })}
        </div>
        {/* Manually added attitudes (not in the fixed pool) show as removable chips. */}
        {customAttitudes.length > 0 && (
          <div className="mb-3.5 flex flex-wrap gap-2">
            {customAttitudes.map((a) => (
              <span key={a} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500/10 px-2.5 py-1 text-[13px] font-semibold text-orange-700">
                {a}
                <button type="button" aria-label={`Remove ${a}`} title="Remove" onClick={() => c.removeAttitude(a)} className="inline-flex cursor-pointer hover:opacity-70"><X className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
        )}
        <Input aria-label="Add custom attitudes" value={c.customAtt} placeholder="Add custom attitudes (comma separated)…" className="bg-ink-800"
          onChange={(e) => c.setCustomAtt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); c.addCustomAtt() } }}
          onBlur={c.addCustomAtt} />
      </Card>

      {!c.gen.elo && (
        <GenerateCta className="from-emerald-500 to-emerald-600 shadow-lg shadow-emerald-500/30" label="Generate Learning Outcomes"
          onClick={() => void c.generateELOs()} icon={FileCheck} />
      )}

      {c.gen.elo && <GeneratedElos c={c} />}
    </div>
  )
}

function GeneratedElos({ c }: { c: Creator }) {
  return (
    <Card className="p-6">
      <div className="mb-4.5 flex items-center gap-2 text-emerald-600"><Lightbulb className="h-5 w-5" /><h4 className="text-base font-semibold text-fg">Generated Learning Outcomes ({c.elos.length})</h4></div>
      <div className="flex flex-col gap-3.5">
        {c.elos.map((e) => {
          const editing = c.editEloId === e.id
          return (
            <div key={e.id} className="rounded-xl border border-line bg-ink-900 px-4.5 py-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
                    <span className="grid h-[26px] w-[26px] place-items-center rounded-full bg-emerald-500/10 text-[13px] font-semibold text-emerald-700">{e.num}</span>
                    <Chip className={bloomClass(e.bloom)}><span aria-hidden>{bloomIcon(e.bloom)}</span>{e.bloom}</Chip>
                    {e.custom && <Chip className="bg-ink-700 text-ink-300">Custom</Chip>}
                  </div>
                  {editing
                    ? <Textarea aria-label="Learning outcome" value={c.editEloText} onChange={(ev) => c.setEditEloText(ev.target.value)} className="min-h-[70px] resize-y" />
                    : <p className="mb-3 text-[14.5px] leading-relaxed text-ink-100">{showAiText(e.elo)}</p>}
                  {!editing && (e.skills.length > 0 || e.competencies.length > 0) && (
                    <div className="flex flex-wrap gap-5">
                      {e.skills.length > 0 && (
                        <div>
                          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Skills</div>
                          <div className="flex flex-wrap gap-1.5">{e.skills.map((x) => <Chip key={x} className="bg-brand-500/10 text-brand-600">{x}</Chip>)}</div>
                        </div>
                      )}
                      {e.competencies.length > 0 && (
                        <div>
                          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Competencies</div>
                          <div className="flex flex-wrap gap-1.5">{e.competencies.map((x) => <Chip key={x} className="bg-emerald-500/10 text-emerald-700">{x}</Chip>)}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-col gap-2">
                  {editing ? (
                    <>
                      <IconBtn label="Save" tone="green" onClick={() => c.saveEditElo(e.id)}><Check className="h-4 w-4" /></IconBtn>
                      <IconBtn label="Cancel" onClick={() => c.setEditEloId(null)}><X className="h-4 w-4" /></IconBtn>
                    </>
                  ) : (
                    <>
                      <IconBtn label="Edit" tone="brand" onClick={() => c.startEditElo(e)}><Pencil className="h-4 w-4" /></IconBtn>
                      <IconBtn label="Regenerate" tone="green" onClick={() => c.regenElo(e)}><RefreshCw className="h-4 w-4" /></IconBtn>
                      <IconBtn label="Delete" tone="red" onClick={() => c.deleteElo(e.id)}><Trash2 className="h-4 w-4" /></IconBtn>
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Add Custom Learning Outcome */}
      <div className="mt-5 rounded-xl border border-dashed border-emerald-400/60 bg-emerald-500/[0.05] p-4.5">
        <div className="mb-3.5 flex items-center gap-2 text-emerald-600"><Plus className="h-[18px] w-[18px]" /><h5 className="text-sm font-semibold text-emerald-800">Add Custom Learning Outcome</h5></div>
        <div className="mb-3.5 grid gap-3.5 md:grid-cols-2">
          <div>
            <Label htmlFor="ce-co">Course Outcome</Label>
            <Select id="ce-co" value={c.ceCo} onChange={(e) => c.setCeCo(e.target.value)} className="border-emerald-400/50">
              <option value="">Select Course Outcome</option>
              {c.activeCos.map((co) => <option key={co.co_id} value={co.co_id}>{co.co_title || co.co_description}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="ce-bloom">Bloom's Level</Label>
            <Select id="ce-bloom" value={c.ceBloom} onChange={(e) => c.setCeBloom(e.target.value)} className="border-emerald-400/50">
              <option value="">Select Bloom's Level</option>
              {HOTS.map((b) => <option key={b.label} value={b.label}>{b.icon} {b.label}</option>)}
            </Select>
          </div>
        </div>
        <Label htmlFor="ce-text">Learning Outcome</Label>
        <Textarea id="ce-text" value={c.ceText} onChange={(e) => c.setCeText(e.target.value)} placeholder="Describe the expected learning outcome…"
          className="mb-3.5 min-h-[70px] resize-y border-emerald-400/50" />
        <Button onClick={c.addCustomElo} className="from-emerald-500 to-emerald-600 shadow-none"><Plus className="h-4 w-4" />Add Learning Outcome</Button>
      </div>
    </Card>
  )
}
