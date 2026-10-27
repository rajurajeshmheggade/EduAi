/* Lesson Plan View — Assessment: one blue card per ELO with items, item-type / Bloom pills, the MCQ option
   grid and the answer box (hidden for open-response types). */

import { editableText, getAt, type SectionProps } from './edit'
import { EditArea, EditInput, Muted, Pill, SectionHead, TextView } from './ui'

export function AssessmentSection(p: SectionProps) {
  const blocks = p.model.assessed
  return (
    <section aria-label="Assessment">
      <SectionHead title="Assessment" showEdit={p.showEdit && blocks.length > 0} editing={p.editing} editLocked={p.editLocked}
        onEdit={p.onEdit} onSave={p.onSave} onCancel={p.onCancel} />
      {blocks.length === 0 ? <Muted>No assessment items in this plan.</Muted> : (
        <div className="grid gap-4">
          {blocks.map((a) => (
            <div key={a.key + a.index} className="rounded-xl border border-blue-100 bg-ink-900 p-6 shadow-sm">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold text-blue-800">{a.name || a.label}</h3>
                  {a.bloom && <div className="mt-1"><Pill className="bg-blue-50 px-2 text-blue-600">{a.bloom}</Pill></div>}
                </div>
                <Pill className="shrink-0 whitespace-nowrap bg-blue-50 py-1 text-blue-700">{a.items.length} Items</Pill>
              </div>
              <ul className="flex flex-col gap-3">
                {a.items.map((it, n) => {
                  const base = ['assessment', a.index, 'items', it.index]
                  const label = `${a.label} item ${n + 1}`
                  return (
                    <li key={it.index} className="break-inside-avoid rounded-lg border border-line bg-ink-800/60 p-3">
                      <div className="flex items-start gap-2">
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <Pill className="bg-purple-100 px-2.5 text-purple-800">{it.typeLabel || 'Item'}</Pill>
                            {it.bloom && <Pill className="bg-blue-100 px-2.5 text-blue-800">{it.bloom}</Pill>}
                          </div>
                          {p.editing
                            ? <EditArea label={`${label} question`} value={editableText(getAt(p.doc, [...base, 'question']))}
                                onChange={(v) => p.set([...base, 'question'], v)} className="mt-1" />
                            : <TextView text={it.question} className="mt-1 text-ink-300" />}

                          {it.isMcq && it.options.length > 0 && (
                            <div className="mt-2">
                              <p className="mb-1 text-sm font-medium text-ink-300">Options:</p>
                              <div className="grid gap-2 sm:grid-cols-2">
                                {it.options.map((o) => (
                                  <div key={o.key} className="flex items-start gap-2 rounded-md bg-ink-900 p-2">
                                    <span className="mt-px font-medium text-blue-600">{o.letter}.</span>
                                    {p.editing
                                      ? <EditInput label={`${label} option ${o.letter}`} className="h-8 flex-1 px-2 text-[13px]"
                                          value={editableText(getAt(p.doc, [...base, 'options', o.key]))} onChange={(v) => p.set([...base, 'options', o.key], v)} />
                                      : <span className="whitespace-pre-wrap break-words text-ink-100">{o.text}</span>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {it.answerable && (p.editing ? (
                            <div className="mt-2 flex items-center gap-2 rounded-md border border-ok/30 bg-ok/10 p-2 text-sm text-ok">
                              <span className="font-medium">Answer:</span>
                              <EditInput label={`${label} answer`} className="h-8 flex-1 px-2 text-[13px]"
                                value={editableText(getAt(p.doc, [...base, 'answer']))} onChange={(v) => p.set([...base, 'answer'], v)} />
                            </div>
                          ) : it.answer && (
                            <div className="mt-2 rounded-md border border-ok/30 bg-ok/10 p-2 text-sm text-ok">
                              <span className="font-medium">Answer:</span> <span className="whitespace-pre-wrap">{it.answer}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
