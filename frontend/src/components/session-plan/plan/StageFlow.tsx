import { Clock, Workflow } from 'lucide-react'
import { renderRich } from '@/components/lesson-plan/Rich'
import { Bullets, PlanCard, bodyText } from './cards'
import { arr, obj, texts, trim, type Rec } from './read'

/* "Session Flow" — the generated stage-by-stage plan: setting + duration pills, teacher notes, steps,
   questions to ask, and each picked resource with how the generator said to use it. howToUse is Markdown
   from the model and goes through renderRich(), the same validation chokepoint the Lesson Plan View uses. */
export function StageFlow({ stages }: { stages: Rec[] }) {
  return (
    <PlanCard icon={Workflow} title="Session Flow" tint="violet" subtitle={`${stages.length} stage${stages.length === 1 ? '' : 's'}`}>
      <div className="flex flex-col gap-3">
        {stages.map((ph, i) => {
          const steps = texts(ph.steps)
          const questions = texts(ph.questions)
          const resources = arr(ph.resources).map(obj).filter((r): r is Rec => !!r)
          const mins = Number(ph.durationMins) || 0
          return (
            <div key={i} className="relative overflow-hidden rounded-2xl border border-line bg-ink-900 py-[15px] pl-[19px] pr-[17px]">
              <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-brand-500 to-aqua-500" />
              <div className="flex flex-wrap items-center gap-2.5">
                <span aria-hidden="true" className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] bg-brand-500/12 text-[11px] font-bold text-brand-600">{i + 1}</span>
                <h3 className="mr-auto text-[15px] font-semibold text-fg">{trim(ph.stage)}</h3>
                {trim(ph.classSetting) && (
                  <span className="inline-flex h-6 items-center rounded-full bg-violet-50 px-2.5 text-[11.5px] font-semibold text-violet-600">{trim(ph.classSetting)}</span>
                )}
                {mins > 0 && (
                  <span className="inline-flex h-6 items-center gap-1 rounded-full bg-brand-500/12 px-2.5 text-[11.5px] font-semibold text-brand-600">
                    <Clock className="h-3 w-3" aria-hidden="true" />{mins} min
                  </span>
                )}
              </div>

              {trim(ph.teacherNotes) && <div className={`${bodyText} mt-2`}>{trim(ph.teacherNotes)}</div>}
              {steps.length > 0 && <div className="mt-2.5"><Bullets items={steps} /></div>}

              {questions.length > 0 && (
                <div className="mt-2.5 border-t border-line pt-2.5">
                  <div className="mb-1.5 text-[12.5px] font-semibold text-ink-500">Questions to ask</div>
                  <ul className="m-0 flex list-disc flex-col gap-1 pl-[18px]">
                    {questions.map((qq, qi) => <li key={qi} className="text-sm leading-[1.65] text-ink-300">{qq}</li>)}
                  </ul>
                </div>
              )}

              {resources.length > 0 ? (
                <div className="mt-2.5 flex flex-col gap-2.5 border-t border-line pt-2.5">
                  {resources.map((r, ri) => (
                    <div key={ri} className="rounded-xl border border-line bg-ink-950 px-3.5 py-3">
                      <div className="text-[13.5px] font-semibold text-fg">{trim(r.title) || trim(r.name)}</div>
                      {trim(r.howToUse)
                        ? <div className="mt-1">{renderRich(trim(r.howToUse))}</div>
                        : <div className="mt-1 text-[12.5px] italic text-ink-500">No usage note was generated for this resource.</div>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-[12.5px] italic text-ink-500">No resources were picked for this stage.</div>
              )}
            </div>
          )
        })}
      </div>
    </PlanCard>
  )
}
