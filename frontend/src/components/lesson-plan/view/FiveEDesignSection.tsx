/* Lesson Plan View — 5E Design Model (by ELO): `fiveEDesign.eloSteps`, each step's selected resources and the
   generated Markdown at `generatedContentData[`${elo}_${step.id}`][resource]`, rendered with renderRich. */

import { Layers } from 'lucide-react'
import { renderRich } from '../Rich'
import { RICH_FALLBACK, hasHtml, healRich, htmlToText } from '../lessonPlanPrint'
import { editableRich, getAt, type SectionProps } from './edit'
import { EditArea, Muted, SectionHead } from './ui'

/** A generated resource body: Markdown via renderRich; a legacy HTML body as plain text (never as markup). */
function ResourceBody({ content }: { content: unknown }) {
  const healed = healRich(content)
  if (healed.fallback) return <Muted className="text-[13px]">{RICH_FALLBACK}</Muted>
  if (!healed.text.trim()) return <Muted>No content generated yet.</Muted>
  if (hasHtml(healed.text)) return <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink-100">{htmlToText(healed.text)}</div>
  return <div className="text-[15px] leading-relaxed text-ink-100">{renderRich(healed.text, 'base')}</div>
}

const Rule = () => <div className="h-px flex-1 bg-gradient-to-r from-blue-300/0 via-blue-300/70 to-blue-300/0" aria-hidden />

export function FiveEDesignSection(p: SectionProps) {
  return (
    <section aria-label="5E Design Model">
      <SectionHead title="5E Design Model" showEdit={p.showEdit} editing={p.editing} editLocked={p.editLocked}
        onEdit={p.onEdit} onSave={p.onSave} onCancel={p.onCancel} />
      <div className="rounded-xl border-2 border-blue-200/60 bg-gradient-to-br from-ink-900 via-ink-900 to-blue-50/70 p-5 shadow-sm md:p-8">
        <h3 className="mb-6 flex items-center gap-3 text-2xl font-bold text-blue-600">
          <Layers className="h-6 w-6 text-blue-500" aria-hidden />
          5E Design Phase Model (by ELO)
        </h3>
        {p.model.design.map((block) => (
          <div key={block.index} className="mb-8 last:mb-0">
            <div className="mb-4 flex items-center break-after-avoid">
              <Rule />
              <h4 className="mx-4 rounded-full border border-blue-300/60 bg-ink-900/60 px-4 py-2 text-base font-bold text-fg">{block.label}</h4>
              <Rule />
            </div>
            <div className="flex flex-col gap-4">
              {block.steps.length === 0 && <Muted>No phases planned for this outcome.</Muted>}
              {block.steps.map((step) => (
                // break-inside-avoid: a printed phase card is moved to the next page rather than sliced.
                <div key={step.index} className="break-inside-avoid overflow-hidden rounded-xl border border-line bg-ink-900/50">
                  <div className="border-l-4 border-blue-300/70 bg-gradient-to-r from-blue-50 to-blue-50/0 p-5 md:p-6">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 break-after-avoid">
                      <div className="font-semibold text-fg">{step.name || '—'}</div>
                      {step.stepTime && <div className="text-[15px] font-semibold text-blue-800"><span className="font-bold">Step Time:</span> {step.stepTime}</div>}
                    </div>
                    {step.resources.length > 0 ? (
                      <div className="mt-3 flex flex-col gap-4">
                        {step.resources.map((res) => {
                          const path = ['fiveEDesign', 'generatedContentData', step.contentKey, res.key]
                          return (
                            <div key={res.key} className="break-inside-avoid rounded-lg border border-line/70 bg-ink-900/60 p-4">
                              <div className="mb-1.5 text-sm font-medium text-fg">{res.name}</div>
                              {p.editing
                                ? <EditArea label={`${block.label} ${step.name} ${res.name}`} minRows={4} className="text-[13.5px]"
                                    value={editableRich(getAt(p.doc, path) ?? res.content)} onChange={(v) => p.set(path, v, true)} />
                                : <ResourceBody content={res.content} />}
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <Muted className="mt-2">No resources selected for this phase.</Muted>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
