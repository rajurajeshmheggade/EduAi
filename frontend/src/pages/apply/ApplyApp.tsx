import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { GraduationCap, LayoutDashboard, LogIn, LogOut, Menu, Search, ShieldCheck, SquarePen, X } from 'lucide-react'
import { ErrorState, PageLoader } from '@/components/ui/loading'
import { Toaster } from '@/components/ui/toast'
import { accentVars } from '@/lib/admissionForm'
import { useAsync } from '@/lib/useAsync'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/services/apiClient'
import { APPLY_LOGOUT_EVENT, applyService, applyStore, type Me } from '@/services/applyService'
import { ApplyContext, useApply, type ApplyCtx } from './context'
import { ApplyHome, ApplyRecovery, ApplyTrack } from './ApplyAuth'
import ApplyDashboard from './ApplyDashboard'
import ApplyDone from './ApplyDone'
import ApplyForm from './ApplyForm'
import ApplyTest from './ApplyTest'

const YEAR = new Date().getFullYear()

/**
 * The standalone admission application at /apply/:slug — no LMS shell, no LMS session: its own branded header,
 * navigation, login, dashboard and footer, its own API client and token storage. It talks to the same backend, so
 * submissions land in the school's admissions records.
 */
export default function ApplyApp() {
  const { slug = '' } = useParams()
  const valid = /^[a-z0-9][a-z0-9-]{5,79}$/.test(slug)
  const info = useAsync((signal) => (valid ? applyService.info(slug, signal) : Promise.reject(new Error('This admission application was not found'))), [slug])

  useEffect(() => {
    const robots = document.createElement('meta')
    robots.name = 'robots'; robots.content = 'noindex'
    const referrer = document.createElement('meta')
    referrer.name = 'referrer'; referrer.content = 'no-referrer'
    document.head.append(robots, referrer)
    return () => { robots.remove(); referrer.remove() }
  }, [])
  useEffect(() => {
    if (info.data) document.title = `${info.data.form.title} · ${info.data.school.name}`
  }, [info.data])

  if (info.error) {
    return (
      <div className="grid min-h-full place-items-center bg-ink-950 p-6">
        <div className="w-full max-w-md space-y-3 text-center">
          <GraduationCap className="mx-auto h-12 w-12 text-ink-500" />
          <h1 className="font-display text-2xl font-bold">Admission application not found</h1>
          <p className="text-sm text-ink-300">Check the link the school gave you. {info.error.includes('not found') ? '' : info.error}</p>
          <button className="cursor-pointer text-sm font-medium text-brand-600 hover:underline" onClick={info.retry}>Try again</button>
        </div>
      </div>
    )
  }
  if (!info.data) return <PageLoader message="Opening the admission application…" className="min-h-full" />
  return <Shell slug={slug} info={info.data} />
}

function Shell({ slug, info }: { slug: string; info: NonNullable<ApplyCtx['info']> }) {
  const nav = useNavigate()
  const base = `/apply/${slug}`
  const [signedIn, setSignedIn] = useState(() => !!applyStore.access(slug))
  const [me, setMe] = useState<Me | null>(null)
  const [meError, setMeError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const reloadMe = useCallback(async () => {
    try {
      const m = await applyService.me(slug)
      setMe(m); setMeError(null)
      return m
    } catch (e) {
      if (!applyStore.access(slug)) { setSignedIn(false); setMe(null) } else setMeError(errorMessage(e))
      return null
    }
  }, [slug])

  useEffect(() => { if (signedIn) queueMicrotask(() => void reloadMe()) }, [signedIn, reloadMe])
  useEffect(() => {
    const on = () => { setSignedIn(false); setMe(null); setNotice('Your session has ended. Please sign in again.'); nav(base, { replace: true }) }
    window.addEventListener(APPLY_LOGOUT_EVENT, on)
    return () => window.removeEventListener(APPLY_LOGOUT_EVENT, on)
  }, [nav, base])

  const ctx = useMemo<ApplyCtx>(() => ({
    slug, info, me, meError, signedIn, reloadMe, setMe, notice, base,
    onSignedIn: () => { setNotice(null); setSignedIn(true) },
    forget: () => { applyStore.clear(); setSignedIn(false); setMe(null) },
    signOut: async (message?: string) => {
      await applyService.logout(slug).catch(() => {})
      setSignedIn(false); setMe(null); setNotice(message ?? null)
      nav(base, { replace: true })
    },
  }), [slug, info, me, meError, signedIn, reloadMe, notice, base, nav])

  return (
    <ApplyContext.Provider value={ctx}>
      <div lang="en" className="flex min-h-full flex-col bg-ink-950" style={accentVars(info.school.accent)}>
        <Header />
        <main id="apply-main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 md:py-10">
          <Routes>
            <Route index element={signedIn ? <Navigate to="dashboard" replace /> : <ApplyHome />} />
            <Route path="forgot" element={<ApplyRecovery />} />
            <Route path="track" element={<ApplyTrack />} />
            <Route path="submitted" element={<ApplyDone />} />
            <Route path="dashboard" element={<Private><ApplyDashboard /></Private>} />
            <Route path="form" element={<Private><ApplyForm /></Private>} />
            <Route path="test" element={<Private><ApplyTest /></Private>} />
            <Route path="*" element={<Navigate to={base} replace />} />
          </Routes>
        </main>
        <Footer />
        <Toaster />
      </div>
    </ApplyContext.Provider>
  )
}

function Private({ children }: { children: ReactNode }) {
  const { signedIn, me, meError, reloadMe, base } = useApply()
  if (!signedIn) return <Navigate to={base} replace />
  if (meError && !me) return <ErrorState message={meError} onRetry={() => void reloadMe()} />
  if (!me) return <PageLoader message="Loading your application…" />
  return children
}

function Header() {
  const { info, signedIn, signOut, base, me } = useApply()
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => { queueMicrotask(() => setOpen(false)) }, [pathname])
  const links = signedIn
    ? [{ to: `${base}/dashboard`, label: 'Dashboard', icon: LayoutDashboard }, { to: `${base}/form`, label: me?.application.editable === false ? 'My application' : 'Application form', icon: SquarePen },
      ...(me?.test ? [{ to: `${base}/test`, label: 'Admission test', icon: ShieldCheck }] : [])]
    : [{ to: base, label: 'Sign in', icon: LogIn }, { to: `${base}/track`, label: 'Track application', icon: Search }]
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-brand-600 text-white shadow-sm print:static">
      <a href="#apply-main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded focus:bg-white focus:px-3 focus:py-1 focus:text-fg">Skip to content</a>
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
        <Link to={base} className="flex min-w-0 flex-1 items-center gap-3" aria-label={`${info.school.name} admissions home`}>
          {info.school.logo_url
            ? <img src={info.school.logo_url} alt="" className="h-10 w-10 shrink-0 rounded-xl bg-white object-contain p-1" />
            : <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/15"><GraduationCap className="h-6 w-6" /></span>}
          <span className="min-w-0">
            <span className="block truncate font-display text-base font-semibold leading-tight">{info.school.name}</span>
            <span className="block truncate text-xs text-white/80">{info.form.title}{info.form.academic_year ? ` · ${info.form.academic_year}` : ''}</span>
          </span>
        </Link>
        <nav aria-label="Admission application" className="hidden items-center gap-1 md:flex print:hidden">
          {links.map((l) => <NavLink key={l.to} to={l.to} end className={({ isActive }) => cn('rounded-lg px-3 py-2 text-sm font-medium text-white/85 hover:bg-white/10 hover:text-white', isActive && 'bg-white/15 text-white')}>{l.label}</NavLink>)}
          {signedIn && <button onClick={() => void signOut()} className="ml-1 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/30 px-3 py-1.5 text-sm hover:bg-white/10"><LogOut className="h-4 w-4" /> Sign out</button>}
        </nav>
        <button className="grid h-10 w-10 cursor-pointer place-items-center rounded-lg hover:bg-white/10 md:hidden print:hidden" aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open} aria-controls="apply-mobile-nav" onClick={() => setOpen((o) => !o)}>{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
      </div>
      {open && (
        <nav id="apply-mobile-nav" aria-label="Admission application" className="border-t border-white/10 px-4 pb-3 md:hidden">
          {links.map((l) => <NavLink key={l.to} to={l.to} end className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm hover:bg-white/10"><l.icon className="h-4 w-4" />{l.label}</NavLink>)}
          {signedIn && <button onClick={() => void signOut()} className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm hover:bg-white/10"><LogOut className="h-4 w-4" /> Sign out</button>}
        </nav>
      )}
    </header>
  )
}

function Footer() {
  const { info } = useApply()
  return (
    <footer className="border-t border-line bg-ink-900 print:hidden">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-ink-500 sm:px-6">
        <span>© {YEAR} {info.school.name} · Admissions</span>
        <span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Your details are used only for this admission and are protected under the school's privacy notice.</span>
      </div>
    </footer>
  )
}
