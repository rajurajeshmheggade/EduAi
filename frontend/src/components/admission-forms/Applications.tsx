import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ClipboardCheck, Download, FileArchive, FileText, History, Loader2, MessageSquare, Search, ShieldCheck, Undo2, XCircle } from 'lucide-react'
import { useCredentialPopup } from '@/components/admission-forms/useCredentialPopup'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label, Select, Textarea } from '@/components/ui/field'
import { ErrorState, SkeletonPage } from '@/components/ui/loading'
import { toast } from '@/components/ui/toast'
import { CREDENTIAL_LABEL, CREDENTIAL_TONE, STATUS_LABEL, STATUS_TONE, fmtDate, fmtDateTime, fmtSize, type ApplicationStatus } from '@/lib/admissionForm'
import { useAsync } from '@/lib/useAsync'
import { errorMessage } from '@/services/apiClient'
import { admissionFormService as svc, type AdmissionForm, type ApplicationDetail as Detail, type Decision } from '@/services/admissionFormService'

const FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Submitted (all)' }, { value: 'submitted', label: 'New' }, { value: 'under_review', label: 'Under review' },
  { value: 'resubmitted', label: 'Resubmitted' }, { value: 'correction_requested', label: 'Corrections requested' },
  { value: 'test_pending', label: 'Awaiting admission test' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Not approved' },
  { value: 'draft', label: 'Drafts (in progress)' },
]

/** Review queue: filter by form and status, search by name or reference, open an application. */
export function ApplicationsQueue({ forms, org, onOpen, initialForm }: { forms: AdmissionForm[]; org?: string | null; onOpen: (id: string) => void; initialForm?: string | null }) {
  const [formId, setFormId] = useState(initialForm ?? '')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const { data, error, loading, retry } = useAsync((signal) => svc.applications({ form_id: formId || null, status: status || null }, org, signal), [formId, status, org])
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (data ?? []).filter((r) => !s || (r.student_name ?? '').toLowerCase().includes(s) || (r.reference_no ?? '').toLowerCase().includes(s)
      || (r.label ?? '').toLowerCase().includes(s))
  }, [data, q])
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div><Label htmlFor="aq-form">Form</Label>
          <Select id="aq-form" value={formId} onChange={(e) => setFormId(e.target.value)}>
            <option value="">All forms</option>{forms.map((f) => <option key={f.form_id} value={f.form_id}>{f.title}</option>)}</Select></div>
        <div><Label htmlFor="aq-status">Status</Label>
          <Select id="aq-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</Select></div>
        <div><Label htmlFor="aq-search">Search</Label>
          <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
            <Input id="aq-search" className="pl-9" placeholder="Name or reference" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      </div>
      {error ? <ErrorState message={error} onRetry={retry} /> : loading && !data ? <SkeletonPage variant="table" /> : (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[46rem] text-sm">
            <caption className="sr-only">Applications</caption>
            <thead className="bg-ink-800 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr><th className="px-3 py-2">Reference</th><th className="px-3 py-2">Student</th><th className="px-3 py-2">Class</th><th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Submitted</th><th className="px-3 py-2">Docs</th><th className="px-3 py-2">Test</th></tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-ink-500">No applications here yet.</td></tr>}
              {rows.map((r) => (
                <tr key={r.application_id} className="cursor-pointer border-t border-line hover:bg-ink-800/60" onClick={() => onOpen(r.application_id)}>
                  <td className="px-3 py-2 font-mono text-xs">
                    <button type="button" className="cursor-pointer text-brand-600 hover:underline" onClick={(e) => { e.stopPropagation(); onOpen(r.application_id) }}>
                      {r.reference_no ?? 'Draft'}</button></td>
                  <td className="px-3 py-2"><div className="font-medium text-fg">{r.student_name ?? '—'}</div>
                    <div className="text-xs text-ink-500">{forms.length > 1 ? r.form_title : r.label}</div></td>
                  <td className="px-3 py-2 text-ink-300">{r.grade_label || '—'}</td>
                  <td className="px-3 py-2"><Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge></td>
                  <td className="px-3 py-2 text-xs text-ink-300">{fmtDateTime(r.submitted_at)}</td>
                  <td className="px-3 py-2 text-ink-300">{r.documents}</td>
                  <td className="px-3 py-2 text-xs text-ink-300">{r.exam ? <>{r.exam.status === 'SUBMITTED' || r.exam.status === 'ENDED' ? r.exam.band ?? 'Scoring…' : 'In progress'}
                    <div className="text-ink-500">Integrity {r.exam.integrity_band}</div></> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const ACTION: Record<Decision, { label: string; icon: typeof CheckCircle2; variant: 'default' | 'secondary' | 'danger' | 'outline' }> = {
  start_review: { label: 'Start review', icon: ClipboardCheck, variant: 'secondary' },
  approve: { label: 'Approve', icon: CheckCircle2, variant: 'default' },
  reject: { label: 'Reject', icon: XCircle, variant: 'danger' },
  request_correction: { label: 'Request corrections', icon: Undo2, variant: 'outline' },
}

/** One application: answers by section, documents (signed, audited downloads), test result, decisions, timeline. */
export function ApplicationView({ applicationId, org, onBack, reportBase }: {
  applicationId: string; org?: string | null; onBack: () => void
  /** Where test reports open: undefined = the path the API suggests, null = no report link (role cannot open reports). */
  reportBase?: string | null
}) {
  const [nonce, setNonce] = useState(0)
  const { data, error, loading, retry } = useAsync(() => svc.application(applicationId, org), [applicationId, org, nonce])
  const [override, setOverride] = useState<Detail | null>(null)
  const d = override?.application_id === applicationId ? override : data
  const { popup, show } = useCredentialPopup(org)
  const [decision, setDecision] = useState<Decision | null>(null)
  const [note, setNote] = useState('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  if (error) return <ErrorState message={error} onRetry={retry} />
  if (!d || (loading && !data)) return <SkeletonPage variant="detail" />

  async function decide() {
    if (!decision || !d) return
    setBusy('decide')
    try {
      const r = await svc.decide(d.application_id, decision, note.trim() || null, org)
      setOverride(r.application); setDecision(null); setNote('')
      toast(`Application ${STATUS_LABEL[r.application.status].toLowerCase()}`, 'success')
      if (r.credential) show(r.credential)
    } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(null) }
  }
  async function open(kind: 'doc' | 'zip', id?: string) {
    setBusy(id ?? 'zip')
    try {
      const r = kind === 'zip' ? await svc.zipLink(d!.application_id, org) : await svc.documentLink(d!.application_id, id!, org)
      const a = document.createElement('a')
      a.href = r.url; a.rel = 'noopener'; a.download = ''
      document.body.appendChild(a); a.click(); a.remove()
    } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(null) }
  }
  async function addComment() {
    if (!comment.trim()) return
    setBusy('comment')
    try { await svc.comment(d!.application_id, comment.trim(), org); setComment(''); setOverride(null); setNonce((n) => n + 1) }
    catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(null) }
  }

  const answered = (k: string) => d.answers[k] !== undefined && d.answers[k] !== null && d.answers[k] !== ''
  const show_ = (v: unknown, type: string) => (type === 'checkbox' ? (v ? 'Yes' : 'No') : type === 'date' ? fmtDate(String(v))
    : type === 'grade' ? (d.grade_label || String(v)) : String(v))
  const examDone = d.exam && (d.exam.status === 'SUBMITTED' || d.exam.status === 'ENDED')
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Applications</Button>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl font-bold">{d.student_name ?? 'Application in progress'}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-500">
            <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
            {d.reference_no && <span className="font-mono">{d.reference_no}</span>}
            <span>{d.form_title}{d.version ? ` · v${d.version}` : ''}</span>
            {d.grade_label && <span>· {d.grade_label}</span>}
            {d.submitted_at && <span>· submitted {fmtDateTime(d.submitted_at)}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {d.actions.map((a) => {
            const A = ACTION[a]
            return <Button key={a} variant={A.variant} onClick={() => { setDecision(a); setNote('') }} id={`decide-${a}`}><A.icon className="h-4 w-4" /> {A.label}</Button>
          })}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          {d.status === 'draft' && <p className="rounded-2xl border border-line bg-ink-800 p-4 text-sm text-ink-300">The applicant is still filling in this application. Answers appear here once it is submitted.</p>}
          {d.status !== 'draft' && d.definition.sections.map((s) => (
            <Card key={s.key}>
              <CardHeader><CardTitle>{s.title}</CardTitle></CardHeader>
              <CardContent>
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {s.fields.map((f) => (
                    <div key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : undefined}>
                      <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">{f.label}</dt>
                      <dd className="mt-0.5 whitespace-pre-line break-words text-sm text-fg">{answered(f.key) ? show_(d.answers[f.key], f.type) : <span className="text-ink-500">—</span>}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          ))}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-brand-600" /> Documents</CardTitle>
              {d.documents.length > 1 && <Button size="sm" variant="secondary" onClick={() => void open('zip')} disabled={busy === 'zip'}>
                {busy === 'zip' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileArchive className="h-3.5 w-3.5" />} Download all (.zip)</Button>}
            </CardHeader>
            <CardContent>
              {d.documents.length === 0 ? <p className="text-sm text-ink-500">No documents uploaded.</p> : (
                <ul className="divide-y divide-line">
                  {d.documents.map((x) => (
                    <li key={x.document_id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                      <div className="min-w-0 flex-1"><div className="font-medium text-fg">{x.requirement_label}</div>
                        <div className="truncate text-xs text-ink-500">{x.filename} · {fmtSize(x.size_bytes)} · {fmtDateTime(x.uploaded_at)}</div>
                        <div className="font-mono text-[10px] text-ink-500" title="SHA-256 of the stored file">sha256 {x.sha256.slice(0, 16)}…</div></div>
                      <Button size="sm" variant="secondary" onClick={() => void open('doc', x.document_id)} disabled={busy === x.document_id}
                        aria-label={`Download ${x.requirement_label}`}>{busy === x.document_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Download</Button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-ink-500">Downloads use 5-minute signed links and are recorded in the audit log.</p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          {d.exam && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-brand-600" /> Admission test</CardTitle></CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <div className="font-medium text-fg">{d.exam.test_title}</div>
                <div className="text-ink-300">Status: {examDone ? 'Completed' : d.exam.status.replace('_', ' ').toLowerCase()}</div>
                {examDone && <div className="text-ink-300">Result: {d.exam.band ?? (d.exam.report_status === 'READY' ? '—' : 'being scored…')}
                  {d.exam.composite != null && ` · ${Math.round(d.exam.composite)} / 100`}</div>}
                <div className="text-ink-300">Integrity: {d.exam.integrity_band} ({d.exam.integrity_score}) · {d.exam.warnings_count} warning(s)</div>
                {d.exam.report_path && reportBase !== null && <Link className="inline-block pt-1 text-sm font-medium text-brand-600 hover:underline"
                  to={reportBase ? `${reportBase}/${d.exam.session_id}` : d.exam.report_path}>Open the report</Link>}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><History className="h-5 w-5 text-brand-600" /> Status history</CardTitle></CardHeader>
            <CardContent>
              <ol className="space-y-3 border-l border-line pl-4">
                {d.history.map((h, i) => (
                  <li key={i} className="relative text-sm">
                    <span className="absolute -left-[1.3rem] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-500" aria-hidden />
                    <div className="font-medium text-fg">{STATUS_LABEL[h.to_status as ApplicationStatus] ?? h.to_status}</div>
                    <div className="text-xs text-ink-500">{fmtDateTime(h.created_at)} · {h.actor_name}</div>
                    {h.note && <div className="mt-1 rounded-lg bg-ink-800 px-2 py-1 text-xs text-ink-300">{h.note}{h.visible_to_applicant && <span className="ml-1 text-ink-500">(shown to the applicant)</span>}</div>}
                  </li>
                ))}
                {d.history.length === 0 && <li className="text-sm text-ink-500">Not submitted yet.</li>}
              </ol>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5 text-brand-600" /> Reviewer comments</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {d.comments.map((c) => (
                <div key={c.comment_id} className="rounded-xl bg-ink-800 p-2.5 text-sm"><p className="whitespace-pre-line text-ink-100">{c.body}</p>
                  <p className="mt-1 text-xs text-ink-500">{c.author_name} · {fmtDateTime(c.created_at)}</p></div>
              ))}
              <Label htmlFor="ad-comment">Add a comment (staff only)</Label>
              <Textarea id="ad-comment" rows={2} maxLength={4000} value={comment} onChange={(e) => setComment(e.target.value)} />
              <Button size="sm" variant="secondary" onClick={() => void addComment()} disabled={!comment.trim() || busy === 'comment'}>Add comment</Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Credentials</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-2 text-xs">
                {d.credentials.map((c) => (
                  <li key={c.credential_id} className="flex flex-wrap items-center gap-2"><span className="font-mono">{c.username}</span>
                    <Badge tone={CREDENTIAL_TONE[c.status]}>{CREDENTIAL_LABEL[c.status]}</Badge><span className="text-ink-500">{fmtDate(c.issued_at)}</span></li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={!!decision} onClose={() => setDecision(null)} title={decision ? ACTION[decision].label : ''}
        description={decision === 'request_correction' ? 'The application reopens for editing and a fresh one-time credential is issued for the applicant. Your note is shown to them.'
          : decision === 'approve' || decision === 'reject' ? 'This is the final decision for this application.' : 'Mark the application as under review.'}>
        <div className="space-y-3">
          <Label htmlFor="decision-note">{decision === 'request_correction' ? 'What should the applicant correct?' : 'Note (staff only, optional)'}</Label>
          <Textarea id="decision-note" rows={4} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDecision(null)}>Cancel</Button>
            <Button onClick={() => void decide()} disabled={busy === 'decide' || (decision === 'request_correction' && note.trim().length < 5)} id="decision-confirm">
              {busy === 'decide' && <Loader2 className="h-4 w-4 animate-spin" />} Confirm</Button>
          </div>
        </div>
      </Dialog>
      {popup}
    </div>
  )
}
