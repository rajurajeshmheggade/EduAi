import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Eye, EyeOff, HelpCircle, Loader2, Lock, LogIn, ShieldCheck, Sparkles, User } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { EvaluationMock, TutorMock } from '@/components/landing/Mockups'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/field'
import { errorMessage } from '@/services/apiClient'
import { cn } from '@/lib/utils'

const HIGHLIGHTS = [
  'AI marks every answer with reasons — teachers approve',
  'Textbook tutor that cites the page for every answer',
  'Attendance, timetable, homework, tests in one login',
]

export default function Login() {
  const { login } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [caps, setCaps] = useState(false)
  const [help, setHelp] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const user = await login(email.trim(), password)
      const from = (loc.state as { from?: string } | null)?.from
      const area = `/${user.home_route.split('/')[1]}`
      nav(from && from.startsWith(area) ? from : user.home_route, { replace: true })
    } catch (err) {
      setError(errorMessage(err, 'Unable to sign in'))
    } finally {
      setBusy(false)
    }
  }

  const trackCaps = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.('CapsLock') ?? false)

  return (
    <div className="grid min-h-full lg:grid-cols-[1.05fr_1fr]">
      {/* ── Brand panel ── */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-brand-600 via-brand-500 to-aqua-500 p-10 text-white lg:flex lg:flex-col">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_24rem_at_0%_0%,hsl(0_0%_100%/0.18),transparent_60%),radial-gradient(30rem_20rem_at_100%_100%,hsl(0_0%_100%/0.12),transparent_60%)]" />
        <Link to="/" className="relative flex w-fit items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/15 ring-1 ring-white/30 backdrop-blur"><Sparkles className="h-5 w-5" /></span>
          <span className="font-display text-xl font-semibold">EduAI</span>
        </Link>
        <div className="relative mt-14 max-w-lg animate-fade-up">
          <h1 className="font-display text-4xl font-bold leading-tight text-white xl:text-5xl">Teach smarter.<br />Learn deeper.</h1>
          <p className="mt-4 text-base leading-relaxed text-white/80">One platform for schools, colleges and coaching centres — classroom operations and AI learning together.</p>
          <ul className="mt-7 space-y-3 text-sm">
            {HIGHLIGHTS.map((t) => <li key={t} className="flex items-center gap-3 text-white/90"><CheckCircle2 className="h-4 w-4 shrink-0" />{t}</li>)}
          </ul>
        </div>
        <div aria-hidden className="relative mt-auto h-64 xl:h-72">
          <EvaluationMock className="absolute bottom-0 left-0 w-[58%] -rotate-2" />
          <TutorMock className="absolute bottom-10 right-0 w-[52%] rotate-2" />
        </div>
      </aside>

      {/* ── Form ── */}
      <main className="flex flex-col px-4 py-8 sm:px-10">
        <div className="flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-ink-300 hover:text-fg"><ArrowLeft className="h-4 w-4" /> Home</Link>
          <Link to="/#demo" className="text-sm font-medium text-brand-600 hover:underline lg:hidden">Book a demo</Link>
        </div>

        <div className="mx-auto my-auto w-full max-w-md py-10">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-aqua-500 shadow-glow"><Sparkles className="h-5 w-5 text-white" /></span>
            <span className="font-display text-xl font-semibold text-fg">EduAI</span>
          </div>

          <form onSubmit={submit} className="animate-fade-up" aria-labelledby="login-title" noValidate={false}>
            <h2 id="login-title" className="font-display text-3xl font-bold">Welcome back</h2>
            <p className="mt-1.5 text-sm text-ink-300">Sign in to your institution’s workspace.</p>

            <div className="mt-8 space-y-5">
              <div>
                <Label htmlFor="email">Email, admission no. or username</Label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-ink-500" />
                  <Input id="email" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3}
                    className="h-11 pl-10" placeholder="you@school.edu" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <button type="button" onClick={() => setHelp(!help)} className="mb-1.5 cursor-pointer text-xs font-medium text-brand-600 hover:underline" aria-expanded={help}>Forgot password?</button>
                </div>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-ink-500" />
                  <Input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" required className="h-11 px-10"
                    placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyUp={trackCaps} onKeyDown={trackCaps} />
                  <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
                    className="absolute right-2 top-1.5 grid h-8 w-8 cursor-pointer place-items-center rounded-lg text-ink-500 hover:bg-ink-800 hover:text-fg">
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {caps && <p className="mt-1.5 text-xs text-warn" role="status">Caps Lock is on</p>}
              </div>
            </div>

            {help && (
              <div className="mt-4 flex gap-2.5 rounded-xl border border-brand-400/25 bg-brand-500/6 p-3 text-sm text-ink-100" role="note">
                <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                <span><b>Students:</b> ask your class teacher to reset your password. <b>Teachers:</b> ask your institution admin.
                  You’ll get a temporary password and be asked to set your own after signing in.</span>
              </div>
            )}

            {error && <p role="alert" className={cn('mt-4 rounded-xl border border-bad/30 bg-bad/10 px-3 py-2.5 text-sm text-bad')}>{error}</p>}

            <Button id="login-submit" type="submit" size="lg" className="mt-6 h-11 w-full" disabled={busy || !email.trim() || !password}>
              {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Signing in…</> : <><LogIn className="h-4 w-4" /> Sign in</>}
            </Button>

            <p className="mt-6 text-center text-xs text-ink-500">Students can sign in with their admission number.</p>
          </form>

          <div className="mt-10 rounded-xl border border-line bg-ink-900 p-4 text-sm">
            <p className="font-medium text-fg">New to EduAI?</p>
            <p className="mt-0.5 text-ink-300">Accounts are created by your institution. Want EduAI for your school or college?{' '}
              <Link to="/#demo" className="font-medium text-brand-600 hover:underline">Book a free demo</Link></p>
          </div>
        </div>

        <p className="flex items-center justify-center gap-1.5 text-xs text-ink-500"><ShieldCheck className="h-3.5 w-3.5" /> Secure sign-in · Your institution’s data stays separate</p>
      </main>
    </div>
  )
}
