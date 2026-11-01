import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Loader2, Send, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label, Select, Textarea } from '@/components/ui/field'
import { toast } from '@/components/ui/toast'
import { WorksheetEditor } from '@/components/virtual-labs/WorksheetEditor'
import { cleanWorksheet, localInput, subjectFit, worksheetMarks } from '@/lib/virtualLabs'
import { errorMessage } from '@/services/apiClient'
import { virtualLabService, type CollectionInfo, type LabSummary, type LabTarget, type Worksheet } from '@/services/virtualLabService'

const defaultDue = () => { const d = new Date(Date.now() + 7 * 86_400_000); d.setHours(17, 0, 0, 0); return localInput(d) }

/** Teacher assigns one DIKSHA experiment to a class subject with an (AI-drafted, editable) lab worksheet. */
export function AssignLabDialog({ lab, collection, targets, onClose, onAssigned }: {
  lab: LabSummary
  collection: CollectionInfo
  targets: LabTarget[]
  onClose: () => void
  onAssigned: () => void
}) {
  const grade = collection.class_number ?? null
  const fits = (t: LabTarget) => !grade || !t.grade_number || t.grade_number === grade
  // the best-fitting class subject first (Physics for a Science lab rather than Mathematics)
  const first = targets.filter(fits).sort((x, y) => subjectFit(y.subject_name, collection.subject) - subjectFit(x.subject_name, collection.subject))[0]
  const [target, setTarget] = useState(first ? `${first.class_code}|${first.subject_code}` : '')
  const [form, setForm] = useState({ title: lab.name.slice(0, 300), instructions: '', opens: '', due: defaultDue(), min_minutes: 10, allow_late: true })
  const [ws, setWs] = useState<Worksheet | null>(null)
  const [engine, setEngine] = useState<string | null>(null)
  const [drafting, setDrafting] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchDraft = useCallback(() => virtualLabService.draftWorksheet(collection.source_id, lab.lab_id, collection.medium)
    .then((d) => { setWs(d.worksheet); setEngine(d.engine) })
    .catch((e) => setError(errorMessage(e)))
    .finally(() => setDrafting(false)), [collection.source_id, collection.medium, lab.lab_id])
  useEffect(() => { void fetchDraft() }, [fetchDraft])
  const redraft = () => { setDrafting(true); setError(null); void fetchDraft() }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ws) return
    const [class_code, subject_code] = target.split('|')
    const { worksheet, error: wsError } = cleanWorksheet(ws)
    if (!class_code) { setError('Choose a class.'); return }
    if (wsError) { setError(wsError); return }
    setBusy(true); setError(null)
    try {
      const r = await virtualLabService.assign({
        collection_id: collection.source_id, lab_id: lab.lab_id, medium: collection.medium, class_code, subject_code,
        title: form.title.trim(), instructions: form.instructions.trim() || undefined, worksheet,
        min_minutes: form.min_minutes, allow_late: form.allow_late,
        available_from: form.opens ? new Date(form.opens).toISOString() : null, due_at: form.due ? new Date(form.due).toISOString() : null,
      })
      toast(`✓ Lab assigned to ${r.class_name} (${r.student_count} students)`)
      onAssigned()
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  const aiLabel = engine === 'offline' ? 'Template (AI is off)' : engine === 'offline-fallback' ? 'Template (AI unavailable)' : engine ? 'Drafted by AI — review it' : null
  return (
    <Dialog open onClose={onClose} title="Assign virtual lab" description={lab.name} className="w-[min(56rem,calc(100vw-2rem))]">
      <form onSubmit={submit} className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
        {targets.length === 0 ? <p className="text-sm text-bad">You do not teach any class yet.</p> : (
          <div className="grid gap-3 md:grid-cols-2">
            <div><Label htmlFor="vl-target">Class and subject</Label>
              <Select id="vl-target" value={target} onChange={(e) => setTarget(e.target.value)} required>
                {targets.map((t) => (
                  <option key={`${t.class_code}|${t.subject_code}`} value={`${t.class_code}|${t.subject_code}`} disabled={!fits(t)}>
                    {t.class_name} · {t.subject_name}{!fits(t) ? ` (Class ${t.grade_number})` : ''}
                  </option>
                ))}
              </Select>
              {grade && <p className="mt-1 text-xs text-ink-500">This lab is for Class {grade}.</p>}
            </div>
            <div><Label htmlFor="vl-title">Title</Label>
              <Input id="vl-title" required minLength={2} maxLength={300} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          </div>
        )}
        <div><Label htmlFor="vl-inst">Instructions for students (optional)</Label>
          <Textarea id="vl-inst" rows={2} maxLength={4000} placeholder="Perform the simulation twice, then complete the table and the viva."
            value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div><Label htmlFor="vl-opens">Opens (optional)</Label><Input id="vl-opens" type="datetime-local" value={form.opens} onChange={(e) => setForm({ ...form, opens: e.target.value })} /></div>
          <div><Label htmlFor="vl-due">Due</Label><Input id="vl-due" type="datetime-local" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} /></div>
          <div><Label htmlFor="vl-min">Minimum time in lab (min)</Label>
            <Input id="vl-min" type="number" min={0} max={180} value={form.min_minutes} onChange={(e) => setForm({ ...form, min_minutes: Math.max(0, Math.min(180, Number(e.target.value) || 0)) })} /></div>
          <label className="flex items-end gap-2 pb-2.5 text-sm text-ink-100">
            <input type="checkbox" checked={form.allow_late} onChange={(e) => setForm({ ...form, allow_late: e.target.checked })} className="h-4 w-4 accent-brand-500" />
            Accept late submissions
          </label>
        </div>

        <section aria-labelledby="ws-h" className="rounded-2xl border border-line p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 id="ws-h" className="font-display text-base font-semibold text-fg">Lab worksheet</h3>
            {aiLabel && <Badge tone={engine?.startsWith('offline') ? 'neutral' : 'brand'}><Sparkles className="h-3 w-3" /> {aiLabel}</Badge>}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={redraft} disabled={drafting}>
              {drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Redraft with AI
            </Button>
          </div>
          {drafting && !ws ? (
            <div className="flex items-center gap-2 py-10 text-sm text-ink-300" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Preparing the aim, procedure and viva questions…</div>
          ) : ws && <WorksheetEditor value={ws} onChange={setWs} />}
        </section>

        {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
        <div className="flex items-center justify-end gap-2">
          {ws && <span className="mr-auto text-xs text-ink-500">Students see the questions; answers and model answers are shown only after they submit.</span>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" id="assign-lab" disabled={busy || !ws || !target}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Assign {ws ? `(${worksheetMarks(ws)} marks)` : ''}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
