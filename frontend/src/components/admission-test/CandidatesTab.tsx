import { useState, type FormEvent } from 'react'
import { FileUp, Pencil, Plus, Trash2, UserRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label } from '@/components/ui/field'
import { toast } from '@/components/ui/toast'
import { errorMessage } from '@/services/apiClient'
import { admissionTestService as svc, type Candidate, type CandidateInput, type CsvPreview } from '@/services/admissionTestService'

const SESSION_LABEL = { LAUNCHED: 'Launched', CONFIRMED: 'Confirmed', CHECKED: 'Checked', IN_PROGRESS: 'In progress', SUBMITTED: 'Submitted', ENDED: 'Ended by teacher', LOCKED: 'Locked' } as const

/** Candidates (form or CSV) — sit the test on a device the teacher launches. */
export function CandidatesTab({ candidates, reload, readOnly }: { candidates: Candidate[] | null; reload: () => void; readOnly?: boolean }) {
  const [editing, setEditing] = useState<Candidate | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  if (!candidates) return <div className="skeleton h-48" />
  async function remove(c: Candidate) {
    if (!confirm(`Delete ${c.full_name} and all data captured about them (answers, proctoring events, evidence, reports)? This cannot be undone.`)) return
    try { const r = await svc.deleteCandidate(c.candidate_id); toast(`✓ Deleted ${c.full_name} (${r.sessions} session${r.sessions === 1 ? '' : 's'}, ${r.files} files)`); reload() }
    catch (e) { toast(`✗ ${errorMessage(e)}`) }
  }
  return (
    <div className="space-y-3">
      {!readOnly && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setImporting(true)}><FileUp className="h-4 w-4" /> Import CSV</Button>
          <Button onClick={() => setEditing('new')} id="new-candidate"><Plus className="h-4 w-4" /> Add candidate</Button>
        </div>
      )}
      {candidates.length === 0 ? (
        <Card className="p-10 text-center text-sm text-ink-300"><UserRound className="mx-auto mb-2 h-8 w-8 text-ink-500" />No candidates yet.</Card>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full text-sm">
            <caption className="sr-only">Candidates</caption>
            <thead className="bg-ink-800 text-xs text-ink-300"><tr>
              <th className="px-3 py-2 text-left font-medium">Name</th><th className="px-3 py-2 text-left font-medium">Age</th><th className="px-3 py-2 text-left font-medium">Applying for</th>
              <th className="px-3 py-2 text-left font-medium">Guardian</th><th className="px-3 py-2 text-left font-medium">Latest test</th><th className="px-3 py-2" /></tr></thead>
            <tbody>{candidates.map((c) => (
              <tr key={c.candidate_id} className="border-t border-line">
                <td className="px-3 py-2 font-medium text-fg">{c.full_name}{c.accommodations.extra_time_minutes ? <Badge className="ml-2" tone="aqua">+{c.accommodations.extra_time_minutes} min</Badge> : null}</td>
                <td className="px-3 py-2 tabular-nums">{c.age}{c.minor && <Badge className="ml-2" tone="warn">minor</Badge>}</td>
                <td className="px-3 py-2">{c.grade_applying}</td>
                <td className="px-3 py-2 text-ink-300">{c.guardian_name ?? '—'}</td>
                <td className="px-3 py-2">{c.sessions[0] ? <Badge tone={c.sessions[0].status === 'SUBMITTED' || c.sessions[0].status === 'ENDED' ? 'ok' : 'brand'}>{SESSION_LABEL[c.sessions[0].status]}</Badge> : <span className="text-ink-500">Not started</span>}</td>
                <td className="px-3 py-2 text-right">
                  {!readOnly && <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Edit ${c.full_name}`} onClick={() => setEditing(c)}><Pencil className="h-4 w-4" /></Button>}
                  <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Delete data of ${c.full_name}`} onClick={() => remove(c)}><Trash2 className="h-4 w-4" /></Button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {editing && <CandidateDialog candidate={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
      {importing && <CsvDialog onClose={() => setImporting(false)} onDone={() => { setImporting(false); reload() }} />}
    </div>
  )
}

function CandidateDialog({ candidate, onClose, onSaved }: { candidate: Candidate | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<CandidateInput>(() => candidate ? {
    full_name: candidate.full_name, email: candidate.email, phone: candidate.phone, dob: candidate.dob, grade_applying: candidate.grade_applying,
    guardian_name: candidate.guardian_name, guardian_email: candidate.guardian_email, guardian_phone: candidate.guardian_phone, accommodations: candidate.accommodations,
  } : { full_name: '', email: null, phone: null, dob: '', grade_applying: '', guardian_name: null, guardian_email: null, guardian_phone: null, accommodations: {} })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (p: Partial<CandidateInput>) => setF((x) => ({ ...x, ...p }))
  const txt = (v: string) => v.trim() || null
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const body = { ...f, full_name: f.full_name.trim(), email: txt(f.email ?? ''), phone: txt(f.phone ?? ''), guardian_name: txt(f.guardian_name ?? ''),
        guardian_email: txt(f.guardian_email ?? ''), guardian_phone: txt(f.guardian_phone ?? '') }
      if (candidate) await svc.updateCandidate(candidate.candidate_id, body); else await svc.createCandidate(body)
      onSaved()
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  return (
    <Dialog open onClose={onClose} title={candidate ? 'Edit candidate' : 'Add candidate'} className="w-[min(40rem,calc(100vw-2rem))]">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="c-name">Full name</Label><Input id="c-name" required minLength={2} maxLength={200} value={f.full_name} onChange={(e) => set({ full_name: e.target.value })} /></div>
          <div><Label htmlFor="c-dob">Date of birth</Label><Input id="c-dob" type="date" required value={f.dob} onChange={(e) => set({ dob: e.target.value })} /></div>
          <div><Label htmlFor="c-grade">Applying for</Label><Input id="c-grade" required maxLength={64} placeholder="Class 6" value={f.grade_applying} onChange={(e) => set({ grade_applying: e.target.value })} /></div>
          <div><Label htmlFor="c-email">Email (optional)</Label><Input id="c-email" type="email" maxLength={254} value={f.email ?? ''} onChange={(e) => set({ email: e.target.value })} /></div>
          <div><Label htmlFor="c-g-name">Guardian name</Label><Input id="c-g-name" maxLength={200} value={f.guardian_name ?? ''} onChange={(e) => set({ guardian_name: e.target.value })} /></div>
          <div><Label htmlFor="c-g-phone">Guardian phone</Label><Input id="c-g-phone" maxLength={32} value={f.guardian_phone ?? ''} onChange={(e) => set({ guardian_phone: e.target.value })} /></div>
          <div><Label htmlFor="c-g-email">Guardian email</Label><Input id="c-g-email" type="email" maxLength={254} value={f.guardian_email ?? ''} onChange={(e) => set({ guardian_email: e.target.value })} /></div>
          <div><Label htmlFor="c-extra">Extra time (minutes)</Label><Input id="c-extra" type="number" min={0} max={120} value={f.accommodations.extra_time_minutes ?? 0}
            onChange={(e) => set({ accommodations: { ...f.accommodations, extra_time_minutes: Math.max(0, Math.min(120, Number(e.target.value) || 0)) } })} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-100">
          <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={!!f.accommodations.disable_voice_flag}
            onChange={(e) => set({ accommodations: { ...f.accommodations, disable_voice_flag: e.target.checked } })} />
          Uses permitted assistive speech (do not flag talking)
        </label>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy} id="save-candidate">Save</Button></div>
      </form>
    </Dialog>
  )
}

function CsvDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<CsvPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run(commit: boolean) {
    if (!file) return
    setBusy(true); setError(null)
    try {
      const r = await svc.importCandidates(file, commit)
      if (commit) { toast(`✓ Imported ${r.created} candidate${r.created === 1 ? '' : 's'}`); onDone() } else setPreview(r)
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <Dialog open onClose={onClose} title="Import candidates" description="CSV (UTF-8, ≤ 1 MB) with columns: name, email, phone, dob, grade_applying, guardian_name, guardian_email, guardian_phone."
      className="w-[min(44rem,calc(100vw-2rem))]">
      <div className="space-y-3">
        <input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null) }}
          className="block w-full cursor-pointer rounded-xl border border-dashed border-line-strong bg-ink-800 p-2.5 text-xs text-ink-300 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-500 file:px-3 file:py-1 file:text-white" />
        {preview && (
          <div className="max-h-72 overflow-y-auto rounded-xl border border-line">
            <table className="w-full text-xs">
              <thead className="bg-ink-800 text-ink-300"><tr><th className="px-2 py-1.5 text-left">Line</th><th className="px-2 py-1.5 text-left">Name</th><th className="px-2 py-1.5 text-left">DOB</th><th className="px-2 py-1.5 text-left">Result</th></tr></thead>
              <tbody>{preview.rows.map((r) => (
                <tr key={r.line} className="border-t border-line"><td className="px-2 py-1">{r.line}</td><td className="px-2 py-1">{r.name}</td><td className="px-2 py-1">{r.dob}</td>
                  <td className="px-2 py-1">{r.error ? <span className="text-bad">{r.error}</span> : <span className="text-ok">OK{r.minor ? ' · minor' : ''}</span>}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {preview && <p className="text-sm text-ink-300">{preview.valid} valid · {preview.invalid} with errors (skipped on import)</p>}
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" disabled={!file || busy} onClick={() => run(false)}>Check file</Button>
          <Button disabled={!preview?.valid || busy} onClick={() => run(true)}>Import {preview?.valid ?? ''}</Button>
        </div>
      </div>
    </Dialog>
  )
}
