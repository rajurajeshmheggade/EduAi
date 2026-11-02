import { useState, type FormEvent } from 'react'
import { CheckCircle2, Loader2, LogIn } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/field'
import { clearExamLock } from '@/lib/proctor/examLock'
import { examStore } from '@/lib/proctor/examApi'
import { errorMessage } from '@/services/apiClient'

const REASON: Record<string, string> = {
  MANUAL: 'Your answers have been submitted.',
  TIME_UP: 'Time is up. Your answers have been submitted.',
  AUTO_VIOLATION: 'The test was submitted automatically because the proctoring rules were broken too many times.',
  ENDED_BY_TEACHER: 'Your teacher ended the test. Your answers so far have been saved.',
}

/** End of the exam on this device: thank the candidate, then the teacher signs in again to get the portal back. */
export function HandBack({ reason, title = 'Thank you' }: { reason?: string | null; title?: string }) {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const u = await login(email.trim(), password)
      clearExamLock()
      examStore.clear()
      // Full reload: drops the exam route's state and its content-security policy.
      window.location.assign(u.role === 'teacher' ? '/teacher/admissions?tab=results' : u.home_route ?? '/')
    } catch (err) { setError(errorMessage(err)); setBusy(false) }
  }

  return (
    <main className="grid min-h-full place-items-center p-6" data-testid="hand-back">
      <div className="w-full max-w-md space-y-6 text-center">
        <div>
          <CheckCircle2 className="mx-auto mb-3 h-14 w-14 text-ok" />
          <h1 className="font-display text-3xl font-bold text-fg">{title}</h1>
          {reason && <p className="mt-2 text-ink-300">{REASON[reason] ?? reason}</p>}
          <p className="mt-3 text-lg font-medium text-fg">Please hand the device back to your teacher.</p>
        </div>
        <form onSubmit={submit} className="glass space-y-3 rounded-2xl p-5 text-left" aria-labelledby="handback-h">
          <h2 id="handback-h" className="flex items-center gap-2 font-display text-base font-semibold text-fg"><LogIn className="h-4 w-4" /> Teacher sign-in</h2>
          <p className="text-xs text-ink-500">The EduAI portal returns only after the teacher signs in with their own account.</p>
          <div><Label htmlFor="hb-email">Email</Label><Input id="hb-email" type="email" autoComplete="off" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><Label htmlFor="hb-password">Password</Label><Input id="hb-password" type="password" autoComplete="off" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy} id="handback-signin">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Sign in</Button>
        </form>
      </div>
    </main>
  )
}
