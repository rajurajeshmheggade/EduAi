import { useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, FileText, Lock, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label, Select, Textarea } from '@/components/ui/field'
import {
  CORE, DOC_KINDS, FIELD_TYPES, SECTION_KINDS, allKeys, keyFrom, newField,
  type DocumentDef, type FieldDef, type FieldType, type FormDefinition, type SectionDef,
} from '@/lib/admissionForm'

const move = <T,>(xs: T[], i: number, d: -1 | 1): T[] => {
  const j = i + d
  if (j < 0 || j >= xs.length) return xs
  const out = [...xs]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}
const iconBtn = 'grid h-8 w-8 cursor-pointer place-items-center rounded-lg text-ink-500 hover:bg-ink-800 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40'

/** Teacher's form builder: instructions, sections (student / guardian / academic / custom) with fields, document
 * requirements and the declaration. Core fields (name, date of birth, class, guardian contact) can be relabelled but
 * not removed: the review queue, the status lookup and the admissions CRM depend on them. */
export function FormBuilder({ value, onChange, disabled = false }: { value: FormDefinition; onChange: (d: FormDefinition) => void; disabled?: boolean }) {
  const set = (patch: Partial<FormDefinition>) => onChange({ ...value, ...patch })
  const setSection = (i: number, s: SectionDef) => set({ sections: value.sections.map((x, k) => (k === i ? s : x)) })
  const [kinds, setKinds] = useState<Record<string, FieldType>>({})

  function addSection() {
    const key = keyFrom('additional information', allKeys(value))
    set({ sections: [...value.sections, { key, title: 'Additional information', kind: 'custom', description: null, fields: [] }] })
  }
  function addDocument() {
    const key = keyFrom('document', allKeys(value))
    set({ documents: [...value.documents, { key, label: 'Document', required: false, accept: ['pdf', 'jpg', 'png'], max_mb: 5, max_files: 1, help: null }] })
  }

  return (
    <fieldset disabled={disabled} className="space-y-4">
      <legend className="sr-only">Form builder</legend>
      <Card>
        <CardHeader><CardTitle>Admission instructions</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="b-instructions">Instructions shown before sign-in and on the dashboard</Label>
            <Textarea id="b-instructions" rows={6} maxLength={10000} value={value.instructions} onChange={(e) => set({ instructions: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="b-declaration">Declaration the applicant confirms before submitting</Label>
            <Textarea id="b-declaration" rows={3} maxLength={2000} value={value.declaration} onChange={(e) => set({ declaration: e.target.value })} />
          </div>
        </CardContent>
      </Card>

      {value.sections.map((s, i) => {
        const locked = s.fields.some((f) => f.core && CORE[f.core].required)
        return (
          <Card key={s.key}>
            <CardHeader className="gap-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[12rem] flex-1">
                  <Label htmlFor={`s-${s.key}-title`}>Section {i + 1}</Label>
                  <Input id={`s-${s.key}-title`} maxLength={120} value={s.title} onChange={(e) => setSection(i, { ...s, title: e.target.value })} />
                </div>
                <div className="w-48">
                  <Label htmlFor={`s-${s.key}-kind`}>Type</Label>
                  <Select id={`s-${s.key}-kind`} value={s.kind} onChange={(e) => setSection(i, { ...s, kind: e.target.value as SectionDef['kind'] })}>
                    {SECTION_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </Select>
                </div>
                <div className="flex gap-1">
                  <button type="button" className={iconBtn} aria-label={`Move section ${s.title} up`} disabled={i === 0}
                    onClick={() => set({ sections: move(value.sections, i, -1) })}><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" className={iconBtn} aria-label={`Move section ${s.title} down`} disabled={i === value.sections.length - 1}
                    onClick={() => set({ sections: move(value.sections, i, 1) })}><ArrowDown className="h-4 w-4" /></button>
                  <button type="button" className={iconBtn} aria-label={`Delete section ${s.title}`} disabled={locked || value.sections.length === 1}
                    title={locked ? 'This section holds required fields' : undefined}
                    onClick={() => set({ sections: value.sections.filter((_, k) => k !== i) })}><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
              <Input aria-label={`Description of ${s.title}`} placeholder="Optional description shown under the section title" maxLength={1000}
                value={s.description ?? ''} onChange={(e) => setSection(i, { ...s, description: e.target.value || null })} />
            </CardHeader>
            <CardContent className="space-y-2">
              {s.fields.length === 0 && <p className="text-sm text-ink-500">No fields yet.</p>}
              {s.fields.map((f, j) => (
                <FieldRow key={f.key} f={f} first={j === 0} last={j === s.fields.length - 1}
                  onChange={(nf) => setSection(i, { ...s, fields: s.fields.map((x, k) => (k === j ? nf : x)) })}
                  onMove={(d) => setSection(i, { ...s, fields: move(s.fields, j, d) })}
                  onDelete={() => setSection(i, { ...s, fields: s.fields.filter((_, k) => k !== j) })} />
              ))}
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Select aria-label={`Type of the new field in ${s.title}`} className="h-8 w-44 text-xs" value={kinds[s.key] ?? 'text'}
                  onChange={(e) => setKinds((k) => ({ ...k, [s.key]: e.target.value as FieldType }))}>
                  {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
                <Button size="sm" variant="secondary" onClick={() => setSection(i, { ...s, fields: [...s.fields, newField(kinds[s.key] ?? 'text', 'New question', allKeys(value))] })}
                  disabled={s.fields.length >= 40}><Plus className="h-3.5 w-3.5" /> Add field</Button>
              </div>
            </CardContent>
          </Card>
        )
      })}
      <Button variant="outline" onClick={addSection} disabled={value.sections.length >= 12}><Plus className="h-4 w-4" /> Add section</Button>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-brand-600" /> Document uploads</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {value.documents.length === 0 && <p className="text-sm text-ink-500">No documents requested.</p>}
          {value.documents.map((d, i) => (
            <DocRow key={d.key} d={d} onChange={(nd) => set({ documents: value.documents.map((x, k) => (k === i ? nd : x)) })}
              onDelete={() => set({ documents: value.documents.filter((_, k) => k !== i) })} />
          ))}
          <Button size="sm" variant="secondary" onClick={addDocument} disabled={value.documents.length >= 15}><Plus className="h-3.5 w-3.5" /> Add document</Button>
          <p className="text-xs text-ink-500">Files are checked by their content (PDF, JPEG, PNG only), images are re-encoded, and PDFs with scripts or passwords are refused.</p>
        </CardContent>
      </Card>
    </fieldset>
  )
}

function FieldRow({ f, first, last, onChange, onMove, onDelete }: {
  f: FieldDef; first: boolean; last: boolean; onChange: (f: FieldDef) => void; onMove: (d: -1 | 1) => void; onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const core = f.core ? CORE[f.core] : null
  const id = `fld-${f.key}`
  return (
    <div className="rounded-xl border border-line bg-ink-900/60 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={iconBtn} aria-expanded={open} aria-controls={`${id}-more`} aria-label={`${open ? 'Hide' : 'Show'} settings of ${f.label}`}
          onClick={() => setOpen((o) => !o)}>{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
        <Input aria-label="Field label" className="h-8 min-w-[10rem] flex-1 text-sm" maxLength={150} value={f.label}
          onChange={(e) => onChange({ ...f, label: e.target.value })} />
        <Select aria-label={`Type of ${f.label}`} className="h-8 w-40 text-xs" value={f.type} disabled={!!core}
          onChange={(e) => onChange({ ...f, type: e.target.value as FieldType, options: e.target.value === 'select' ? f.options?.length ? f.options : ['Option 1'] : [] })}>
          {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-ink-300">
          <input type="checkbox" checked={!!(f.required || core?.required)} disabled={!!core?.required}
            onChange={(e) => onChange({ ...f, required: e.target.checked })} /> Required
        </label>
        {core && <Badge tone="brand" title="Used by the review queue, the status lookup and the admissions records"><Lock className="h-3 w-3" /> Core</Badge>}
        <div className="ml-auto flex gap-0.5">
          <button type="button" className={iconBtn} aria-label={`Move ${f.label} up`} disabled={first} onClick={() => onMove(-1)}><ArrowUp className="h-4 w-4" /></button>
          <button type="button" className={iconBtn} aria-label={`Move ${f.label} down`} disabled={last} onClick={() => onMove(1)}><ArrowDown className="h-4 w-4" /></button>
          <button type="button" className={iconBtn} aria-label={`Delete ${f.label}`} disabled={!!core?.required} onClick={onDelete}><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>
      {open && (
        <div id={`${id}-more`} className="mt-2 grid gap-2 border-t border-line pt-2 sm:grid-cols-2">
          <div><Label htmlFor={`${id}-help`}>Help text</Label>
            <Input id={`${id}-help`} maxLength={300} value={f.help ?? ''} onChange={(e) => onChange({ ...f, help: e.target.value || null })} /></div>
          <div><Label htmlFor={`${id}-ph`}>Placeholder</Label>
            <Input id={`${id}-ph`} maxLength={120} value={f.placeholder ?? ''} onChange={(e) => onChange({ ...f, placeholder: e.target.value || null })} /></div>
          {f.type === 'select' && (
            <div className="sm:col-span-2"><Label htmlFor={`${id}-opts`}>Options (one per line)</Label>
              <Textarea id={`${id}-opts`} rows={4} value={(f.options ?? []).join('\n')}
                onChange={(e) => onChange({ ...f, options: e.target.value.split('\n').slice(0, 50) })} /></div>
          )}
          {f.type === 'number' && (
            <>
              <div><Label htmlFor={`${id}-min`}>Minimum</Label><Input id={`${id}-min`} type="number" value={f.min ?? ''}
                onChange={(e) => onChange({ ...f, min: e.target.value === '' ? null : Number(e.target.value) })} /></div>
              <div><Label htmlFor={`${id}-max`}>Maximum</Label><Input id={`${id}-max`} type="number" value={f.max ?? ''}
                onChange={(e) => onChange({ ...f, max: e.target.value === '' ? null : Number(e.target.value) })} /></div>
            </>
          )}
          {(f.type === 'text' || f.type === 'textarea') && (
            <div><Label htmlFor={`${id}-len`}>Maximum length</Label><Input id={`${id}-len`} type="number" min={1} max={4000}
              placeholder={f.type === 'text' ? '200' : '2000'} value={f.max_length ?? ''}
              onChange={(e) => onChange({ ...f, max_length: e.target.value === '' ? null : Math.max(1, Math.min(4000, Number(e.target.value))) })} /></div>
          )}
          <p className="text-xs text-ink-500 sm:col-span-2">Key <code className="font-mono">{f.key}</code>{core ? ` · core field: ${core.label}` : ''}</p>
        </div>
      )}
    </div>
  )
}

function DocRow({ d, onChange, onDelete }: { d: DocumentDef; onChange: (d: DocumentDef) => void; onDelete: () => void }) {
  const id = `doc-${d.key}`
  return (
    <div className="grid gap-2 rounded-xl border border-line bg-ink-900/60 p-3 sm:grid-cols-[1fr_auto]">
      <div className="grid gap-2 sm:grid-cols-2">
        <div><Label htmlFor={`${id}-label`}>Document</Label>
          <Input id={`${id}-label`} maxLength={150} value={d.label} onChange={(e) => onChange({ ...d, label: e.target.value })} /></div>
        <div><Label htmlFor={`${id}-help`}>Help text</Label>
          <Input id={`${id}-help`} maxLength={300} value={d.help ?? ''} onChange={(e) => onChange({ ...d, help: e.target.value || null })} /></div>
        <fieldset className="flex flex-wrap items-center gap-3 text-xs text-ink-300">
          <legend className="sr-only">Accepted file types for {d.label}</legend>
          {DOC_KINDS.map((k) => (
            <label key={k.value} className="flex items-center gap-1.5">
              <input type="checkbox" checked={d.accept.includes(k.value)}
                onChange={(e) => onChange({ ...d, accept: e.target.checked ? [...d.accept, k.value] : d.accept.filter((x) => x !== k.value) })} /> {k.label}
            </label>
          ))}
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!d.required} onChange={(e) => onChange({ ...d, required: e.target.checked })} /> Required</label>
        </fieldset>
        <div className="flex gap-2">
          <div className="w-24"><Label htmlFor={`${id}-mb`}>Max MB</Label>
            <Input id={`${id}-mb`} type="number" min={1} max={10} value={d.max_mb} onChange={(e) => onChange({ ...d, max_mb: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} /></div>
          <div className="w-24"><Label htmlFor={`${id}-n`}>Max files</Label>
            <Input id={`${id}-n`} type="number" min={1} max={5} value={d.max_files} onChange={(e) => onChange({ ...d, max_files: Math.max(1, Math.min(5, Number(e.target.value) || 1)) })} /></div>
        </div>
      </div>
      <button type="button" className={iconBtn} aria-label={`Delete document ${d.label}`} onClick={onDelete}><Trash2 className="h-4 w-4" /></button>
    </div>
  )
}
