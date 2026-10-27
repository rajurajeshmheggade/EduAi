import { ArrowLeft, ChevronDown, Eye } from 'lucide-react'
import { STAGES } from '@/components/lesson-plan/data'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ResourcesValue } from '../resourcesModel'
import { sanitizeHtml, stripHtml } from '../sanitizeHtml'
import { ResourceRow } from './cards'

/* Step 2 — "Preview and Save": every stage that has resources or a description, as a collapsible card
   (open by default when it carries resources), then Back / Preview. */
export function ReviewStep({ v, isOpen, onToggle, onRemove, onBack, onPreview }: {
  v: ResourcesValue
  isOpen: (stage: string) => boolean
  onToggle: (stage: string) => void
  onRemove: (stage: string, id: string) => void
  onBack: () => void
  onPreview: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      {STAGES.map((s) => {
        const ss = v.stages[s]
        if (!ss) return null
        const hasDesc = !!stripHtml(ss.desc)
        if (!ss.files.length && !hasDesc) return null
        const open = isOpen(s)
        const desc = hasDesc ? sanitizeHtml(ss.desc) : ''
        return (
          <div key={s} className="glass overflow-hidden rounded-2xl">
            <button type="button" onClick={() => onToggle(s)} aria-expanded={open}
              className={cn('flex w-full cursor-pointer items-center gap-2.5 border-b bg-gradient-to-b from-brand-500/[0.06] to-transparent px-4 py-3 text-left transition-colors',
                open ? 'border-line' : 'border-transparent')}>
              <span className={cn('inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] bg-brand-500/12 text-brand-600 transition-transform duration-300', !open && '-rotate-90')}>
                <ChevronDown className="h-3 w-3" strokeWidth={2.6} />
              </span>
              <span className="mr-auto text-[13.5px] font-semibold text-fg">{s}</span>
              {ss.setting && ss.setting !== 'Select' && <span className="rounded-full bg-brand-500/12 px-2.5 py-0.5 text-[11.5px] font-medium text-brand-600">{ss.setting}</span>}
              <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-[11.5px] font-semibold text-violet-600">{ss.files.length} resource{ss.files.length === 1 ? '' : 's'}</span>
            </button>
            <div aria-hidden={open ? undefined : true}
              className={cn('grid transition-[grid-template-rows,opacity] duration-300', open ? 'grid-rows-[1fr] opacity-100' : 'invisible grid-rows-[0fr] opacity-0')}>
              <div className="min-h-0 overflow-hidden">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3 px-4 py-3">
                  {ss.files.length === 0
                    ? <span className="text-[12.5px] text-ink-500">No resources picked for this category</span>
                    : ss.files.map((r) => <ResourceRow key={r.id} r={r} onRemove={() => onRemove(s, r.id)} />)}
                  {desc && <div className="lp-html col-span-full mt-1 rounded-xl border border-line bg-ink-950 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-300"
                    dangerouslySetInnerHTML={{ __html: desc }} />}
                </div>
              </div>
            </div>
          </div>
        )
      })}
      <div className="glass flex flex-wrap items-center gap-2.5 rounded-2xl px-4 py-3.5">
        <Button variant="secondary" onClick={onBack}><ArrowLeft className="h-3.5 w-3.5" />Back to Select Resources</Button>
        <div className="flex-1" />
        <Button onClick={onPreview}><Eye className="h-3.5 w-3.5" />Preview</Button>
      </div>
    </div>
  )
}
