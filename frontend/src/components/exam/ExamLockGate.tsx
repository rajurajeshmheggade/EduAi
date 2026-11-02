import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Loader2, Lock, LogIn } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/field'
import { EXAM_LOCK_KEY, clearExamLock, examChannel, examLock } from '@/lib/proctor/examLock'
import { errorMessage } from '@/services/apiClient'

/**
 * While an admission exam runs on this device, every portal page is replaced by "Exam in progress" and the exam tab
 * is told (it records PORTAL_ACCESS_ATTEMPT). Only the exam route itself renders.
 *
 * The lock is meant to clear when the teacher signs back in on the exam tab itself (see HandBack). But that tab can
 * be closed, crash, or never reach hand-back (e.g. the exam was launched, then abandoned without being taken) — with
 * no recovery, every portal tab on that device would stay locked for up to 6 hours. The same teacher sign-in (not a
 * hidden bypass) is offered here too, so a stuck lock is never a dead end.
 */
export function ExamLockGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const { login } = useAuth()
  const [lock, setLock] = useState(examLock)
  useEffect(() => {
    const on = (e: StorageEvent) => { if (e.key === EXAM_LOCK_KEY || e.key === null) setLock(examLock()) }
    window.addEventListener('storage', on)
    return () => window.removeEventListener('storage', on)
  }, [])
  const blocked = !!lock && !pathname.startsWith('/admission/exam/')
  useEffect(() => {
    if (!blocked) return
    const c = examChannel(() => {})
    c.post({ type: 'portal-access', path: pathname })
    c.close()
  }, [blocked, pathname])
  if (!blocked) return children
  return <LockedScreen onUnlocked={() => setLock(null)} login={login} />
}

function LockedScreen({ onUnlocked, login }: { onUnlocked: () => void; login: (email: string, password: string) => Promise<unknown> }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function unlock(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await login(email.trim(), password)
      clearExamLock()  // same-tab writes don't fire the storage event other tabs rely on — update this tab directly
      onUnlocked()
    } catch (err) { setError(errorMessage(err)); setBusy(false) }
  }

  return (
    <main className="grid min-h-full place-items-center bg-ink-950 p-6 text-center" data-testid="exam-in-progress">
      <div className="w-full max-w-md space-y-6">
        <div>
          <Lock className="mx-auto mb-4 h-12 w-12 text-brand-600" />
          <h1 className="font-display text-2xl font-bold text-fg">Exam in progress on this device</h1>
          <p className="mt-2 text-sm text-ink-300">The EduAI portal is locked while an admission test runs in another tab. This attempt has been recorded.
            Please return to the exam tab.</p>
        </div>
        <form onSubmit={unlock} className="glass space-y-3 rounded-2xl p-5 text-left" aria-labelledby="unlock-h">
          <h2 id="unlock-h" className="flex items-center gap-2 font-display text-base font-semibold text-fg"><LogIn className="h-4 w-4" /> Exam tab gone or finished?</h2>
          <p className="text-xs text-ink-500">If the exam tab was closed, crashed, or the test already ended there, sign in with your teacher account to unlock this device.</p>
          <div><Label htmlFor="unlock-email">Email</Label><Input id="unlock-email" type="email" autoComplete="off" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><Label htmlFor="unlock-password">Password</Label><Input id="unlock-password" type="password" autoComplete="off" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy} id="unlock-signin">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Sign in and unlock</Button>
        </form>
      </div>
    </main>
  )
}
