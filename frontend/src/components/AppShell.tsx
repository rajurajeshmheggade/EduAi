import { Suspense, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ChevronsLeft, ChevronsRight, CalendarCheck, FlaskConical, CalendarClock, ClipboardCheck, ClipboardList, DoorOpen, FileSignature, HeartPulse, House, KanbanSquare, KeyRound, Library, LayoutDashboard, ListChecks, MessageSquareText, NotebookPen, PencilRuler, ScanEye, ScanText, School, Search, ShieldCheck, Sparkles, type LucideIcon } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ChangePasswordDialog, ProfileMenu } from '@/components/ProfileMenu'
import { CommandPalette, type Command } from '@/components/shell/CommandPalette'
import { CopilotDrawer } from '@/components/shell/CopilotDrawer'
import { NotificationBell } from '@/components/shell/NotificationBell'
import { RouteFallback } from '@/components/shell/RouteFallback'
import { TopProgress } from '@/components/shell/TopProgress'
import { Badge } from '@/components/ui/badge'
import { adminTabLink, adminTabsFor, type AdminTab } from '@/lib/adminTabs'
import { Toaster } from '@/components/ui/toast'
import { cn, roleLabel } from '@/lib/utils'
import { leadsService } from '@/services/leadsService'
import type { Role, UserProfile } from '@/types'

interface NavItem {
  to: string; label: string; icon: LucideIcon; section: string; soon?: boolean; needs?: (u: UserProfile) => boolean; tab?: AdminTab
  /** i18n key for parent / student-facing labels */
  tKey?: string
}

const NAV: Record<Role, NavItem[]> = {
  teacher: [
    { to: '/teacher/dashboard', section: 'Overview', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/teacher/timetable', section: 'Teaching', label: 'My timetable', icon: CalendarClock },
    { to: '/teacher/classes', section: 'Teaching', label: 'My classes', icon: School },
    { to: '/teacher/attendance', section: 'Teaching', label: 'Attendance', icon: CalendarCheck },
    { to: '/teacher/lesson-plans', section: 'Teaching', label: 'Lesson Plans', icon: NotebookPen },
    { to: '/teacher/homework', section: 'Teaching', label: 'Homework', icon: ClipboardList },
    { to: '/teacher/library', section: 'Teaching', label: 'Digital Library', icon: Library },
    { to: '/teacher/virtual-labs', section: 'Teaching', label: 'Virtual Labs', icon: FlaskConical },
    { to: '/teacher/tests', section: 'Assessments', label: 'Online tests', icon: PencilRuler, needs: (u) => !u.ai_modules || u.ai_modules.includes('ocr_evaluation') },
    { to: '/teacher/assignments', section: 'Assessments', label: 'Assignments', icon: ClipboardCheck, needs: (u) => !u.ai_modules || u.ai_modules.includes('ocr_evaluation') },
    { to: '/teacher/admissions', section: 'Assessments', label: 'Admissions', icon: DoorOpen },
    { to: '/teacher/admission-forms', section: 'Assessments', label: 'Admission forms', icon: FileSignature },
    { to: '/teacher/proctoring', section: 'Assessments', label: 'Live proctoring', icon: ScanEye },
    { to: '/teacher/evaluation', section: 'Assessments', label: 'AI Evaluation', icon: ScanText, needs: (u) => !u.ai_modules || u.ai_modules.includes('ocr_evaluation') },
    { to: '/teacher/wellbeing', section: 'Wellbeing', label: 'Wellbeing & Mindset', icon: HeartPulse },
  ],
  student: [
    { to: '/student/dashboard', section: 'Overview', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/student/timetable', section: 'Learning', label: 'Timetable', icon: CalendarClock },
    { to: '/student/classroom', section: 'Learning', label: 'AI Classroom', icon: MessageSquareText,
      needs: (u) => !u.ai_modules || u.ai_modules.some((m) => m === 'rag_chatbot' || m === 'ai_avatar_tutor') },
    { to: '/student/library', section: 'Learning', label: 'My Library', icon: Library },
    { to: '/student/virtual-labs', section: 'Learning', label: 'Virtual Labs', icon: FlaskConical },
    { to: '/student/homework', section: 'Learning', label: 'Homework', icon: ClipboardList },
    { to: '/student/attendance', section: 'Learning', label: 'My attendance', icon: CalendarCheck },
    { to: '/student/tests', section: 'Assessments', label: 'Tests', icon: PencilRuler, needs: (u) => !u.ai_modules || u.ai_modules.includes('ocr_evaluation') },
    { to: '/student/assignments', section: 'Assessments', label: 'Assignments', icon: ClipboardCheck, needs: (u) => !u.ai_modules || u.ai_modules.includes('ocr_evaluation') },
    { to: '/student/evaluations', section: 'Assessments', label: 'Exam results', icon: ScanText, needs: (u) => !u.ai_modules || u.ai_modules.includes('ocr_evaluation') },
    { to: '/student/wellness', section: 'Wellbeing', label: 'Wellness', icon: HeartPulse },
  ],
  // Pravesh (admissions)
  counsellor: [
    { to: '/admissions/counsellor', section: 'Admissions', label: 'Admissions home', icon: DoorOpen },
    { to: '/admissions/applications', section: 'Admissions', label: 'Applications', icon: FileSignature },
    { to: '/admissions/pipeline', section: 'Admissions', label: 'Pipeline', icon: KanbanSquare, soon: true },
    { to: '/admissions/visits', section: 'Admissions', label: 'Visits & interviews', icon: CalendarClock, soon: true },
  ],
  reviewer: [
    { to: '/admissions/reviewer', section: 'Integrity', label: 'Integrity desk', icon: ShieldCheck },
    { to: '/admissions/review-queue', section: 'Integrity', label: 'Review queue', icon: ListChecks, soon: true },
  ],
  parent: [{ to: '/parent', section: 'Parent', label: 'Home', icon: House, tKey: 'nav.home' }],
  // Admin consoles: one sidebar entry per console page (`/admin-dashboard?tab=…`).
  orgadmin: adminTabsFor(false).map((t) => ({ to: adminTabLink(t.id), section: t.section, label: t.label, icon: t.icon, tab: t.id })),
  superadmin: adminTabsFor(true).map((t) => ({ to: adminTabLink(t.id), section: t.section, label: t.label, icon: t.icon, tab: t.id })),
}

const YEAR = new Date().getFullYear()
const COPILOT_ROLES: Role[] = ['superadmin', 'orgadmin', 'teacher', 'counsellor', 'reviewer', 'student']

const COLLAPSE_KEY = 'eduai.sidebar.collapsed'
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false } }

const linkCls = ({ isActive }: { isActive: boolean }) =>
  cn(
    'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all',
    isActive ? 'bg-brand-500/10 font-medium text-brand-600 ring-1 ring-brand-400/25' : 'text-ink-300 hover:bg-ink-800 hover:text-fg',
  )

export function AppShell() {
  const { user } = useAuth()
  const { t } = useTranslation()
  const nav = useNavigate()
  const { pathname, search } = useLocation()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [copilotOpen, setCopilotOpen] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [newLeads, setNewLeads] = useState(0)
  const isSuper = user?.role === 'superadmin'
  const adminTab = pathname === '/admin-dashboard' ? new URLSearchParams(search).get('tab') ?? 'overview' : null
  const onLeads = adminTab === 'leads'
  useEffect(() => {
    if (isSuper) leadsService.list('NEW').then((d) => setNewLeads(d.counts.NEW ?? 0)).catch(() => {})
  }, [isSuper, onLeads])
  // Ctrl/⌘-K opens the command palette anywhere in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const commands = useMemo<Command[]>(() => {
    if (!user) return []
    const pages = NAV[user.role].filter((i) => !i.soon && (!i.needs || i.needs(user)))
      .map((i) => ({ id: i.to, label: i.tKey ? t(i.tKey) : i.label, hint: i.section, icon: i.icon, run: () => nav(i.to) }))
    return [...pages, { id: 'change-password', label: 'Change password', hint: 'Account', icon: KeyRound, run: () => setPwOpen(true) }]
  }, [user, t, nav])
  if (!user) return null
  const label = (i: NavItem) => (i.tKey ? t(i.tKey) : i.label)
  const copilot = COPILOT_ROLES.includes(user.role)
  const items = NAV[user.role].filter((i) => !i.needs || i.needs(user))
  const sections = [...new Set(items.map((i) => i.section))]
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1') } catch { /* storage unavailable */ } return !c })
  const isActive = (i: NavItem) => (i.tab ? adminTab === i.tab : pathname.startsWith(i.to))
  const badgeFor = (i: NavItem) => (i.tab === 'leads' && newLeads > 0 ? newLeads : 0)
  const initials = user.full_name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div className="flex h-full">
      <aside className={cn('hidden shrink-0 flex-col border-r border-line bg-ink-900 p-3 transition-[width] duration-200 md:flex print:hidden', collapsed ? 'w-[4.5rem]' : 'w-64')} aria-label="Primary">
        <div className={cn('mb-6 flex items-center gap-2.5 pt-1', collapsed ? 'justify-center' : 'px-2')}>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-aqua-500 shadow-glow">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          {!collapsed && (
            <div>
              <div className="font-display text-lg font-semibold leading-none text-fg">EduAI</div>
              <div className="mt-0.5 text-[11px] uppercase tracking-widest text-ink-500">Teach · Learn · Grow</div>
            </div>
          )}
        </div>

        <nav className="flex flex-1 flex-col gap-4 overflow-y-auto">
          {sections.map((sec) => (
            <div key={sec} className="flex flex-col gap-1">
              {collapsed ? <div className="mx-auto h-px w-6 bg-line" /> : sections.length > 1 && <div className="px-3 text-[10.5px] font-semibold uppercase tracking-widest text-ink-500">{sec}</div>}
              {items.filter((i) => i.section === sec).map((item) => { const { to, icon: Icon, soon } = item
                const text = label(item)
                return soon ? (
                  <div key={to} aria-disabled title={collapsed ? `${text} (soon)` : undefined} className={cn('flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink-500', collapsed && 'justify-center')}>
                    <Icon className="h-4.5 w-4.5 shrink-0" />{!collapsed && <><span className="flex-1">{text}</span><Badge className="!text-[10px]">Soon</Badge></>}
                  </div>
                ) : (
                  <Link key={to} to={to} title={collapsed ? text : undefined} aria-label={collapsed ? text : undefined}
                    aria-current={isActive(item) ? 'page' : undefined} className={cn(linkCls({ isActive: isActive(item) }), 'relative', collapsed && 'justify-center')}>
                    <Icon className="h-4.5 w-4.5 shrink-0 transition-transform group-hover:scale-110" />{!collapsed && <span className="flex-1">{text}</span>}
                    {badgeFor(item) > 0 && (collapsed
                      ? <span className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-warn" aria-label={`${badgeFor(item)} new`} />
                      : <span className="rounded-full bg-warn px-1.5 text-[10px] font-semibold leading-4 text-white">{badgeFor(item)}</span>)}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="mt-4 space-y-2 border-t border-line pt-3">
          {!collapsed && (
            <div className="flex items-center gap-2.5 rounded-xl bg-ink-800 p-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-aqua-500 text-xs font-semibold text-white">{initials}</span>
              <div className="min-w-0"><div className="truncate text-sm font-medium text-fg">{user.full_name}</div><div className="truncate text-xs text-ink-500">{roleLabel(user.role)}</div></div>
            </div>
          )}
          <button onClick={toggle} id="sidebar-toggle" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn('flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-xs text-ink-500 hover:bg-ink-800 hover:text-fg', collapsed && 'justify-center')}>
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Collapse</>}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative z-30 flex h-16 shrink-0 print:hidden items-center justify-between gap-4 border-b border-line bg-ink-900/80 px-4 backdrop-blur md:px-8">
          <div className="min-w-0 truncate text-sm text-ink-300">
            <span className="font-medium text-fg">{user.org_name ?? user.org_code}</span>
            {user.class_code && user.role === 'student' && <span className="ml-2 text-ink-500">· {user.class_code}</span>}
            {user.year_code && <span className="ml-2 hidden text-ink-500 sm:inline">· {user.year_code} {user.cycle_code}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPaletteOpen(true)} id="open-command-palette" aria-label="Search pages and actions (Ctrl+K)" aria-keyshortcuts="Control+K Meta+K"
              className="hidden h-9 cursor-pointer items-center gap-2 rounded-xl border border-line px-3 text-sm text-ink-500 transition-colors hover:border-line-strong hover:text-fg sm:inline-flex">
              <Search className="h-4 w-4" /><span>Search</span><kbd className="rounded border border-line px-1.5 text-[10px] text-ink-500">Ctrl K</kbd>
            </button>
            {copilot && (
              <button onClick={() => setCopilotOpen((o) => !o)} id="open-copilot" aria-expanded={copilotOpen} aria-label="Copilot"
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-brand-600 transition-colors hover:bg-brand-500/10">
                <Sparkles className="h-4 w-4" /><span className="hidden md:inline">Copilot</span>
              </button>
            )}
            <NotificationBell />
            <ProfileMenu />
          </div>
          <TopProgress />
        </header>
        <nav aria-label="Primary (mobile)" className="flex gap-1 overflow-x-auto border-b border-line bg-ink-900 px-2 py-1.5 md:hidden print:hidden">
          {items.filter((i) => !i.soon).map((item) => (
            <Link key={item.to} to={item.to} aria-current={isActive(item) ? 'page' : undefined}
              className={cn(linkCls({ isActive: isActive(item) }), 'shrink-0 py-1.5 text-xs')}><item.icon className="h-4 w-4" />{label(item)}</Link>
          ))}
        </nav>
        {user.must_change_password && (
          <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-warn/30 bg-warn/10 px-4 py-2 text-sm text-warn md:px-8">
            <KeyRound className="h-4 w-4 shrink-0" />
            <span className="flex-1">You are signed in with a default or temporary password. Set your own password to secure your account.</span>
            <button onClick={() => setPwOpen(true)} id="banner-change-password" className="cursor-pointer rounded-lg bg-warn px-3 py-1 text-xs font-semibold text-white hover:brightness-110">Change password</button>
          </div>
        )}
        {/* Pages load inside the shell: the sidebar and header stay while a page's code downloads. */}
        <main className="min-h-0 flex-1 overflow-y-auto"><ErrorBoundary key={pathname}><Suspense fallback={<RouteFallback />}><Outlet /></Suspense></ErrorBoundary></main>
        <footer className="flex shrink-0 flex-wrap print:hidden items-center justify-between gap-x-4 gap-y-1 border-t border-line bg-ink-900 px-4 py-2.5 text-xs text-ink-500 md:px-8">
          <span>© {YEAR} EduAI Platform · Teach · Learn · Grow</span>
          <span className="truncate">{user.org_name ?? user.org_code} · Signed in as {user.full_name} ({roleLabel(user.role)})</span>
        </footer>
      </div>
      <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
      {copilot && <CopilotDrawer open={copilotOpen} onClose={() => setCopilotOpen(false)} />}
      <Toaster />
    </div>
  )
}
