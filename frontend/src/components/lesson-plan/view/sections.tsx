/* Lesson Plan View — Core Objectives, Expected Learning Outcomes, Assignments, Learning Experience.
   Colour coding is Rapid's (amber objectives, emerald ELOs, indigo / purple / rose assignment blocks) as light
   Tailwind tints. */

import { ASSIGNMENT_BLOCKS, type AssignmentKey } from '../lessonPlanPrint'
import { corePath, editableText, getAt, type SectionProps } from './edit'
import { EditArea, EditInput, Muted, Pill, SectionHead, TextView } from './ui'

const head = (p: SectionProps, title: string, canEdit = true) => (
  <SectionHead title={title} showEdit={p.showEdit && canEdit} editing={p.editing} editLocked={p.editLocked}
    onEdit={p.onEdit} onSave={p.onSave} onCancel={p.onCancel} />
)

/* ── Core Objectives ─────────────────────────────────────────────────────────────────────────────────── */
export function CoreObjectivesSection(p: SectionProps) {
  const list = p.model.coreObjectives
  return (
    <section aria-label="Core Objectives">
      {head(p, 'Core Objectives', list.length > 0)}
      {list.length === 0 ? <Muted>No core objectives in this plan.</Muted> : (
        <ul className="flex list-disc flex-col gap-4 pl-5 marker:text-amber-500">
          {list.map((o, i) => {
            const path = corePath(p.doc, o.index)
            return (
              <li key={o.index} className="break-inside-avoid rounded-xl border border-amber-100 bg-amber-50/40 p-4">
                {p.editing
                  ? <EditArea label={`Core objective ${i + 1}`} value={editableText(getAt(p.doc, path))} onChange={(v) => p.set(path, v)} />
                  : <TextView text={o.text} className="text-ink-100" />}
                {o.factor && <div className="mt-2"><Pill className="bg-amber-100 text-amber-800">{o.factor}</Pill></div>}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/* ── Expected Learning Outcomes ─────────────────────────────────────────────────────────────────────── */
export function OutcomesSection(p: SectionProps) {
  const list = p.model.outcomes
  // Outcomes read from `plan.elos` (no assessment saved) are display-only: their text keys the 5E design.
  const editable = list.some((o) => o.source === 'assessment')
  return (
    <section aria-label="Expected Learning Outcomes">
      {head(p, 'Expected Learning Outcomes', editable)}
      {list.length === 0 ? <Muted>No learning outcomes in this plan.</Muted> : (
        <ul className="flex list-disc flex-col gap-4 pl-5 marker:text-emerald-500">
          {list.map((o) => {
            const path = ['assessment', o.index, 'fullText']
            return (
              <li key={o.key + o.index} className="break-inside-avoid rounded-xl border border-emerald-100 bg-emerald-50/40 p-4">
                {p.editing && o.source === 'assessment'
                  ? <EditArea label={`${o.label} text`} value={editableText(getAt(p.doc, path))} onChange={(v) => p.set(path, v)} />
                  : <TextView text={o.fullText} className="text-ink-100" />}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Pill className="bg-emerald-100 text-emerald-800">{o.label}</Pill>
                  {o.bloom && <Pill className="bg-amber-100 text-amber-800">Bloom&apos;s Level: {o.bloom}</Pill>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/* ── Assignments (only rendered when the plan has some) ─────────────────────────────────────────────── */
const BLOCK_TINT: Record<AssignmentKey, { box: string; title: string }> = {
  purpose: { box: 'bg-indigo-50', title: 'text-indigo-800' },
  instructions: { box: 'bg-purple-50', title: 'text-purple-800' },
  submission: { box: 'bg-rose-50', title: 'text-rose-800' },
}

export function AssignmentsSection(p: SectionProps) {
  return (
    <section aria-label="Assignments">
      {head(p, 'Assignments')}
      <div className="flex flex-col gap-6">
        {p.model.assignments.map((a, i) => (
          <div key={a.index} className="overflow-hidden rounded-xl border border-line bg-ink-900 shadow-sm">
            <div className="border-b border-line bg-ink-800 px-6 py-3">
              {p.editing
                ? <EditInput label={`Assignment ${i + 1} title`} value={editableText(getAt(p.doc, ['assignments', a.index, 'title']))}
                    onChange={(v) => p.set(['assignments', a.index, 'title'], v)} className="text-base font-semibold" />
                : <h3 className="text-lg font-semibold text-ink-100">{a.title || '—'}</h3>}
            </div>
            <div className="flex flex-col gap-4 p-6">
              {/* Purpose always shows (Rapid); the other two only when the plan carries them. */}
              {ASSIGNMENT_BLOCKS.filter((b) => a[b.key] || b.key === 'purpose').map((b) => {
                const path = ['assignments', a.index, b.key]
                return (
                  <div key={b.key} className={`break-inside-avoid rounded-lg p-4 ${BLOCK_TINT[b.key].box}`}>
                    <h4 className={`mb-2 text-base font-semibold ${BLOCK_TINT[b.key].title}`}>{b.label}</h4>
                    {p.editing
                      ? <EditArea label={`Assignment ${i + 1} ${b.label}`} value={editableText(getAt(p.doc, path))} onChange={(v) => p.set(path, v)} />
                      : a[b.key] ? <TextView text={a[b.key]} className="text-ink-100" /> : <Muted>—</Muted>}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ── Learning Experience — the older per-phase activity list (only rendered when present) ───────────── */
export function LearningExperienceSection(p: SectionProps) {
  return (
    <section aria-label="Learning Experience">
      {head(p, 'Learning Experience')}
      <div className="flex flex-col gap-6">
        {p.model.fiveE.map((ph) => (
          <div key={ph.index} className="rounded-xl border border-line bg-ink-900 p-4">
            <div className="mb-3 flex items-center gap-2.5 text-lg font-semibold text-ink-100">
              {/* The phase colour is validated as a hex value by readPlan. */}
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[15px] font-bold text-white" style={{ backgroundColor: ph.color }} aria-hidden>
                {ph.phase.charAt(0) || '•'}
              </span>
              {ph.phase || '—'}
            </div>
            {ph.activities.length === 0 && <Muted>No activities in this phase.</Muted>}
            {ph.activities.map((act, ai) => {
              const base = ['fiveE', ph.index, 'activities', act.index]
              const isString = typeof getAt(p.doc, base) === 'string'
              const descPath = isString ? base : [...base, 'description']
              return (
                <div key={act.index} className="mb-3 break-inside-avoid rounded-lg border border-line bg-ink-800/60 p-4 last:mb-0">
                  {p.editing ? (
                    <div className="flex flex-col gap-2">
                      {!isString && <EditInput label={`${ph.phase} activity ${ai + 1} title`} placeholder="Activity title"
                        value={editableText(getAt(p.doc, [...base, 'title']))} onChange={(v) => p.set([...base, 'title'], v)} />}
                      <EditArea label={`${ph.phase} activity ${ai + 1} description`} placeholder="Describe the learning experience..." minRows={3}
                        value={editableText(getAt(p.doc, descPath))} onChange={(v) => p.set(descPath, v)} />
                    </div>
                  ) : (
                    <>
                      {act.title && <div className="mb-1.5 font-medium text-ink-100">{act.title}</div>}
                      <TextView text={act.description} className="text-ink-300" />
                    </>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </section>
  )
}
