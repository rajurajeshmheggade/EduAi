import { useState } from 'react'
import { ChevronDown, CirclePlay, Eye, FileText, X } from 'lucide-react'
import { Overlay } from '@/components/lesson-plan/dialogs'
import { Button } from '@/components/ui/button'
import { Tabs } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { ResourcesValue } from '../resourcesModel'
import { sanitizeHtml } from '../sanitizeHtml'
import { PreviewTile } from './cards'
import { flatIndex, launchSession, sessionStats } from './launch'

/* Session Resources Preview — "how this session will appear to students": name / duration / assets, Launch,
   the class / subject / chapter chips with Prerequisites & objectives, then one tab per stage that carries
   resources. A tile launches the player on that asset. Also the Session Manager's Preview (previewOnly). */
export function PreviewModal({ v, objectives, prereq, onClose }: {
  v: ResourcesValue
  /** The ELOs selected for the session — strings or { elo | text | title } objects. */
  objectives: unknown[]
  prereq: string
  onClose: () => void
}) {
  const { prevResStages, totalAssets, totalMins } = sessionStats(v)
  const [prevTab, setPrevTab] = useState(prevResStages[0] ?? '')
  const [ctxOpen, setCtxOpen] = useState(false)
  const tab = prevResStages.includes(prevTab) ? prevTab : (prevResStages[0] ?? '')
  const ctxObjectives = objectives
    .map((x) => (typeof x === 'string' ? x : x && typeof x === 'object'
      ? String((x as Record<string, unknown>).elo || (x as Record<string, unknown>).text || (x as Record<string, unknown>).title || '') : ''))
    .map((s) => s.trim()).filter(Boolean).slice(0, 4)
  const sessionName = v.name || ''

  return (
    <Overlay onClose={onClose} z="z-[350]">
      <div className="glass flex h-[calc(100vh-3rem)] w-[min(1280px,100%)] flex-col overflow-hidden rounded-2xl" role="dialog" aria-modal="true" aria-labelledby="sr-preview-title">
        <div className="flex items-center gap-3 border-b border-line bg-gradient-to-b from-brand-500/[0.06] to-transparent px-5 py-4">
          <span className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-brand-500/12 text-brand-600"><Eye className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <div id="sr-preview-title" className="font-display text-[15px] font-semibold text-fg">Session Resources Preview</div>
            <div className="mt-px text-xs text-ink-500">How this session will appear to students</div>
          </div>
          <button type="button" onClick={onClose} title="Close" aria-label="Close preview"
            className="inline-flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-lg border border-line bg-ink-900 text-ink-500 hover:text-fg"><X className="h-3.5 w-3.5" /></button>
        </div>

        <div className="flex flex-wrap items-stretch border-b border-line bg-ink-900">
          <div className="flex min-w-[220px] flex-1 items-center gap-3 px-[18px] py-3">
            <span className="inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] bg-brand-500/12 text-brand-600"><FileText className="h-[19px] w-[19px]" /></span>
            <div className="min-w-0">
              <div className="text-[11.5px] text-ink-500">Session Name</div>
              <div className="truncate text-sm font-semibold text-fg">{sessionName || 'Untitled session'}</div>
            </div>
          </div>
          <div className="min-w-[110px] border-l border-line px-[18px] py-3">
            <div className="whitespace-nowrap text-[11.5px] text-ink-500">Duration</div>
            <div className="mt-0.5 text-sm font-semibold text-fg">{totalMins} min</div>
          </div>
          <div className="min-w-[120px] border-l border-line px-[18px] py-3">
            <div className="whitespace-nowrap text-[11.5px] text-ink-500">Assets</div>
            <div className="mt-0.5 text-sm font-semibold text-brand-600">{totalAssets}</div>
          </div>
          <Button className="my-2.5 mr-3.5 h-auto px-5 font-semibold" onClick={() => launchSession(v, 0)} id="launch-session">
            <CirclePlay className="h-4 w-4" />Launch
          </Button>
        </div>

        <div className="border-b border-line bg-ink-950">
          <div className="flex flex-wrap items-center gap-2 px-5 py-2.5">
            {([['Class', v.klass], ['Subject', v.subject], ['Chapter', v.chapter]] as const).map(([k, val]) => (
              <span key={k} className="inline-flex h-[26px] max-w-[320px] items-center gap-1.5 rounded-full border border-line bg-ink-900 px-3 text-xs text-fg">
                <span className="text-ink-500">{k}</span><span className="truncate font-semibold">{val || '—'}</span>
              </span>
            ))}
            {(prereq || ctxObjectives.length > 0) && (
              <button type="button" onClick={() => setCtxOpen(!ctxOpen)} aria-expanded={ctxOpen}
                className={cn('ml-auto inline-flex h-[26px] shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors',
                  ctxOpen ? 'border-brand-400 bg-brand-500/12 text-brand-600' : 'border-line bg-ink-900 text-ink-500 hover:text-fg')}>
                Prerequisites &amp; objectives
                <ChevronDown className={cn('h-3 w-3 transition-transform duration-200', ctxOpen && 'rotate-180')} />
              </button>
            )}
          </div>
          {ctxOpen && (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3.5 px-5 pb-3.5">
              {prereq && (
                <div className="rounded-xl border border-line bg-ink-900 px-3.5 py-3">
                  <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-[.04em] text-ink-500">Prerequisite Knowledge</div>
                  <div className="text-[12.5px] leading-relaxed text-fg">{prereq}</div>
                </div>
              )}
              {ctxObjectives.length > 0 && (
                <div className="rounded-xl border border-line bg-ink-900 px-3.5 py-3">
                  <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-[.04em] text-ink-500">Specific Objectives</div>
                  <ul className="list-disc pl-4 text-[12.5px] leading-relaxed text-fg">
                    {ctxObjectives.map((o, i) => <li key={i}>{o}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {prevResStages.length > 0 && (
          <div className="border-b border-line bg-ink-800 px-5 py-2">
            <Tabs items={prevResStages.map((s) => ({ id: s, label: s, count: v.stages[s]?.files.length ?? 0 }))} value={tab} onChange={setPrevTab}
              className="border-0 bg-transparent p-0" />
          </div>
        )}

        <div className="flex flex-1 flex-col gap-3.5 overflow-auto bg-ink-950 px-5 py-[18px]">
          {prevResStages.length === 0 ? (
            <div className="px-5 py-12 text-center text-[13.5px] text-ink-500">No resources available.</div>
          ) : (() => {
            const ss = v.stages[tab]
            if (!ss) return null
            const desc = sanitizeHtml(ss.desc)
            return (
              <div className="overflow-hidden rounded-2xl border border-line bg-ink-900">
                <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
                  <span className="text-[13.5px] font-semibold text-fg">{tab}</span>
                  {ss.setting && ss.setting !== 'Select' && <span className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-ink-500">{ss.setting}</span>}
                  <span className="ml-auto rounded-full bg-brand-500 px-2.5 py-0.5 text-[11px] font-semibold text-white">{ss.files.length}</span>
                </div>
                {desc && <div className={cn('lp-html px-4 py-3 text-[13px] leading-relaxed text-ink-300', ss.files.length > 0 && 'border-b border-line')}
                  dangerouslySetInnerHTML={{ __html: desc }} />}
                {ss.files.length > 0 && (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 px-4 py-3">
                    {ss.files.map((r) => <PreviewTile key={r.id} r={r} onOpen={() => launchSession(v, flatIndex(v, tab, r.id))} />)}
                  </div>
                )}
              </div>
            )
          })()}
        </div>

        <div className="flex justify-end border-t border-line px-5 py-3.5">
          <Button onClick={onClose}>Close preview</Button>
        </div>
      </div>
    </Overlay>
  )
}
