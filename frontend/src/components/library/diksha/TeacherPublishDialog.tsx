import { useState } from 'react'
import { AlertTriangle, BookOpen, ExternalLink, Layers, Loader2, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { classText } from '@/lib/diksha'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/services/apiClient'
import { dikshaService, type PublishSelection } from '@/services/dikshaService'
import type { PublishTarget } from '@/services/libraryService'

/** Review DIKSHA selections against the target class subject, then publish references (not copies). */
export function TeacherPublishDialog({ selections, target, onClose, onDone }: {
  selections: PublishSelection[]; target: PublishTarget; onClose: () => void; onDone: (msg: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const grade = target.grade_number
  const wrongClass = grade ? selections.filter((s) => s.item.classes.length > 0 && !s.item.classes.includes(grade)) : []
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z]/g, '')
  const otherSubject = selections.filter((s) => s.item.subjects.length > 0 && !s.item.subjects.some((x) =>
    norm(target.subject_name).includes(norm(x)) || norm(x).includes(norm(target.subject_name))))
  const linkOnly = selections.filter((s) => s.item.kind === 'resource' && s.item.access.viewer === 'official')

  async function publish() {
    setBusy(true); setError(null)
    try {
      const r = await dikshaService.publish({
        items: selections.map((s) => ({ source_id: s.source_id, ...(s.within ? { within: s.within } : {}) })),
        class_code: target.class_code, subject_code: target.subject_code,
      })
      const parts = []
      if (r.published.length) parts.push(`Published ${r.published.length} DIKSHA item${r.published.length === 1 ? '' : 's'} to ${target.class_name} · ${target.subject_name} (${r.student_count} students).`)
      if (r.already_published.length) parts.push(`${r.already_published.length} already published there — left unchanged.`)
      onDone(parts.join(' '))
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Dialog open onClose={onClose} title="Publish DIKSHA content" description="Students get a link to the source content — nothing is copied into the LMS." className="w-[min(38rem,calc(100vw-2rem))]">
      <div className="space-y-4 text-sm">
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 rounded-xl bg-ink-800 p-3">
          <dt className="text-ink-500">Class</dt><dd className="font-medium text-fg">{target.class_name}{grade ? ` (Class ${grade})` : ''}</dd>
          <dt className="text-ink-500">Subject</dt><dd className="font-medium text-fg">{target.subject_name}</dd>
          <dt className="text-ink-500">Academic year</dt><dd className="font-medium text-fg">{target.year_code}</dd>
          <dt className="text-ink-500">Students</dt><dd className="font-medium text-fg">All {target.student_count} students of {target.class_name}</dd>
        </dl>
        <ul className="max-h-52 space-y-1 overflow-y-auto">
          {selections.map((s) => (
            <li key={s.source_id} className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-1.5', wrongClass.includes(s) ? 'border-bad/40 bg-bad/5' : 'border-line')}>
              {s.item.kind === 'textbook' ? <BookOpen className="h-4 w-4 shrink-0 text-ink-500" /> : <Layers className="h-4 w-4 shrink-0 text-ink-500" />}
              <span className="min-w-0 flex-1 truncate">{s.item.name ?? s.source_id}</span>
              <span className="shrink-0 text-xs text-ink-500">{[classText(s.item.classes), s.item.subjects[0], s.item.license.name].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ul>
        {wrongClass.length > 0 && <Warn tone="bad">{wrongClass.length} item(s) are not for Class {grade}. Remove them to publish.</Warn>}
        {otherSubject.length > 0 && <Warn>{otherSubject.length} item(s) are tagged with a different subject than {target.subject_name} on DIKSHA.</Warn>}
        {!grade && <Warn>This class has no grade set, so the class of each item is not checked automatically.</Warn>}
        {linkOnly.length > 0 && <p className="flex items-start gap-2 rounded-lg bg-aqua-500/10 px-3 py-2 text-aqua-400"><ExternalLink className="mt-0.5 h-4 w-4 shrink-0" />
          {linkOnly.length} item(s) open on DIKSHA (licence or format does not allow in-app display).</p>}
        {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-bad">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={publish} disabled={busy || wrongClass.length > 0} id="confirm-diksha-publish">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Publish {selections.length} item{selections.length === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function Warn({ tone = 'warn', children }: { tone?: 'warn' | 'bad'; children: React.ReactNode }) {
  return <p className={cn('flex items-start gap-2 rounded-lg px-3 py-2', tone === 'bad' ? 'bg-bad/10 text-bad' : 'bg-warn/10 text-warn')}><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{children}</p>
}
