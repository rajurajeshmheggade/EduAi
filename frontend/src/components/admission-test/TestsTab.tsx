import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ClipboardList, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label, Textarea } from '@/components/ui/field'
import { errorMessage } from '@/services/apiClient'
import { admissionTestService as svc, type AdmTest } from '@/services/admissionTestService'

const STATUS_TONE = { DRAFT: 'warn', PUBLISHED: 'ok', ARCHIVED: 'neutral' } as const

/** The teacher's admission tests. */
export function TestsTab({ tests, readOnly }: { tests: AdmTest[] | null; readOnly?: boolean }) {
  const [creating, setCreating] = useState(false)
  if (!tests) return <div className="skeleton h-48" />
  return (
    <div className="space-y-3">
      {!readOnly && <div className="flex justify-end"><Button onClick={() => setCreating(true)} id="new-admission-test"><Plus className="h-4 w-4" /> New admission test</Button></div>}
      {tests.length === 0 ? (
        <Card className="p-10 text-center text-sm text-ink-300"><ClipboardList className="mx-auto mb-2 h-8 w-8 text-ink-500" />
          No admission tests yet. Create one, import questions from your Assignments and Online tests, add the HQ section and publish.</Card>
      ) : tests.map((t) => (
        <Card key={t.test_id} className="flex flex-wrap items-center gap-4 p-5">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium uppercase tracking-wide text-brand-600">{t.grade_applying}{readOnly && t.owner_name ? ` · ${t.owner_name}` : ''}</div>
            <div className="font-display text-lg font-semibold text-fg">{t.title}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-500">
              <Badge tone={STATUS_TONE[t.status]}>{t.status.toLowerCase()}</Badge>
              <span>{t.question_count} questions · {Number(t.academic_marks)} marks · {t.duration_minutes} min</span>
              {t.drafts > 0 && <span className="text-warn">{t.drafts} drafts to review</span>}
              <span>· {t.completed}/{t.sessions} sessions completed</span>
            </div>
          </div>
          {!readOnly && <Link to={`/teacher/admissions/tests/${t.test_id}`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>Open</Link>}
        </Card>
      ))}
      {creating && <CreateTestDialog onClose={() => setCreating(false)} />}
    </div>
  )
}

function CreateTestDialog({ onClose }: { onClose: () => void }) {
  const nav = useNavigate()
  const [f, setF] = useState({ title: '', grade_applying: '', duration_minutes: 60, instructions: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const t = await svc.createTest({ ...f, title: f.title.trim(), grade_applying: f.grade_applying.trim(), instructions: f.instructions.trim() || null })
      nav(`/teacher/admissions/tests/${t.test_id}`)
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  return (
    <Dialog open onClose={onClose} title="New admission test" description="Academic and HQ sections are created for you; you can change them later.">
      <form onSubmit={submit} className="space-y-3">
        <div><Label htmlFor="nt-title">Title</Label><Input id="nt-title" required minLength={2} maxLength={300} placeholder="Class 6 admission test 2027" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="nt-grade">Grade applying for</Label><Input id="nt-grade" required maxLength={64} placeholder="Class 6" value={f.grade_applying} onChange={(e) => setF({ ...f, grade_applying: e.target.value })} /></div>
          <div><Label htmlFor="nt-dur">Duration (minutes)</Label><Input id="nt-dur" type="number" min={5} max={300} value={f.duration_minutes} onChange={(e) => setF({ ...f, duration_minutes: Number(e.target.value) || 5 })} /></div>
        </div>
        <div><Label htmlFor="nt-inst">Instructions (optional)</Label><Textarea id="nt-inst" rows={2} maxLength={5000} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></div>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy} id="create-admission-test">Create</Button></div>
      </form>
    </Dialog>
  )
}
