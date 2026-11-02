import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Cloud, CloudOff, Eye, FileText, Loader2, Paperclip, PencilLine, Send, Trash2, Upload } from 'lucide-react'
import { PlainText, SectionFields } from '@/components/admission-forms/FormFields'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import {
  DOC_KINDS, acceptAttr, documentProblems, fileProblem, fmtDate, fmtSize, gradeLabel, validateAnswers, validateSection,
  type AnswerValue, type Answers, type DocumentDef,
} from '@/lib/admissionForm'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/services/apiClient'
import { applyService, applyStore, submitErrors, type ApplyDocument } from '@/services/applyService'
import { useApply } from './context'

type Step = { id: string; title: string; kind: 'section' | 'documents' | 'review' }
const AUTOSAVE_MS = 1200
const card = 'rounded-2xl border border-line bg-ink-900 p-5 shadow-sm sm:p-6'

/** Multi-step application: one step per section, documents, then review & submit. Answers autosave; the server
 * checks everything again on submission. */
export default function ApplyForm() {
  const { me, slug, base, reloadMe, forget } = useApply()
  const nav = useNavigate()
  const app = me!.application
  const defn = me!.form.definition
  const grades = me!.form.grades
  const gradeValues = useMemo(() => grades.map((g) => g.value), [grades])
  const steps = useMemo<Step[]>(() => [
    ...defn.sections.map((s) => ({ id: s.key, title: s.title, kind: 'section' as const })),
    ...(defn.documents.length ? [{ id: '__documents', title: 'Documents', kind: 'documents' as const }] : []),
    { id: '__review', title: app.editable ? 'Review & submit' : 'Your application', kind: 'review' as const },
  ], [defn, app.editable])
  const [stepIdx, setStepIdx] = useState(app.editable ? 0 : steps.length - 1)
  const [answers, setAnswers] = useState<Answers>(app.answers)
  const [docs, setDocs] = useState<ApplyDocument[]>(me!.documents)
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [save, setSave] = useState<{ state: 'idle' | 'saving' | 'saved' | 'error'; at?: string }>({ state: 'idle', at: app.last_saved_at ?? undefined })
  const pending = useRef<Answers | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const heading = useRef<HTMLHeadingElement>(null)
  const step = steps[stepIdx]

  const flush = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(timer.current)
    const a = pending.current
    if (!a) return true
    pending.current = null
    setSave((s) => ({ ...s, state: 'saving' }))
    try {
      const r = await applyService.saveAnswers(slug, a)
      setSave({ state: 'saved', at: r.saved_at })
      return true
    } catch (e) {
      pending.current = pending.current ?? a
      setSave((s) => ({ ...s, state: 'error' }))
      toast(errorMessage(e, 'Your answers could not be saved'), 'error')
      return false
    }
  }, [slug])

  useEffect(() => () => { window.clearTimeout(timer.current); if (pending.current) void applyService.saveAnswers(slug, pending.current).catch(() => {}) }, [slug])
  useEffect(() => {
    const on = (e: BeforeUnloadEvent) => { if (pending.current) e.preventDefault() }
    window.addEventListener('beforeunload', on)
    return () => window.removeEventListener('beforeunload', on)
  }, [])

  function change(key: string, v: AnswerValue | null) {
    setAnswers((a) => {
      const next = { ...a }
      if (v === null || v === '') delete next[key]; else next[key] = v
      pending.current = next
      return next
    })
    setServerErrors((e) => { if (!e[key]) return e; const n = { ...e }; delete n[key]; return n })
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS)
  }

  async function goTo(i: number) {
    if (app.editable) await flush()
    setStepIdx(Math.max(0, Math.min(steps.length - 1, i)))
    window.scrollTo({ top: 0, behavior: 'smooth' })
    queueMicrotask(() => heading.current?.focus())
  }
  function next() {
    if (step.kind === 'section') setTouched((t) => new Set(t).add(step.id))
    void goTo(stepIdx + 1)
  }

  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const d of docs) c[d.requirement_key] = (c[d.requirement_key] ?? 0) + 1; return c }, [docs])
  const allErrors = useMemo(() => ({ ...validateAnswers(defn, answers, gradeValues), ...documentProblems(defn, counts), ...serverErrors }),
    [defn, answers, gradeValues, counts, serverErrors])
  const stepErrors = (s: Step) => s.kind === 'section' ? { ...validateSection(defn.sections.find((x) => x.key === s.id)!, answers, gradeValues),
    ...Object.fromEntries(Object.entries(serverErrors).filter(([k]) => defn.sections.find((x) => x.key === s.id)!.fields.some((f) => f.key === k))) }
    : s.kind === 'documents' ? documentProblems(defn, counts) : {}

  async function onSubmitted(reference: string, status: string, test: boolean) {
    applyStore.saveDone({ slug, reference_no: reference, status: status as never, at: new Date().toISOString(), test })
    if (test) { await reloadMe(); nav(`${base}/test`, { replace: true }); return }
    forget()
    nav(`${base}/submitted`, { replace: true })
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Step {stepIdx + 1} of {steps.length}</p>
          <h1 ref={heading} tabIndex={-1} className="font-display text-2xl font-bold outline-none sm:text-3xl">{step.title}</h1>
        </div>
        {app.editable && <SaveState state={save.state} at={save.at} onRetry={() => void flush()} />}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ink-700" role="progressbar" aria-label="Steps completed" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={stepIdx + 1}>
        <div className="h-full bg-brand-500 transition-[width]" style={{ width: `${((stepIdx + 1) / steps.length) * 100}%` }} />
      </div>
      <div className="grid gap-5 md:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Application steps" className="hidden md:block">
          <ol className="space-y-1">
            {steps.map((s, i) => {
              const errs = Object.keys(stepErrors(s)).length
              const showErr = errs > 0 && (touched.has(s.id) || Object.keys(serverErrors).length > 0) && app.editable
              return (
                <li key={s.id}>
                  <button onClick={() => void goTo(i)} aria-current={i === stepIdx ? 'step' : undefined}
                    className={cn('flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-left text-sm',
                      i === stepIdx ? 'bg-brand-500/10 font-medium text-brand-600' : 'text-ink-300 hover:bg-ink-800')}>
                    <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs', i === stepIdx ? 'bg-brand-500 text-white' : 'bg-ink-700')}>{i + 1}</span>
                    <span className="flex-1 truncate">{s.title}</span>
                    {showErr && <AlertTriangle className="h-4 w-4 text-warn" aria-label="Needs attention" />}
                  </button>
                </li>
              )
            })}
          </ol>
        </nav>
        <div className="space-y-5">
          {step.kind === 'section' && (() => {
            const s = defn.sections.find((x) => x.key === step.id)!
            return (
              <section className={card} aria-labelledby={undefined}>
                {s.description && <p className="mb-4 text-sm text-ink-300">{s.description}</p>}
                <SectionFields section={s} answers={answers} grades={grades} idPrefix="ap" disabled={!app.editable}
                  errors={touched.has(s.key) ? stepErrors(step) : serverErrors} onChange={change} />
              </section>
            )
          })()}
          {step.kind === 'documents' && <DocumentsStep docs={docs} setDocs={setDocs} editable={app.editable} touched={touched.has('__documents')} />}
          {step.kind === 'review' && (
            <Review answers={answers} docs={docs} errors={app.editable ? allErrors : {}} steps={steps} onEdit={(i) => void goTo(i)}
              flush={flush} onSubmitted={onSubmitted} onServerErrors={(e) => { setServerErrors(e); setTouched(new Set(steps.map((s) => s.id))) }} />
          )}
          <div className="sticky bottom-0 z-20 -mx-4 flex justify-between gap-2 border-t border-line bg-ink-900/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
            <Button variant="secondary" onClick={() => void goTo(stepIdx - 1)} disabled={stepIdx === 0}><ArrowLeft className="h-4 w-4" /> Back</Button>
            {stepIdx < steps.length - 1 && <Button onClick={next} id="apply-next">Next <ArrowRight className="h-4 w-4" /></Button>}
          </div>
        </div>
      </div>
    </div>
  )
}

function SaveState({ state, at, onRetry }: { state: 'idle' | 'saving' | 'saved' | 'error'; at?: string; onRetry: () => void }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-ink-500">
      {state === 'saving' && <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>}
      {(state === 'saved' || state === 'idle') && at && <><Cloud className="h-3.5 w-3.5 text-ok" /> Saved {new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</>}
      {state === 'error' && <><CloudOff className="h-3.5 w-3.5 text-bad" /> Not saved <button onClick={onRetry} className="cursor-pointer font-medium text-brand-600 hover:underline">Retry</button></>}
    </div>
  )
}

function DocumentsStep({ docs, setDocs, editable, touched }: { docs: ApplyDocument[]; setDocs: (fn: (d: ApplyDocument[]) => ApplyDocument[]) => void; editable: boolean; touched: boolean }) {
  const { me, slug } = useApply()
  const defn = me!.form.definition
  return (
    <section className="space-y-4" aria-label="Documents">
      <p className="text-sm text-ink-300">Upload clear scans or photos. Files are checked when they arrive; photos are re-saved without their hidden metadata.</p>
      {defn.documents.map((d) => <DocumentRow key={d.key} d={d} docs={docs.filter((x) => x.requirement_key === d.key)} slug={slug} editable={editable}
        missing={touched && !!d.required && !docs.some((x) => x.requirement_key === d.key)}
        onAdded={(x) => setDocs((all) => [...all, x])} onRemoved={(id) => setDocs((all) => all.filter((x) => x.document_id !== id))} />)}
    </section>
  )
}

function DocumentRow({ d, docs, slug, editable, missing, onAdded, onRemoved }: {
  d: DocumentDef; docs: ApplyDocument[]; slug: string; editable: boolean; missing: boolean; onAdded: (x: ApplyDocument) => void; onRemoved: (id: string) => void
}) {
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const id = `doc-${d.key}`
  async function pick(file: File) {
    const p = fileProblem(d, file)
    if (p) { setError(p); return }
    setError(null); setProgress(0)
    try { onAdded(await applyService.upload(slug, d.key, file, setProgress)) } catch (e) { setError(errorMessage(e)) } finally { setProgress(null) }
  }
  async function view(x: ApplyDocument) {
    setBusy(x.document_id)
    try {
      const blob = await applyService.documentBlob(slug, x.document_id)
      const url = URL.createObjectURL(new Blob([blob], { type: x.mime }))
      window.open(url, '_blank', 'noopener')
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(null) }
  }
  async function remove(x: ApplyDocument) {
    if (!window.confirm(`Remove ${x.filename}?`)) return
    setBusy(x.document_id)
    try { await applyService.deleteDocument(slug, x.document_id); onRemoved(x.document_id) } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(null) }
  }
  const full = docs.length >= d.max_files
  return (
    <div className={cn(card, missing && 'border-bad/50')}>
      <div className="flex flex-wrap items-start gap-2">
        <Paperclip className="mt-0.5 h-5 w-5 text-brand-600" />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-fg">{d.label} {d.required ? <Badge tone="warn" className="ml-1">Required</Badge> : <Badge className="ml-1">Optional</Badge>}</h3>
          <p id={`${id}-hint`} className="text-xs text-ink-500">{DOC_KINDS.filter((k) => d.accept.includes(k.value)).map((k) => k.label).join(' / ')} · up to {d.max_mb} MB
            {d.max_files > 1 ? ` · up to ${d.max_files} files` : ''}{d.help ? ` · ${d.help}` : ''}</p>
        </div>
      </div>
      {docs.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
          {docs.map((x) => (
            <li key={x.document_id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-ok" /><span className="min-w-0 flex-1 truncate">{x.filename}</span>
              <span className="text-xs text-ink-500">{fmtSize(x.size_bytes)}</span>
              <Button size="sm" variant="ghost" onClick={() => void view(x)} disabled={busy === x.document_id} aria-label={`View ${x.filename}`}><Eye className="h-3.5 w-3.5" /></Button>
              {editable && <Button size="sm" variant="ghost" onClick={() => void remove(x)} disabled={busy === x.document_id} aria-label={`Remove ${x.filename}`}><Trash2 className="h-3.5 w-3.5" /></Button>}
            </li>
          ))}
        </ul>
      )}
      {editable && !full && (
        <label htmlFor={id} className="mt-3 flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed border-line-strong bg-ink-950 px-4 py-5 text-center text-sm text-ink-300 hover:border-brand-400">
          {progress !== null ? <><Loader2 className="h-5 w-5 animate-spin text-brand-600" /> Uploading… {progress}%</> : <><Upload className="h-5 w-5 text-brand-600" /> Choose a file</>}
          <input id={id} type="file" className="sr-only" accept={acceptAttr(d)} aria-describedby={`${id}-hint`} disabled={progress !== null}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pick(f) }} />
        </label>
      )}
      {(error || missing) && <p role="alert" className="mt-2 text-sm font-medium text-bad">{error ?? 'Upload this document'}</p>}
    </div>
  )
}

function Review({ answers, docs, errors, steps, onEdit, flush, onSubmitted, onServerErrors }: {
  answers: Answers; docs: ApplyDocument[]; errors: Record<string, string>; steps: Step[]; onEdit: (i: number) => void
  flush: () => Promise<boolean>; onSubmitted: (ref: string, status: string, test: boolean) => Promise<void>; onServerErrors: (e: Record<string, string>) => void
}) {
  const { me, slug } = useApply()
  const app = me!.application
  const defn = me!.form.definition
  const [declared, setDeclared] = useState(false)
  const [consented, setConsented] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const problems = Object.keys(errors).length
  const show = (v: AnswerValue | undefined, type: string) => v === undefined || v === '' ? '—'
    : type === 'checkbox' ? (v ? 'Yes' : 'No') : type === 'date' ? fmtDate(String(v)) : type === 'grade' ? gradeLabel(Number(v)) : String(v)

  async function submit() {
    setBusy(true); setError(null)
    try {
      if (!(await flush())) { setBusy(false); setConfirm(false); return }
      const r = await applyService.submit(slug, { declaration: declared, consent_confirm: consented, consent_version_id: me!.consent?.version_id ?? null })
      await onSubmitted(r.reference_no, r.status, r.test_required)
    } catch (e) {
      const fe = submitErrors(e)
      if (fe) { onServerErrors(fe); setError('Some answers need attention — the steps marked ⚠ show what to fix.') } else setError(errorMessage(e))
      setBusy(false); setConfirm(false)
    }
  }

  return (
    <div className="space-y-5">
      {app.editable && problems > 0 && (
        <div role="alert" className="rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm">
          <p className="font-semibold text-fg">{problems} item{problems === 1 ? '' : 's'} still need{problems === 1 ? 's' : ''} attention</p>
          <ul className="mt-1 list-disc pl-5 text-ink-100">
            {steps.filter((s) => s.kind !== 'review').map((s, i) => {
              const keys = s.kind === 'documents' ? defn.documents.map((d) => d.key) : defn.sections.find((x) => x.key === s.id)!.fields.map((f) => f.key)
              const n = keys.filter((k) => errors[k]).length
              return n ? <li key={s.id}><button className="cursor-pointer font-medium text-brand-600 underline" onClick={() => onEdit(i)}>{s.title}</button>: {n} to complete</li> : null
            })}
          </ul>
        </div>
      )}
      {defn.sections.map((s) => (
        <section key={s.key} className={card}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold">{s.title}</h2>
            {app.editable && <Button size="sm" variant="ghost" onClick={() => onEdit(steps.findIndex((x) => x.id === s.key))}><PencilLine className="h-3.5 w-3.5" /> Edit</Button>}
          </div>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {s.fields.map((f) => (
              <div key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : undefined}>
                <dt className="text-xs text-ink-500">{f.label}</dt>
                <dd className={cn('whitespace-pre-line break-words text-sm', errors[f.key] ? 'text-bad' : 'text-fg')}>{show(answers[f.key], f.type)}
                  {errors[f.key] && <span className="block text-xs">{errors[f.key]}</span>}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      {defn.documents.length > 0 && (
        <section className={card}>
          <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-semibold"><FileText className="h-5 w-5 text-brand-600" /> Documents</h2>
          <ul className="space-y-1 text-sm">
            {defn.documents.map((d) => {
              const n = docs.filter((x) => x.requirement_key === d.key).length
              return <li key={d.key} className={cn('flex items-center gap-2', errors[d.key] ? 'text-bad' : 'text-ink-100')}>
                {n ? <CheckCircle2 className="h-4 w-4 text-ok" /> : <AlertTriangle className="h-4 w-4" />} {d.label}: {n ? `${n} file(s)` : d.required ? 'missing' : 'not provided'}</li>
            })}
          </ul>
        </section>
      )}
      {app.editable && (
        <section className={`${card} space-y-4`} aria-labelledby="submit-title">
          <h2 id="submit-title" className="font-display text-lg font-semibold">Declaration{me!.consent ? ' and consent' : ''}</h2>
          {me!.consent && (
            <div className="space-y-2">
              <details className="rounded-xl border border-line bg-ink-950 p-3">
                <summary className="cursor-pointer text-sm font-medium text-fg">{me!.consent.title} (version {me!.consent.version})</summary>
                <PlainText text={me!.consent.body} className="mt-2 max-h-72 overflow-y-auto" />
              </details>
              <label className="flex items-start gap-3 text-sm text-ink-100">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={consented} onChange={(e) => setConsented(e.target.checked)} id="consent-check" />
                <span>I am the student's parent or guardian. I have read the privacy notice and consent to the school processing this application.</span>
              </label>
            </div>
          )}
          <label className="flex items-start gap-3 text-sm text-ink-100">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={declared} onChange={(e) => setDeclared(e.target.checked)} id="declaration-check" />
            <span>{defn.declaration}</span>
          </label>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <Button size="lg" onClick={() => setConfirm(true)} disabled={!declared || (!!me!.consent && !consented) || problems > 0 || busy} id="apply-submit">
            <Send className="h-5 w-5" /> {app.status === 'correction_requested' ? 'Submit the corrected application' : 'Submit application'}</Button>
        </section>
      )}
      {!app.editable && <p className="text-sm text-ink-500">This application has been submitted and can no longer be changed.</p>}
      <Dialog open={confirm} onClose={() => !busy && setConfirm(false)} title="Submit your application?"
        description={me!.form.has_test && app.status === 'draft'
          ? 'Your answers will be final. You will then take the admission test; your credentials stop working when the test is submitted.'
          : 'Your answers will be final and these one-time credentials will stop working. Note your reference number on the next screen.'}>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy} id="apply-submit-confirm">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit</Button>
        </div>
      </Dialog>
    </div>
  )
}
