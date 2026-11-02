import { useCallback, useState } from 'react'
import { Ban, KeyRound, LifeBuoy, Loader2, Plus, RefreshCw, X } from 'lucide-react'
import { useCredentialPopup } from '@/components/admission-forms/useCredentialPopup'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label } from '@/components/ui/field'
import { ErrorState, SkeletonPage } from '@/components/ui/loading'
import { toast } from '@/components/ui/toast'
import { CREDENTIAL_LABEL, CREDENTIAL_TONE, STATUS_LABEL, STATUS_TONE, fmtDateTime } from '@/lib/admissionForm'
import { useAsync } from '@/lib/useAsync'
import { errorMessage } from '@/services/apiClient'
import { admissionFormService as svc, type CredentialRow } from '@/services/admissionFormService'

const REISSUABLE = ['draft', 'test_pending', 'correction_requested']

/** One-time credentials of a form: status of each (issued / in use / submitted · removed / revoked / expired),
 * acknowledgement, last sign-in; issue another, revoke, reissue (the recovery path). */
export function CredentialsPanel({ formId, org, canIssue }: { formId: string; org?: string | null; canIssue: boolean }) {
  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce((n) => n + 1), [])
  const { data, error, loading, retry } = useAsync(() => svc.credentials(formId, org), [formId, org, nonce])
  const { popup, show } = useCredentialPopup(org, reload)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [now] = useState(() => Date.now())

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id)
    try { await fn() } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(null) }
  }
  const issue = () => act('new', async () => { show(await svc.newCredential(formId, label.trim() || null, org)); setLabel('') })
  const revoke = (c: CredentialRow) => {
    if (!window.confirm(`Revoke ${c.username}? The applicant will be signed out and can no longer sign in with it.`)) return
    void act(c.credential_id, async () => { await svc.revoke(c.credential_id, org); toast('Credential revoked', 'success'); reload() })
  }
  const reissue = (c: CredentialRow) => {
    if (!window.confirm(`Reissue ${c.username}? It stops working at once; a new one-time credential is created for the same application.`)) return
    void act(c.credential_id, async () => show(await svc.reissue(c.credential_id, null, org)))
  }

  return (
    <div className="space-y-4">
      {canIssue && (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-5">
            <div className="min-w-[14rem] flex-1">
              <Label htmlFor="cred-label">Note for your records (optional)</Label>
              <Input id="cred-label" maxLength={120} placeholder="e.g. Given at the front office, 4 Nov" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <Button onClick={() => void issue()} disabled={busy === 'new'} id="issue-credential">
              {busy === 'new' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Issue a new applicant credential
            </Button>
            <p className="w-full text-xs text-ink-500">One credential per applicant. It works until the application is submitted (or the admission test, when one is linked), then it is removed.</p>
          </CardContent>
        </Card>
      )}
      {error ? <ErrorState message={error} onRetry={retry} /> : loading && !data ? <SkeletonPage variant="table" /> : (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[52rem] text-sm">
            <caption className="sr-only">Applicant credentials</caption>
            <thead className="bg-ink-800 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr><th className="px-3 py-2">Username</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Application</th>
                <th className="px-3 py-2">Issued</th><th className="px-3 py-2">Acknowledged</th><th className="px-3 py-2">Last sign-in</th>
                <th className="px-3 py-2">Expires</th><th className="px-3 py-2"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {(data ?? []).length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-ink-500">No credentials issued yet.</td></tr>}
              {(data ?? []).map((c) => (
                <tr key={c.credential_id} className="border-t border-line align-top">
                  <td className="px-3 py-2"><span className="font-mono text-xs">{c.username}</span>
                    {c.purpose !== 'new' && <div className="text-[11px] text-ink-500">{c.purpose === 'reissue' ? 'Reissued' : 'For corrections'}</div>}</td>
                  <td className="px-3 py-2"><Badge tone={CREDENTIAL_TONE[c.status]}>{CREDENTIAL_LABEL[c.status]}</Badge>
                    {c.locked_until && new Date(c.locked_until).getTime() > now && <div className="mt-1 text-[11px] text-bad">Locked after failed sign-ins</div>}</td>
                  <td className="px-3 py-2"><Badge tone={STATUS_TONE[c.application.status]}>{STATUS_LABEL[c.application.status]}</Badge>
                    <div className="mt-1 text-xs text-ink-300">{c.application.student_name ?? c.application.label ?? '—'}</div>
                    {c.application.reference_no && <div className="font-mono text-[11px] text-ink-500">{c.application.reference_no}</div>}</td>
                  <td className="px-3 py-2 text-xs text-ink-300">{fmtDateTime(c.issued_at)}<div className="text-ink-500">{c.issued_by_name ?? c.issued_by}</div></td>
                  <td className="px-3 py-2 text-xs text-ink-300">{c.acknowledged_at ? <>{fmtDateTime(c.acknowledged_at)}<div className="text-ink-500">
                    {c.acknowledged_by_name ?? c.acknowledged_by} · {c.acknowledged_items.join(', ')}</div></> : <span className="text-warn">Not acknowledged</span>}</td>
                  <td className="px-3 py-2 text-xs text-ink-300">{fmtDateTime(c.last_login_at)}</td>
                  <td className="px-3 py-2 text-xs text-ink-300">{c.revoked_at ? <span className="text-ink-500">Ended {fmtDateTime(c.revoked_at)}</span> : fmtDateTime(c.expires_at)}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      {(c.status === 'issued' || c.status === 'in_use') && (
                        <Button size="sm" variant="ghost" onClick={() => revoke(c)} disabled={busy === c.credential_id} aria-label={`Revoke ${c.username}`}>
                          <Ban className="h-3.5 w-3.5" /> Revoke</Button>
                      )}
                      {REISSUABLE.includes(c.application.status) && c.status !== 'submitted' && (
                        <Button size="sm" variant="secondary" onClick={() => reissue(c)} disabled={busy === c.credential_id} aria-label={`Reissue ${c.username}`}>
                          <RefreshCw className="h-3.5 w-3.5" /> Reissue</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {popup}
    </div>
  )
}

/** "Forgot password?" requests from the applicant login: resolve by reissuing a one-time credential, or dismiss. */
export function RecoveryPanel({ formId, org }: { formId?: string | null; org?: string | null }) {
  const [nonce, setNonce] = useState(0)
  const { data, error, loading, retry } = useAsync(() => svc.recovery(formId ?? null, 'open', org), [formId, org, nonce])
  const { popup, show } = useCredentialPopup(org, () => setNonce((n) => n + 1))
  const [busy, setBusy] = useState<string | null>(null)
  async function run(id: string, fn: () => Promise<void>) {
    setBusy(id)
    try { await fn() } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(null) }
  }
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><LifeBuoy className="h-5 w-5 text-brand-600" /> Credential recovery requests</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-ink-300">Applicants who used “Forgot password?”. Check the contact against your records before reissuing: the new credential
          is shown to you once and must be handed over through a channel you trust.</p>
        {error ? <ErrorState message={error} onRetry={retry} /> : loading && !data ? <SkeletonPage variant="table" /> : (data ?? []).length === 0
          ? <p className="text-sm text-ink-500">No open requests.</p> : (
            <ul className="space-y-2">
              {(data ?? []).map((r) => (
                <li key={r.request_id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-ink-900 p-3 text-sm">
                  <KeyRound className="h-4 w-4 text-ink-500" />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs text-fg">{r.username}</div>
                    <div className="text-xs text-ink-300">{r.contact} · {fmtDateTime(r.created_at)}{formId ? '' : ` · ${r.form_title}`}</div>
                    {r.message && <div className="mt-1 text-xs text-ink-500">“{r.message}”</div>}
                    <div className="mt-1 text-xs">{r.credential_id
                      ? <>Matches a credential ({r.credential_status ? r.credential_status.replace('_', ' ') : '—'}) · {r.student_name ?? r.label ?? 'application in progress'}</>
                      : <span className="text-warn">No credential with this username</span>}</div>
                  </div>
                  {r.can_reissue && (
                    <Button size="sm" onClick={() => void run(r.request_id, async () => show(await svc.reissue(r.credential_id!, r.request_id, org)))}
                      disabled={busy === r.request_id}><RefreshCw className="h-3.5 w-3.5" /> Reissue credential</Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={busy === r.request_id}
                    onClick={() => void run(r.request_id, async () => { await svc.dismissRecovery(r.request_id, org); setNonce((n) => n + 1) })}>
                    <X className="h-3.5 w-3.5" /> Dismiss</Button>
                </li>
              ))}
            </ul>
          )}
      </CardContent>
      {popup}
    </Card>
  )
}
