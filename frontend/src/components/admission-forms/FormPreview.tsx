import { useState } from 'react'
import { Eye, Paperclip } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { PlainText, SectionFields } from '@/components/admission-forms/FormFields'
import { DOC_KINDS, GRADES, accentVars, gradeLabel, validateSection, type Answers, type FormDefinition } from '@/lib/admissionForm'

/** Live preview of the applicant's view: same field components and rules as the standalone app (answers stay local). */
export function FormPreview({ definition, title, grades, schoolName, accent }: {
  definition: FormDefinition; title: string; grades: number[]; schoolName?: string; accent?: string | null
}) {
  const [answers, setAnswers] = useState<Answers>({})
  const [check, setCheck] = useState(false)
  const gradeOptions = (grades.length ? grades : GRADES).map((g) => ({ value: g, label: gradeLabel(g) }))
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-ink-950" style={accentVars(accent)} aria-label="Applicant preview">
      <div className="flex items-center justify-between gap-2 bg-brand-600 px-4 py-3 text-white">
        <div className="min-w-0">
          <p className="truncate text-xs opacity-80">{schoolName ?? 'Your school'}</p>
          <p className="truncate font-display text-base font-semibold">{title || 'Untitled form'}</p>
        </div>
        <Badge className="border-white/30 bg-white/15 text-white"><Eye className="h-3 w-3" /> Preview</Badge>
      </div>
      <div className="space-y-5 p-4">
        {definition.instructions.trim() && (
          <section className="rounded-xl border border-line bg-ink-900 p-3">
            <h3 className="mb-1 text-sm font-semibold">Instructions</h3>
            <PlainText text={definition.instructions} />
          </section>
        )}
        {definition.sections.map((s) => (
          <section key={s.key} className="space-y-3">
            <div>
              <h3 className="text-base font-semibold">{s.title || 'Untitled section'}</h3>
              {s.description && <p className="text-sm text-ink-300">{s.description}</p>}
            </div>
            {s.fields.length ? (
              <SectionFields section={s} answers={answers} grades={gradeOptions} idPrefix={`pv-${s.key}`}
                errors={check ? validateSection(s, answers, grades) : {}}
                onChange={(k, v) => setAnswers((a) => { const n = { ...a }; if (v === null || v === '') delete n[k]; else n[k] = v; return n })} />
            ) : <p className="text-sm text-ink-500">No fields in this section yet.</p>}
          </section>
        ))}
        {definition.documents.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-base font-semibold">Documents</h3>
            <ul className="space-y-2">
              {definition.documents.map((d) => (
                <li key={d.key} className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-line-strong bg-ink-900 p-3 text-sm">
                  <Paperclip className="h-4 w-4 text-ink-500" />
                  <span className="font-medium text-fg">{d.label}</span>
                  {d.required ? <Badge tone="warn">Required</Badge> : <Badge>Optional</Badge>}
                  <span className="text-xs text-ink-500">{DOC_KINDS.filter((k) => d.accept.includes(k.value)).map((k) => k.label).join(', ')} · up to {d.max_mb} MB
                    {d.max_files > 1 ? ` · ${d.max_files} files` : ''}</span>
                  {d.help && <span className="w-full text-xs text-ink-500">{d.help}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
        {definition.declaration.trim() && (
          <label className="flex items-start gap-3 rounded-xl border border-line bg-ink-900 p-3 text-sm">
            <input type="checkbox" className="mt-0.5" /> <span>{definition.declaration}</span>
          </label>
        )}
        <button type="button" onClick={() => setCheck((c) => !c)} className="cursor-pointer text-xs font-medium text-brand-600 hover:underline">
          {check ? 'Hide validation' : 'Check the answers as the applicant would see on submit'}
        </button>
      </div>
    </div>
  )
}
