import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CalendarClock, CheckCircle2, FileText, KeyRound, Loader2, LogIn, Search, ShieldCheck } from 'lucide-react'
import { PlainText } from '@/components/admission-forms/FormFields'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Label, PasswordInput } from '@/components/ui/field'
import { STATUS_TONE, fmtDate, fmtDateTime } from '@/lib/admissionForm'
import { errorMessage } from '@/services/apiClient'
import { applyService, type TrackResult } from '@/services/applyService'
import { useApply } from './context'

const card = 'rounded-2xl border border-line bg-ink-900 p-5 shadow-sm sm:p-6'

/** Landing + sign-in: what the application is, what to keep ready, and the applicant's one-time credentials. */
export function ApplyHome() {
  const { info, slug, base, onSignedIn, notice } = useApply()
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const f = info.form

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await applyService.login(slug, username.trim(), password)
      setPassword('')
      onSignedIn()
      nav(`${base}/dashboard`, { replace: true })
    } catch (err) { setError(errorMessage(err)); setBusy(false) }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <section className="space-y-5" aria-labelledby="apply-title">
        <div>
          <h1 id="apply-title" className="font-display text-3xl font-bold leading-tight sm:text-4xl">{f.title}</h1>
          {f.description && <p className="mt-2 text-ink-300">{f.description}</p>}
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {f.state === 'open' && <Badge tone="ok">Applications open</Badge>}
            {f.state === 'closed' && <Badge tone="bad">Applications closed</Badge>}
            {f.state === 'not_open' && <Badge tone="warn">Opens {fmtDate(f.opens_at)}</Badge>}
            {f.closes_at && f.state === 'open' && <Badge><CalendarClock className="h-3 w-3" /> Closes {fmtDateTime(f.closes_at)}</Badge>}
            {f.grades.length > 0 && <Badge>{f.grades.map((g) => g.label).join(', ')}</Badge>}
            {f.has_test && <Badge tone="aqua"><ShieldCheck className="h-3 w-3" /> Includes an online admission test</Badge>}
          </div>
        </div>
        {f.instructions && (
          <div className={card}>
            <h2 className="mb-2 font-display text-lg font-semibold">Before you begin</h2>
            <PlainText text={f.instructions} />
          </div>
        )}
        {f.documents.length > 0 && (
          <div className={card}>
            <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-semibold"><FileText className="h-5 w-5 text-brand-600" /> Documents to keep ready</h2>
            <ul className="space-y-1.5 text-sm">
              {f.documents.map((d) => <li key={d.label} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-brand-500" />{d.label}
                {!d.required && <span className="text-xs text-ink-500">(optional)</span>}</li>)}
            </ul>
          </div>
        )}
      </section>
      <section aria-labelledby="signin-title" className="order-first lg:order-none lg:sticky lg:top-24 lg:self-start">
        <form onSubmit={submit} className={`${card} space-y-4`} noValidate>
          <div>
            <h2 id="signin-title" className="flex items-center gap-2 font-display text-xl font-semibold"><KeyRound className="h-5 w-5 text-brand-600" /> Sign in</h2>
            <p className="mt-1 text-sm text-ink-300">Use the username and temporary password the school gave you.</p>
          </div>
          {notice && <p role="status" className="rounded-xl border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-ink-100">{notice}</p>}
          <div><Label htmlFor="ap-username">Username</Label>
            <Input id="ap-username" autoComplete="username" autoCapitalize="characters" spellCheck={false} required maxLength={40}
              value={username} onChange={(e) => setUsername(e.target.value)} /></div>
          <div><Label htmlFor="ap-password">Temporary password</Label>
            <PasswordInput id="ap-password" autoComplete="current-password" required maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <Button type="submit" className="w-full" size="lg" disabled={busy || !username.trim() || !password} id="apply-signin">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />} Sign in</Button>
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <Link to={`${base}/forgot`} className="font-medium text-brand-600 hover:underline">Forgot password?</Link>
            <Link to={`${base}/track`} className="font-medium text-brand-600 hover:underline">Track application</Link>
          </div>
          <p className="border-t border-line pt-3 text-xs text-ink-500">These credentials are for one application and stop working once it is submitted.
            Never share them; the school will never ask for your password.</p>
        </form>
      </section>
    </div>
  )
}

/** Forgot password / credentials: the request goes to the school, which reissues a one-time credential. */
export function ApplyRecovery() {
  const { slug, base } = useApply()
  const [username, setUsername] = useState('')
  const [contact, setContact] = useState('')
  const [message, setMessage] = useState('')
  const [website, setWebsite] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try { setDone((await applyService.recovery(slug, { username: username.trim(), contact: contact.trim(), message: message.trim() || undefined, website })).message) }
    catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  return (
    <div className="mx-auto max-w-lg">
      <form onSubmit={submit} className={`${card} space-y-4`} aria-labelledby="rec-title">
        <h1 id="rec-title" className="font-display text-2xl font-bold">Forgot your password?</h1>
        {done ? (
          <div role="status" className="space-y-3">
            <p className="flex items-start gap-2 rounded-xl border border-ok/30 bg-ok/10 p-3 text-sm text-ink-100"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" />{done}</p>
            <Link to={base} className="text-sm font-medium text-brand-600 hover:underline">Back to sign in</Link>
          </div>
        ) : (
          <>
            <p className="text-sm text-ink-300">Temporary passwords cannot be shown again. Tell the school your username and how to reach you: they will check your
              details and give you new one-time credentials. Your saved answers and documents are kept.</p>
            <div><Label htmlFor="rec-user">Username</Label>
              <Input id="rec-user" required maxLength={40} autoCapitalize="characters" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} /></div>
            <div><Label htmlFor="rec-contact">Email or mobile number of the parent / guardian</Label>
              <Input id="rec-contact" required maxLength={255} autoComplete="email" value={contact} onChange={(e) => setContact(e.target.value)} /></div>
            <div><Label htmlFor="rec-msg">Message (optional)</Label>
              <Input id="rec-msg" maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
            <div aria-hidden className="absolute -left-[9999px] h-0 overflow-hidden">
              <label htmlFor="rec-website">Website</label>
              <input id="rec-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>
            {error && <p role="alert" className="text-sm text-bad">{error}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={busy || username.trim().length < 3 || contact.trim().length < 5}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Send request</Button>
              <Link to={base} className="text-sm font-medium text-brand-600 hover:underline">Back to sign in</Link>
            </div>
          </>
        )}
      </form>
    </div>
  )
}

/** Public tracking after submission: reference number + date of birth → status only. */
export function ApplyTrack() {
  const { slug, base } = useApply()
  const [ref, setRef] = useState('')
  const [dob, setDob] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<TrackResult | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null); setResult(null)
    try { setResult(await applyService.track(slug, ref.trim().toUpperCase(), dob)) } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <form onSubmit={submit} className={`${card} space-y-4`} aria-labelledby="track-title">
        <h1 id="track-title" className="flex items-center gap-2 font-display text-2xl font-bold"><Search className="h-6 w-6 text-brand-600" /> Track your application</h1>
        <p className="text-sm text-ink-300">Enter the application reference number from your confirmation and the student's date of birth.</p>
        <div><Label htmlFor="tr-ref">Reference number</Label>
          <Input id="tr-ref" required placeholder="APP-XXXX-XXXX" maxLength={20} autoCapitalize="characters" spellCheck={false}
            value={ref} onChange={(e) => setRef(e.target.value)} className="font-mono uppercase" /></div>
        <div><Label htmlFor="tr-dob">Student's date of birth</Label>
          <Input id="tr-dob" type="date" required value={dob} onChange={(e) => setDob(e.target.value)} /></div>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy || ref.trim().length < 6 || !dob}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Check status</Button>
          <Link to={base} className="text-sm font-medium text-brand-600 hover:underline">Back</Link>
        </div>
      </form>
      {result && (
        <div role="status" className={`${card} space-y-2`}>
          <p className="font-mono text-sm text-ink-500">{result.reference_no}</p>
          <Badge tone={STATUS_TONE[result.status]} className="text-sm">{result.status_label}</Badge>
          <p className="text-xs text-ink-500">Submitted {fmtDateTime(result.submitted_at)} · last updated {fmtDateTime(result.updated_at)}</p>
        </div>
      )}
    </div>
  )
}
