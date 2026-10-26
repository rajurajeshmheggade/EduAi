import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { CheckCircle2, ClipboardList, FileText, Loader2, Paperclip, Send } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Label, Textarea } from '@/components/ui/field'
import { Tabs } from '@/components/ui/tabs'
import { errorMessage } from '@/services/apiClient'
import { classroomService } from '@/services/classroomService'
import type { StudentHomework as HW } from '@/types'

type Filter = 'PENDING' | 'SUBMITTED' | 'REVIEWED'
const fmtDate = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })

/** FR-ST-04: view homework by subject, download worksheets, hand in notes / photo / PDF, see teacher remarks. */
export default function StudentHomework() {
  const [items, setItems] = useState<HW[] | null>(null)
  const [filter, setFilter] = useState<Filter>('PENDING')
  const [open, setOpen] = useState<HW | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => classroomService.myHomework().then((r) => setItems(r.homework)).catch((e) => setError(errorMessage(e))), [])
  useEffect(() => { void load() }, [load])

  const count = (f: Filter) => items?.filter((h) => h.status === f).length ?? 0
  const shown = items?.filter((h) => h.status === filter)
    .sort((a, b) => (filter === 'PENDING' ? a.due_date.localeCompare(b.due_date) : b.due_date.localeCompare(a.due_date)))

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <header className="animate-fade-up">
        <h1 className="font-display text-3xl font-bold">My <span className="text-gradient">homework</span></h1>
        <p className="mt-1 text-sm text-ink-300">Hand in a note, a photo of your notebook, or a PDF.</p>
      </header>
      <Tabs items={[{ id: 'PENDING', label: 'To do', count: count('PENDING') }, { id: 'SUBMITTED', label: 'Submitted', count: count('SUBMITTED') },
        { id: 'REVIEWED', label: 'Reviewed', count: count('REVIEWED') }]} value={filter} onChange={setFilter} />
      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      {!shown ? !error && <div className="skeleton h-48" /> : shown.length === 0 ? (
        <Card className="p-10 text-center text-sm text-ink-300"><ClipboardList className="mx-auto mb-2 h-8 w-8 text-ink-500" />{filter === 'PENDING' ? 'All caught up — no homework due.' : 'Nothing here yet.'}</Card>
      ) : (
        <div className="space-y-3">
          {shown.map((h) => (
            <Card key={h.homework_id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-medium uppercase tracking-wide text-brand-600">{h.subject_name}</div>
                  <div className="mt-0.5 font-display text-lg font-semibold text-fg">{h.title}</div>
                  <div className="text-xs text-ink-500">from {h.assigned_by_name ?? 'your teacher'}</div>
                </div>
                <Badge tone={h.is_overdue ? 'bad' : h.status === 'PENDING' ? 'warn' : 'neutral'}>{h.is_overdue ? 'Overdue · ' : 'Due '}{fmtDate(h.due_date)}</Badge>
              </div>
              <p className="mt-3 whitespace-pre-line text-sm text-ink-100">{h.instructions}</p>
              {h.attachment_url && <a href={h.attachment_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm text-brand-600 hover:underline"><Paperclip className="h-3.5 w-3.5" />{h.attachment_name ?? 'Worksheet'}</a>}
              {h.status !== 'PENDING' && (
                <div className="mt-3 space-y-1 rounded-lg bg-ink-800 p-3 text-sm">
                  {h.submission_notes && <p className="text-ink-300">You wrote: “{h.submission_notes}”</p>}
                  {h.file_url && <a href={h.file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"><FileText className="h-3 w-3" />{h.file_name ?? 'Your file'}</a>}
                  {h.status === 'REVIEWED' && <p className="flex items-center gap-1.5 text-ok"><CheckCircle2 className="h-4 w-4" /> Reviewed{h.teacher_remarks ? `: ${h.teacher_remarks}` : ''}</p>}
                </div>
              )}
              {h.status !== 'REVIEWED' && (
                <Button className="mt-4" size="sm" variant={h.status === 'PENDING' ? 'default' : 'secondary'} onClick={() => setOpen(h)}>
                  <Send className="h-3.5 w-3.5" /> {h.status === 'PENDING' ? 'Hand in' : 'Update submission'}
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}
      {open && <SubmitDialog hw={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); void load() }} />}
    </div>
  )
}

function SubmitDialog({ hw, onClose, onDone }: { hw: HW; onClose: () => void; onDone: () => void }) {
  const [notes, setNotes] = useState(hw.submission_notes ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try { await classroomService.submitHomework(hw.homework_id, notes, file); onDone() }
    catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  return (
    <Dialog open onClose={onClose} title={`Hand in: ${hw.title}`} description={hw.subject_name}>
      <form onSubmit={submit} className="space-y-3">
        <div><Label htmlFor="sub-notes">Note to your teacher</Label><Textarea id="sub-notes" rows={3} maxLength={5000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Done — pages 12–13 of my notebook." /></div>
        <div><Label htmlFor="sub-file">Photo or PDF of your work {hw.file_name ? '(leave empty to keep your earlier file)' : '(optional)'}</Label>
          <input id="sub-file" type="file" accept=".pdf,image/png,image/jpeg" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full cursor-pointer rounded-xl border border-dashed border-line-strong bg-ink-800 p-3 text-sm text-ink-300 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-500 file:px-3 file:py-1.5 file:text-white" />
        </div>
        {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || (!notes.trim() && !file && !hw.file_name)} id="submit-homework">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit</Button>
        </div>
      </form>
    </Dialog>
  )
}
