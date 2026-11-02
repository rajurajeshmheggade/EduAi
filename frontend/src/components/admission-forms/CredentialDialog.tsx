import { useState } from 'react'
import { Check, CheckCircle2, Copy, KeyRound, Loader2, ShieldCheck, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ACK_MESSAGE, fmtDateTime as formatDateTime } from '@/lib/admissionForm'
import { applicationUrl, type IssuedCredential } from '@/services/admissionFormService'
import { errorMessage } from '@/services/apiClient'
import { copyText } from '@/lib/clipboard'

type Item = 'username' | 'password' | 'all'

function credentialText(c: IssuedCredential): string {
  return [`Application: ${c.application_name}`, `School: ${c.school_name}`, `Application URL: ${applicationUrl(c.application_path)}`,
    `Username: ${c.username}`, `Temporary password: ${c.password}`, `Valid until: ${formatDateTime(c.expires_at)}`,
    'These credentials work for one application only and stop working once it is submitted.'].join('\n')
}

const PURPOSE: Record<IssuedCredential['purpose'], string> = {
  new: 'A one-time credential for one applicant.',
  reissue: 'A replacement one-time credential: the previous one no longer works. Saved answers and documents are kept.',
  correction: 'A one-time credential for the corrections the school requested. It stops working when the corrected application is submitted.',
}

/**
 * The credentials pop-up shown after publishing a form or issuing / reissuing an applicant credential. The temporary
 * password exists only here (the server keeps a bcrypt hash). After copying, the issuer acknowledges; the server records
 * who, when, from where and which items were copied, and the fixed acknowledgement message is shown.
 */
export function CredentialDialog({ credential, onClose, onAcknowledge }: {
  credential: IssuedCredential | null
  onClose: () => void
  onAcknowledge: (copied: Item[]) => Promise<{ message?: string }>
}) {
  if (!credential) return null
  return <Popup key={credential.credential_id} c={credential} onClose={onClose} onAcknowledge={onAcknowledge} />
}

function Popup({ c, onClose, onAcknowledge }: { c: IssuedCredential; onClose: () => void; onAcknowledge: (copied: Item[]) => Promise<{ message?: string }> }) {
  const [copied, setCopied] = useState<Item[]>([])
  const [flash, setFlash] = useState<Item | null>(null)
  const [copyError, setCopyError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ack, setAck] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  // Esc / the close button before acknowledging: keep the pop-up (re-shown) and ask once more — the password is
  // shown only here.
  const [shown, setShown] = useState(0)
  const attemptClose = () => { if (ack) onClose(); else { setConfirmClose(true); setShown((n) => n + 1) } }
  const url = applicationUrl(c.application_path)

  async function copy(item: Item) {
    const text = item === 'username' ? c.username : item === 'password' ? c.password : credentialText(c)
    const ok = await copyText(text)
    setCopyError(!ok)
    if (!ok) return
    setCopied((xs) => (xs.includes(item) ? xs : [...xs, item]))
    setFlash(item)
    window.setTimeout(() => setFlash((f) => (f === item ? null : f)), 1500)
  }

  async function acknowledge() {
    setBusy(true); setError(null)
    try {
      await onAcknowledge(copied)
      setAck(ACK_MESSAGE)
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  const row = (label: string, value: string, item: Item | null, mono = true, id?: string) => (
    <div className="flex flex-wrap items-center gap-2 border-b border-line py-2.5 last:border-0">
      <dt className="w-full text-[11px] font-semibold uppercase tracking-wide text-ink-500 sm:w-36">{label}</dt>
      <dd id={id} className={`min-w-0 flex-1 break-all text-sm text-fg ${mono ? 'font-mono' : ''}`}>{value}</dd>
      {item && (
        <Button size="sm" variant="secondary" onClick={() => void copy(item)} id={`copy-${item}`}>
          {flash === item ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}
          {flash === item ? 'Copied' : item === 'username' ? 'Copy Username' : 'Copy Password'}
        </Button>
      )}
    </div>
  )

  return (
    <Dialog key={shown} open onClose={attemptClose} title="Admission application credentials" className="w-[min(36rem,calc(100vw-2rem))]"
      description={PURPOSE[c.purpose]}>
    <div className="space-y-4" data-testid="credential-dialog">
      <div className="flex items-start gap-3 rounded-xl border border-warn/30 bg-warn/10 p-3 text-sm text-ink-100">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
        <p>The temporary password is shown <b>only now</b>. Copy it and hand it to the applicant securely; the school cannot see it again.</p>
      </div>
      <dl className="rounded-xl border border-line bg-ink-800/60 px-4">
        {row('Application name', c.application_name, null, false)}
        {row('Application URL', url, null, true, 'credential-url')}
        {row('Username', c.username, 'username', true, 'credential-username')}
        {row('Temporary password', c.password, 'password', true, 'credential-password')}
        {row('Valid until', formatDateTime(c.expires_at), null, false)}
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => void copy('all')} id="copy-all">
          {flash === 'all' ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />} {flash === 'all' ? 'Copied' : 'Copy All'}
        </Button>
        {copyError && <span role="alert" className="text-xs text-bad">Copying is blocked by the browser — select the text and copy it manually.</span>}
      </div>
      {ack ? (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-ok/30 bg-ok/10 p-3 text-sm font-medium text-ok" data-testid="ack-message">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>{ack}</span>
        </div>
      ) : (
        <p className="text-xs text-ink-500">{copied.length ? 'Copied. Confirm that you have saved the credentials securely.' : 'Copy the credentials, then acknowledge.'}</p>
      )}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      {confirmClose && !ack && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-bad/30 bg-bad/5 p-3 text-sm">
          <TriangleAlert className="h-4 w-4 text-bad" />
          <span className="flex-1 text-ink-100">The password will not be shown again. Close without acknowledging?</span>
          <Button size="sm" variant="danger" onClick={onClose}>Close anyway</Button>
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        {ack ? <Button onClick={onClose} id="credential-done">Done</Button> : (
          <Button onClick={() => void acknowledge()} disabled={!copied.length || busy} id="credential-acknowledge">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Acknowledge
          </Button>
        )}
      </div>
    </div>
    </Dialog>
  )
}
