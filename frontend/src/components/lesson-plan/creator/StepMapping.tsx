import type { LucideIcon } from 'lucide-react'
import { Brain, Heart, Lightbulb, Target, Users } from 'lucide-react'
import { showAiText } from '@/lib/lessonPlan/normalize'
import { cn } from '@/lib/utils'
import { bloomClass, bloomIcon } from '../data'
import { uniq } from './model'
import { Chip, EmptyHint } from './ui'
import type { Creator } from './useCreator'

const COLS = 'grid grid-cols-[1.4fr_2fr_1.3fr_1.3fr_1.3fr]'

/** Step 4 — Objective Mapping: stats band, CO → ELO → Bloom → skills → competencies grid, summary cards. */
export function StepMapping({ c }: { c: Creator }) {
  if (!c.gen.elo) return <EmptyHint text="Generate learning outcomes in Step 3 to see the mapping." />
  const rows = c.elos
  const objCount = c.activeObjectives.length
  // Coverage = share of the kept objectives that have at least one ELO linked to them.
  const covered = c.activeObjectives.filter((o) => rows.some((e) => e.coId === o.id)).length
  const coverage = objCount ? Math.round((covered / objCount) * 100) : 0
  const stats: [LucideIcon, string, number, string][] = [
    [Target, 'text-brand-600', objCount, 'Core Objectives'],
    [Lightbulb, 'text-emerald-600', rows.length, 'Learning Outcomes'],
    [Brain, 'text-purple-600', uniq(rows.map((e) => e.bloom).filter(Boolean)).length, "Bloom's Levels"],
    [Users, 'text-orange-700', uniq(rows.flatMap((e) => e.skills)).length, 'Unique Skills'],
    [Heart, 'text-red-600', uniq(rows.flatMap((e) => e.competencies)).length, 'Competencies'],
  ]
  const summary: [string, string | number, string, string, string][] = [
    ['Total Mappings', objCount, 'Core objectives mapped', 'border-l-brand-500', 'text-brand-600'],
    ['Learning Outcomes', rows.length, 'Total ELOs defined', 'border-l-emerald-500', 'text-emerald-600'],
    ['Coverage', `${coverage}%`, 'Objectives covered', 'border-l-purple-500', 'text-purple-600'],
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Stats band */}
      <div className="rounded-2xl bg-gradient-to-br from-brand-500/[0.06] via-purple-500/[0.06] to-pink-500/[0.06] p-6">
        <div className="grid grid-cols-2 gap-5 md:grid-cols-5">
          {stats.map(([Icon, tone, num, label]) => (
            <div key={label} className="text-center">
              <div className={cn('mx-auto mb-2.5 grid h-15 w-15 place-items-center rounded-full bg-ink-900 shadow-sm', tone)}><Icon className="h-6 w-6" /></div>
              <div className={cn('font-display text-[26px] font-semibold', tone)}>{num}</div>
              <div className="text-[12.5px] text-ink-300">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Grid table */}
      <div>
        <h4 className="mb-3.5 flex items-center gap-2 text-[17px] font-semibold text-fg"><Target className="h-5 w-5 text-brand-600" />Mapping Overview</h4>
        <div className="glass overflow-x-auto rounded-xl">
          <div className="min-w-[900px]" role="table" aria-label="Objective mapping">
            <div role="row" className={cn(COLS, 'border-b border-line bg-ink-800')}>
              {['Core Objective (CO)', 'Expected Learning Outcomes (ELOs)', "Bloom's Taxonomy", 'Skills', 'Competencies'].map((h, k) => (
                <div key={h} role="columnheader" className={cn('px-4 py-3.5 text-[13px] font-semibold text-fg', k < 4 && 'border-r border-line')}>{h}</div>
              ))}
            </div>
            {rows.map((e) => {
              const co = c.coForElo(e)
              const linked = e.coId ? rows.filter((x) => x.coId === e.coId).length : 0
              return (
                <div key={e.id} role="row" className={cn(COLS, 'border-b border-line/60 last:border-b-0')}>
                  <div role="cell" className="border-r border-line p-4">
                    <div className="mb-2 text-xs leading-relaxed text-ink-500">{co ? co.text : e.custom ? 'Custom outcome' : '—'}</div>
                    {co && <Chip className="border border-line text-ink-300">{linked} ELO{linked === 1 ? '' : 's'} linked</Chip>}
                  </div>
                  <div role="cell" className="border-r border-line p-4">
                    <div className="flex items-start gap-2">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                      <p className="text-[13px] leading-relaxed text-ink-100">{showAiText(e.elo)}</p>
                    </div>
                  </div>
                  <div role="cell" className="border-r border-line p-4">
                    <div className="flex items-center gap-1.5"><span className="text-[17px]" aria-hidden>{bloomIcon(e.bloom)}</span><Chip className={bloomClass(e.bloom)}>{e.bloom}</Chip></div>
                  </div>
                  <div role="cell" className="border-r border-line p-4">
                    <div className="flex flex-wrap gap-1.5">
                      {e.skills.length ? e.skills.map((x) => <Chip key={x} className="bg-brand-500/10 text-brand-600">{x}</Chip>) : <span className="text-xs text-ink-500">—</span>}
                    </div>
                  </div>
                  <div role="cell" className="p-4">
                    <div className="flex flex-wrap gap-1.5">
                      {e.competencies.length ? e.competencies.map((x) => <Chip key={x} className="bg-emerald-500/10 text-emerald-700">{x}</Chip>) : <span className="text-xs text-ink-500">—</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {summary.map(([t, num, sub, border, tone]) => (
          <div key={t} className={cn('glass rounded-xl border-l-4 p-4.5', border)}>
            <div className="mb-2 text-[13px] font-medium text-ink-500">{t}</div>
            <div className={cn('font-display text-[26px] font-semibold', tone)}>{num}</div>
            <div className="mt-0.5 text-xs text-ink-500">{sub}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
