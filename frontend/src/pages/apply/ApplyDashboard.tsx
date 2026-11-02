import { Link } from 'react-router-dom'
import { ArrowRight, CalendarClock, CheckCircle2, Circle, FileText, KeyRound, MessageSquareWarning, ShieldCheck, SquarePen } from 'lucide-react'
import { PlainText } from '@/components/admission-forms/FormFields'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { STATUS_TONE, documentProblems, fmtDateTime, sectionProgress } from '@/lib/admissionForm'
import { cn } from '@/lib/utils'
import { useApply } from './context'

const card = 'rounded-2xl border border-line bg-ink-900 p-5 shadow-sm'

/** Applicant dashboard: where the application stands, what is left, credential expiry, corrections requested. */
export default function ApplyDashboard() {
  const { me, base, info } = useApply()
  if (!me) return null
  const { application: app, form } = me
  const d = form.definition
  const counts: Record<string, number> = {}
  for (const x of me.documents) counts[x.requirement_key] = (counts[x.requirement_key] ?? 0) + 1
  const missingDocs = Object.keys(documentProblems(d, counts)).length
  const steps = [
    ...d.sections.map((s) => { const p = sectionProgress(s, app.answers); return { label: s.title, done: p.total === 0 ? Object.keys(app.answers).length > 0 : p.done === p.total, detail: `${p.done}/${p.total} required` } }),
    ...(d.documents.length ? [{ label: 'Documents', done: missingDocs === 0, detail: `${me.documents.length} uploaded` }] : []),
    { label: form.has_test ? 'Submit, then take the admission test' : 'Review and submit', done: !app.editable, detail: app.submitted_at ? fmtDateTime(app.submitted_at) : '' },
  ]
  const done = steps.filter((s) => s.done).length
  const pct = Math.round((done / steps.length) * 100)
  const correction = app.status === 'correction_requested' ? me.corrections[0] : null
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Your application</h1>
        <p className="mt-1 text-ink-300">{info.school.name} · {form.title}</p>
      </div>
      {correction && (
        <div role="alert" className="flex gap-3 rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm">
          <MessageSquareWarning className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
          <div><p className="font-semibold text-fg">The school asked for corrections</p>
            {correction.note && <p className="mt-1 whitespace-pre-line text-ink-100">{correction.note}</p>}
            <p className="mt-1 text-xs text-ink-500">Make the changes and submit again. These credentials stop working after you resubmit.</p></div>
        </div>
      )}
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_18rem]">
        <section className={card} aria-labelledby="progress-title">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="progress-title" className="font-display text-lg font-semibold">Progress</h2>
            <Badge tone={STATUS_TONE[app.status]}>{app.status_label}</Badge>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-700" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Application progress">
            <div className="h-full rounded-full bg-brand-500 transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <ol className="mt-4 space-y-2.5">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center gap-3 text-sm">
                {s.done ? <CheckCircle2 className="h-5 w-5 text-ok" aria-label="Done" /> : <Circle className="h-5 w-5 text-ink-500" aria-label="To do" />}
                <span className="flex-1 text-fg">{s.label}</span><span className="text-xs text-ink-500">{s.detail}</span>
              </li>
            ))}
          </ol>
          <div className="mt-5 flex flex-wrap gap-2">
            {app.editable && <Link to={`${base}/form`} className={cn(buttonVariants({ size: 'lg' }))}><SquarePen className="h-5 w-5" />
              {Object.keys(app.answers).length ? 'Continue the application' : 'Start the application'} <ArrowRight className="h-4 w-4" /></Link>}
            {app.status === 'test_pending' && <Link to={`${base}/test`} className={cn(buttonVariants({ size: 'lg' }))}><ShieldCheck className="h-5 w-5" /> Take the admission test</Link>}
            {!app.editable && <Link to={`${base}/form`} className={cn(buttonVariants({ variant: 'secondary' }))}><FileText className="h-4 w-4" /> View my answers</Link>}
          </div>
          {app.last_saved_at && <p className="mt-3 text-xs text-ink-500">Last saved {fmtDateTime(app.last_saved_at)}</p>}
        </section>
        <aside className="space-y-4">
          {me.credential && (
            <div className={card}>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-fg"><KeyRound className="h-4 w-4 text-brand-600" /> Your credentials</h2>
              <p className="mt-1 font-mono text-xs text-ink-300">{me.credential.username}</p>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-500"><CalendarClock className="h-3.5 w-3.5" /> Valid until {fmtDateTime(me.credential.expires_at)}</p>
              <p className="mt-2 text-xs text-ink-500">One-time: they stop working when you {form.has_test ? 'submit the admission test' : 'submit'}.</p>
            </div>
          )}
          {me.test && (
            <div className={card}>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-fg"><ShieldCheck className="h-4 w-4 text-brand-600" /> Admission test</h2>
              <p className="mt-1 text-sm text-ink-300">{me.test.title} · {me.test.duration_minutes} min</p>
              <p className="mt-1 text-xs text-ink-500">Taken on a desktop or laptop with Chrome or Edge, a camera and a microphone, after you submit the application.</p>
            </div>
          )}
          {info.form.instructions && (
            <details className={card}>
              <summary className="cursor-pointer text-sm font-semibold text-fg">Instructions</summary>
              <PlainText text={info.form.instructions} className="mt-2" />
            </details>
          )}
        </aside>
      </div>
    </div>
  )
}
