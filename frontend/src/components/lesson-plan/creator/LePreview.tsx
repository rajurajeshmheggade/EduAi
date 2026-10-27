import { Lightbulb, Plus } from 'lucide-react'
import { showAiText } from '@/lib/lessonPlan/normalize'
import { cn } from '@/lib/utils'
import { FIVE_E_PHASES, bloomClass, bloomIcon } from '../data'
import { Rich } from '../Rich'
import { isErrBlock, type Elo, type ResourceCard } from './model'
import { Chip, ResourceFallback } from './ui'
import type { Creator } from './useCreator'

/** Read-only combined 5E view shown after "Generate Learning Experience" (tabs mirror the 5E design tabs). */
export function LePreview({ c }: { c: Creator }) {
  const unit = c.previewUnit
  const activeIdx = Math.min(c.previewTab, c.tabUnits.length - 1)
  return (
    <div className="glass overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line bg-gradient-to-r from-teal-500/[0.07] to-transparent px-5 py-4 text-teal-700">
        <Lightbulb className="h-[18px] w-[18px]" />
        <span className="text-[15px] font-semibold text-fg">Learning Experience — 5E Model</span>
        <span className="text-xs text-ink-500">({c.elos.length} ELO{c.elos.length > 1 ? 's' : ''} · {c.leModel})</span>
      </div>
      <div className="px-5 py-4.5">
        {(c.pedApproaches.length > 0 || c.intelSel.length > 0) && (
          <div className="mb-4.5 flex flex-col gap-2.5">
            {c.pedApproaches.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs font-semibold text-ink-300">Pedagogy:</span>
                {c.pedApproaches.map((a) => <Chip key={a} className="bg-brand-500/[0.07] text-brand-600">{a}</Chip>)}
              </div>
            )}
            {c.intelSel.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs font-semibold text-ink-300">Intelligences:</span>
                {c.intelSel.map((t) => <Chip key={t} className="bg-teal-500/10 text-teal-700">{t}</Chip>)}
              </div>
            )}
          </div>
        )}

        <div role="tablist" aria-label="Learning experience by ELO" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
          {c.tabUnits.map((u, i) => {
            const on = i === activeIdx
            return (
              <button key={u.key} type="button" role="tab" aria-selected={on} onClick={() => c.setPreviewTab(i)}
                className={cn('inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2 text-[13.5px] font-semibold transition-colors',
                  on ? 'border-teal-500 text-teal-700' : 'border-transparent text-ink-500 hover:text-fg')}>
                {u.type === 'group' && <Plus className="h-3.5 w-3.5" />}{u.type === 'group' ? `Merged: ${u.elos.length} ELOs` : `ELO ${u.elos[0].num}`}
                {u.elos.some((e) => c.eloHasContent(e)) && <span aria-label="has content" className="h-[7px] w-[7px] rounded-full bg-emerald-500" />}
              </button>
            )
          })}
        </div>

        {unit && <PreviewUnit c={c} isGroup={unit.type === 'group'} members={unit.elos} />}
      </div>
    </div>
  )
}

function PreviewUnit({ c, isGroup, members }: { c: Creator; isGroup: boolean; members: Elo[] }) {
  const first = members[0]
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-ink-900">
      <div className="border-b border-line bg-ink-800/60 px-4.5 py-3.5">
        {isGroup ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-bold text-teal-700">Merged: {members.length} ELOs</span>
            {members.map((e) => <p key={e.id} className="text-[13px] leading-relaxed text-ink-100"><b className="text-teal-700">ELO {e.num}:</b> {showAiText(e.elo)}</p>)}
          </div>
        ) : (
          <>
            <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
              <span className="text-sm font-semibold text-fg">ELO {first.num}</span>
              <Chip className={bloomClass(first.bloom)}><span aria-hidden>{bloomIcon(first.bloom)}</span> Bloom's Level: {first.bloom}</Chip>
            </div>
            <p className="text-[13px] leading-relaxed text-ink-300">{showAiText(first.elo)}</p>
          </>
        )}
      </div>
      <div className="flex flex-col gap-3 px-4.5 pb-4 pt-3.5">
        {FIVE_E_PHASES.map((ph) => {
          const pcTime = c.phaseCfg(first.id, ph.key).time
          // Gather the unit's resources. Merged: same-named resources share ONE card (each "from ELO N");
          // single ELO: every resource is its own card.
          const entries = members.flatMap((e) => c.phaseCfg(e.id, ph.key).resources.map((r) => ({ elo: e, r })))
          const groups: { key: string; name: string; items: { elo: Elo; r: ResourceCard }[] }[] = []
          entries.forEach((en) => {
            const k = isGroup ? String(en.r.name || '').trim().toLowerCase() : en.r.rid
            let g = groups.find((x) => x.key === k)
            if (!g) { g = { key: k, name: en.r.name, items: [] }; groups.push(g) }
            g.items.push(en)
          })
          return (
            <div key={ph.key} className="rounded-xl border border-line px-3.5 py-3">
              <div className="mb-2.5 inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold" style={{ background: ph.tint, color: ph.color }}>
                {ph.key}{pcTime ? ` · ${pcTime} min` : ''}
              </div>
              {groups.length ? groups.map((g, gi) => (
                <div key={g.key} className="mb-2.5 overflow-hidden rounded-lg border border-line bg-ink-900 last:mb-0">
                  <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2" style={{ background: `${ph.tint}88` }}>
                    <span className="rounded-full bg-ink-900 px-2 py-0.5 text-[11px] font-bold" style={{ color: ph.color }}>Resource {gi + 1}</span>
                    <span className="text-[13px] font-semibold text-fg">{g.name}</span>
                    {isGroup && g.items.length > 1 && <span className="rounded-full bg-teal-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-teal-700">{g.items.length} ELOs</span>}
                  </div>
                  {g.items.map((en, ii) => (
                    <div key={`${en.elo.id}_${en.r.rid}`} className={cn('px-3.5 py-3', ii > 0 && 'border-t border-dashed border-line')}>
                      {isGroup && (
                        <span className="mb-1.5 inline-block rounded-full border border-teal-300/50 bg-ink-900 px-2 py-0.5 text-[10.5px] font-semibold text-teal-700">
                          from ELO {en.elo.num}{en.r.estTime ? ` · ${en.r.estTime} min` : ''}
                        </span>
                      )}
                      <PreviewBody c={c} elo={en.elo} phaseKey={ph.key} r={en.r} />
                    </div>
                  ))}
                </div>
              )) : <p className="text-[12.5px] italic text-ink-500">No content generated for this phase.</p>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PreviewBody({ c, elo, phaseKey, r }: { c: Creator; elo: Elo; phaseKey: string; r: ResourceCard }) {
  const content = r.content
  if (isErrBlock(content)) return <ResourceFallback onRegenerate={() => void c.regenResource(elo, phaseKey, r)} />
  if (!content) return <p className="text-[12.5px] italic text-ink-500">No content generated yet.</p>
  return (
    <>
      {content.title && <div className="mb-1 text-[13.5px] font-semibold text-fg">{content.title}</div>}
      <Rich text={content.body} />
    </>
  )
}
