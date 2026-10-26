import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import {
  ArrowRight, BookOpenCheck, Brain, Building2, CalendarCheck, CalendarClock, Check, CheckCircle2, ChevronDown, ClipboardCheck,
  ClipboardList, FileSpreadsheet, GraduationCap, KeyRound, Layers, Lock, Mail, Menu, MessageSquareText, MonitorCheck,
  Phone, PencilRuler, RefreshCw, ScanText, School, ShieldCheck, Smartphone, Sparkles, Upload, UserCog, Users, X,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { FullPageSpinner } from '@/auth/RequireRole'
import { DemoForm } from '@/components/landing/DemoForm'
import {
  AttendanceMock, EvaluationMock, HeroCollage, LessonPlanMock, RegisterMock, TestRunnerMock, TimetableMock, TutorMock, UploadMock,
} from '@/components/landing/Mockups'
import { Reveal } from '@/components/landing/Reveal'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const SALES_EMAIL = import.meta.env.VITE_SALES_EMAIL as string | undefined
const SALES_PHONE = import.meta.env.VITE_SALES_PHONE as string | undefined
const YEAR = new Date().getFullYear()

const NAV = [['#modules', 'Modules'], ['#ai', 'AI suite'], ['#day', 'A day with EduAI'], ['#roles', 'For your team'], ['#faq', 'FAQ']] as const

const MODULES = [
  { icon: CalendarCheck, title: 'Attendance', body: 'Period-wise roll call in seconds, monthly registers, below-75% alerts and CSV export.', tags: ['Period-wise', 'Defaulter alerts'] },
  { icon: CalendarClock, title: 'Timetable', body: 'Weekly class timetables with automatic teacher clash detection and today’s schedule for everyone.', tags: ['No double-booking', 'Substitutes'] },
  { icon: ClipboardList, title: 'Homework', body: 'Post homework with worksheets; students hand in notes, photos or PDFs; teachers review with remarks.', tags: ['Photo / PDF', 'Review'] },
  { icon: PencilRuler, title: 'Online tests', body: 'Timed tests with MCQ, short and descriptive questions, autosave and auto-submit — marked instantly.', tags: ['Timer', 'Instant results'] },
  { icon: ClipboardCheck, title: 'Assignments', body: 'Students upload handwritten answers as a PDF; AI reads each question and marks it.', tags: ['Handwriting OCR', 'Late tracking'] },
  { icon: ScanText, title: 'AI exam evaluation', body: 'Upload a folder of scanned scripts — every answer marked against your model answer with reasons.', tags: ['Folder upload', 'Teacher override'] },
  { icon: MessageSquareText, title: 'AI tutor', body: 'Students ask doubts by text or voice; answers come only from your textbook, with page citations.', tags: ['Cited answers', 'Voice'] },
  { icon: BookOpenCheck, title: 'Lesson planner', body: '“How to teach” guides per chapter: pacing, analogies, board work, misconceptions and check questions.', tags: ['30–90 min', 'PDF export'] },
] as const

const SHARED = [
  { icon: UserCog, title: 'Role-based dashboards', body: 'Admin, teacher and student each see exactly what they need.' },
  { icon: FileSpreadsheet, title: 'CSV import & export', body: 'Bulk-enrol students; export registers and score sheets.' },
  { icon: Smartphone, title: 'Works on any device', body: 'Responsive web app for desktop, tablet and phone.' },
  { icon: Building2, title: 'Multi-institution', body: 'One platform for many schools, each with its own data.' },
]

const CYCLE = [
  { icon: BookOpenCheck, step: 'Plan', body: 'Teachers upload the textbook and get a chapter-wise “how to teach” guide.' },
  { icon: MessageSquareText, step: 'Learn', body: 'Students study the chapter and clear doubts with the cited AI tutor.' },
  { icon: PencilRuler, step: 'Practise', body: 'Homework and timed online tests check understanding every week.' },
  { icon: ScanText, step: 'Evaluate', body: 'AI marks answers SL.No by SL.No with reasons and missing points.' },
  { icon: RefreshCw, step: 'Improve', body: 'Feedback and class analytics show exactly what to revise next.' },
]

const DAY = [
  { time: '08:50', title: 'Attendance in 30 seconds', body: 'The class teacher opens today’s first period, taps “All present”, marks two exceptions and saves. Parents of absentees can be followed up the same morning.', mock: AttendanceMock },
  { time: '09:30', title: 'Everyone knows where to be', body: 'Teachers and students see today’s periods, rooms and subjects. The admin can’t accidentally book one teacher in two classes.', mock: TimetableMock },
  { time: '10:15', title: 'A lesson plan in a minute', body: 'Before Physics, the teacher generates a 45-minute plan for Chapter 2 with a hook, board work and the misconception to watch for.', mock: LessonPlanMock },
  { time: '13:40', title: 'Doubts answered from the textbook', body: 'A student asks why passengers lurch forward. The tutor answers from the class textbook and points to page 14.', mock: TutorMock },
  { time: '15:00', title: 'Test marked before the bell', body: 'The weekly online test closes. MCQs are marked instantly; written answers get marks, reasons and feedback within minutes.', mock: TestRunnerMock },
  { time: '17:30', title: 'Assignments, read and marked', body: 'Students upload photos of their notebook as a PDF. The AI reads the handwriting, question by question, and marks it.', mock: UploadMock },
  { time: '18:15', title: 'One register for the principal', body: 'The principal opens the score register: ranks, grades and who hasn’t submitted — for any class, subject and test.', mock: RegisterMock },
]

const ROLES = [
  { id: 'admin', icon: Building2, label: 'Principals & admins', before: ['Attendance registers collected by hand', 'Timetable clashes found on the day', 'No single view of test results'], after: ['Institution-wide attendance and defaulters, live', 'Timetable builder that blocks clashes', 'Score register for every class, subject and test'] },
  { id: 'teacher', icon: GraduationCap, label: 'Teachers', before: ['Evenings spent marking scripts', 'Lesson plans written from scratch', 'Same doubts answered again and again'], after: ['AI marks every answer with reasons — you approve or edit', 'Chapter-wise “how to teach” guides in a minute', 'A cited AI tutor answers routine doubts'] },
  { id: 'student', icon: Users, label: 'Students', before: ['Wait days for marks with no explanation', 'Doubts after school go unanswered', 'No idea where attendance stands'], after: ['Marks with why, what was missing and how to improve', 'Ask the textbook tutor anytime, by text or voice', 'Subject-wise monthly attendance and timetable'] },
  { id: 'owner', icon: ShieldCheck, label: 'Owners & groups', before: ['Separate tools for each campus', 'Paying for features nobody uses', 'Data spread across spreadsheets'], after: ['Every campus on one platform, data kept separate', 'Switch AI modules on per institution', 'Plan limits, admins and suspension in one place'] },
]

const STEPS = [
  { title: 'Set up your institution', body: 'We create your institution and the first admin account in minutes.' },
  { title: 'Add teachers & classes', body: 'Admins add teachers, classes, subjects and the weekly timetable.' },
  { title: 'Enrol students', body: 'Class teachers add students one by one or import a CSV.' },
  { title: 'Start teaching with AI', body: 'Upload textbooks, assign tests and let the AI do the marking.' },
]

const TRUST = [
  { icon: Building2, title: 'Separate data per institution', body: 'Every school’s users, classes and results are isolated from every other school.' },
  { icon: UserCog, title: 'Strict role-based access', body: 'Admins, teachers and students reach only the screens and records their role allows.' },
  { icon: KeyRound, title: 'Secure sign-in', body: 'Hashed passwords, expiring session tokens and forced change of temporary passwords.' },
  { icon: Lock, title: 'Private file links', body: 'Scripts and textbooks are served through short-lived signed links, never public URLs.' },
  { icon: Brain, title: 'AI that stays on your content', body: 'The tutor answers only from textbooks your teachers publish — and says so when it can’t.' },
  { icon: Check, title: 'Teacher always has the final say', body: 'Every AI mark can be reviewed and changed; the original AI mark is kept for audit.' },
]

const COMPARE: [string, string, string, string][] = [
  ['Attendance & monthly registers', 'Paper registers', 'Separate app', 'Built in'],
  ['Timetable with clash checks', 'Manual charts', 'Sometimes', 'Built in'],
  ['Online tests & assignments', '—', 'Separate LMS', 'Built in'],
  ['AI marking of handwritten answers', '—', '—', 'Built in'],
  ['Textbook-grounded AI tutor', '—', 'Generic chatbots', 'Built in'],
  ['One score register for admins', 'Spreadsheets', 'Exports from many tools', 'Built in'],
]

const FAQ: { group: string; items: [string, string][] }[] = [
  { group: 'Getting started', items: [
    ['Who is EduAI for?', 'Schools (K–12), colleges and universities, and coaching centres. Classes can be grades and sections, semesters, or exam batches.'],
    ['How long does setup take?', 'An institution and its admin can be created in minutes. Teachers, classes and the timetable are added by your admin; class teachers enrol students individually or by CSV.'],
    ['Do we need to install anything?', 'No. EduAI runs in the browser on desktop, tablet and phone.'],
  ] },
  { group: 'AI evaluation', items: [
    ['Can it mark handwritten answers?', 'Yes. Scanned or photographed scripts are read question by question (SL.No) and marked against your model answer and marking scheme. Typed PDFs are read directly.'],
    ['Will teachers lose control of the marks?', 'No. Teachers see the reason for every mark and can edit any question’s marks at any time — even after publishing. The AI’s original mark is kept for audit.'],
    ['How are scripts matched to students?', 'Name the PDFs after students (or use admission numbers). EduAI matches them to the class roster and lets you fix any mismatch before marking.'],
  ] },
  { group: 'AI tutor', items: [
    ['Does the tutor make things up?', 'It answers only from the textbooks your teachers publish, cites the page for every answer, and says so when the textbook doesn’t cover a question.'],
    ['Can students ask by voice?', 'Yes — students can type or speak their question.'],
  ] },
  { group: 'Data & security', items: [
    ['Is our data separate from other schools?', 'Yes. Each institution is its own tenant; users can only see their own institution’s data, limited further by their role.'],
    ['Who can see student results?', 'Students see only their own results, and only once the teacher releases them (instantly or after publishing — the teacher decides). Teachers see their classes; admins see their institution.'],
  ] },
  { group: 'Plans', items: [
    ['Can we choose which AI features to use?', 'Yes. AI modules (tutor, evaluation and more) can be switched on per institution, and plans can limit the number of students.'],
    ['How do we get a price?', 'Request a demo below — pricing depends on the number of students and the modules you need.'],
  ] },
]

export default function Landing() {
  const { user, loading } = useAuth()
  const [menu, setMenu] = useState(false)
  const [role, setRole] = useState(ROLES[0].id)
  const [scrolled, setScrolled] = useState(false)
  const { hash } = useLocation()
  // Links like /#demo from other pages: scroll once the page has rendered.
  useEffect(() => {
    if (!hash || loading) return
    const t = window.setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth' }), 50)
    return () => window.clearTimeout(t)
  }, [hash, loading])
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 8)
    window.addEventListener('scroll', h, { passive: true })
    return () => window.removeEventListener('scroll', h)
  }, [])

  if (loading) return <FullPageSpinner />
  if (user) return <Navigate to={user.home_route} replace />
  const r = ROLES.find((x) => x.id === role)!

  return (
    <div className="min-h-full overflow-x-hidden">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-ink-900 focus:px-3 focus:py-2">Skip to content</a>

      {/* ── Utility strip ── */}
      <div className="bg-fg text-[12px] text-white/85">
        <div className="mx-auto flex max-w-7xl items-center justify-center gap-x-6 gap-y-1 overflow-x-auto px-4 py-1.5 whitespace-nowrap">
          <span className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> AI marking for handwritten answers</span>
          <span className="hidden items-center gap-1.5 sm:flex"><BookOpenCheck className="h-3.5 w-3.5" /> Textbook-grounded AI tutor</span>
          <span className="hidden items-center gap-1.5 md:flex"><School className="h-3.5 w-3.5" /> Schools · Colleges · Coaching centres</span>
        </div>
      </div>

      {/* ── Navigation ── */}
      <header className={cn('sticky top-0 z-30 border-b bg-ink-900/90 backdrop-blur transition-shadow', scrolled ? 'border-line shadow-sm' : 'border-transparent')}>
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4">
          <a href="#top" className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-aqua-500 shadow-glow"><Sparkles className="h-5 w-5 text-white" /></span>
            <span className="font-display text-lg font-semibold text-fg">EduAI</span>
          </a>
          <nav aria-label="Main" className="hidden flex-1 items-center gap-1 lg:flex">
            {NAV.map(([href, label]) => <a key={href} href={href} className="rounded-lg px-3 py-2 text-sm text-ink-300 hover:bg-ink-800 hover:text-fg">{label}</a>)}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link to="/login" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'hidden sm:inline-flex')} id="landing-signin">Sign in</Link>
            <a href="#demo" className={buttonVariants({ size: 'sm' })}>Book a free demo</a>
            <button className="cursor-pointer rounded-lg p-2 text-ink-300 hover:bg-ink-800 lg:hidden" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
              {menu ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {menu && (
          <nav aria-label="Mobile" className="border-t border-line bg-ink-900 px-4 py-2 lg:hidden">
            {NAV.map(([href, label]) => <a key={href} href={href} onClick={() => setMenu(false)} className="block rounded-lg px-3 py-2 text-sm text-ink-100 hover:bg-ink-800">{label}</a>)}
            <Link to="/login" className="block rounded-lg px-3 py-2 text-sm font-medium text-brand-600">Sign in</Link>
          </nav>
        )}
      </header>

      <main id="main">
        {/* ── Hero ── */}
        <section id="top" className="relative">
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60rem_30rem_at_10%_-10%,hsl(236_90%_70%/0.12),transparent_60%),radial-gradient(40rem_30rem_at_100%_10%,hsl(184_80%_45%/0.10),transparent_60%)]" />
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 pb-16 pt-12 md:pt-20 lg:grid-cols-[1.05fr_1fr]">
            <div className="animate-fade-up">
              <span className="inline-flex items-center gap-2 rounded-full border border-brand-400/30 bg-brand-500/8 px-3 py-1 text-xs font-medium text-brand-600"><Sparkles className="h-3.5 w-3.5" /> School ERP + AI learning, in one platform</span>
              <h1 className="mt-5 font-display text-4xl font-bold leading-[1.07] md:text-[3.4rem]">
                Run your institution. <span className="text-gradient">Let AI do the marking.</span>
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-300 md:text-lg">
                Attendance, timetables, homework, online tests and assignments — plus AI that marks handwritten answers with reasons
                and a tutor that answers only from your own textbooks. For schools, colleges and coaching centres.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href="#demo" className={buttonVariants({ size: 'lg' })} id="hero-demo">Book a free demo <ArrowRight className="h-4 w-4" /></a>
                <Link to="/login" className={buttonVariants({ size: 'lg', variant: 'secondary' })}>Sign in to your institution</Link>
              </div>
              <ul className="mt-8 grid gap-2 text-sm text-ink-300 sm:grid-cols-3">
                {['Teachers approve every mark', 'Each school’s data kept separate', 'Works on phone, tablet & PC'].map((t) => (
                  <li key={t} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-ok" />{t}</li>
                ))}
              </ul>
            </div>
            <div className="animate-fade-up [animation-delay:120ms]"><HeroCollage /></div>
          </div>
        </section>

        {/* ── Product facts ── */}
        <section aria-label="EduAI at a glance" className="border-y border-line bg-ink-900">
          <dl className="mx-auto grid max-w-7xl grid-cols-2 gap-6 px-4 py-8 md:grid-cols-4">
            {[['8', 'core modules in one login'], ['3', 'institution types: school, college, coaching'], ['SL.No-wise', 'AI marks with reasons & missing points'], ['Every answer', 'from the AI tutor cites its textbook page']].map(([v, l]) => (
              <div key={l} className="text-center"><dt className="font-display text-2xl font-bold text-brand-600 md:text-3xl">{v}</dt><dd className="mt-1 text-sm text-ink-300">{l}</dd></div>
            ))}
          </dl>
        </section>

        {/* ── Modules ── */}
        <section id="modules" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-20">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-brand-600">Everything in one place</p>
            <h2 className="mt-2 font-display text-3xl font-bold md:text-4xl">Every module your campus runs on</h2>
            <p className="mt-3 text-ink-300">From the first bell to the final score sheet — no more juggling registers, spreadsheets and separate apps.</p>
          </Reveal>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {MODULES.map(({ icon: Icon, title, body, tags }, i) => (
              <Reveal key={title} delay={(i % 4) * 70}>
                <Card className="group h-full p-5 transition-all hover:-translate-y-1 hover:shadow-glow">
                  <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-brand-500/10 transition-colors group-hover:bg-brand-500"><Icon className="h-5 w-5 text-brand-600 group-hover:text-white" /></div>
                  <h3 className="font-display text-lg font-semibold">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-300">{body}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">{tags.map((t) => <span key={t} className="rounded-full bg-ink-800 px-2 py-0.5 text-[11px] text-ink-300">{t}</span>)}</div>
                </Card>
              </Reveal>
            ))}
          </div>
          <Reveal className="mt-6">
            <div className="grid gap-3 rounded-2xl border border-line bg-ink-800/70 p-4 sm:grid-cols-2 lg:grid-cols-4">
              {SHARED.map(({ icon: Icon, title, body }) => (
                <div key={title} className="flex gap-3"><Icon className="mt-0.5 h-5 w-5 shrink-0 text-aqua-400" /><div><div className="text-sm font-semibold text-fg">{title}</div><div className="text-xs text-ink-300">{body}</div></div></div>
              ))}
            </div>
          </Reveal>
        </section>

        {/* ── AI cycle ── */}
        <section id="ai" className="scroll-mt-20 bg-gradient-to-b from-brand-500/[0.06] to-transparent py-20">
          <div className="mx-auto max-w-7xl px-4">
            <Reveal className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-semibold uppercase tracking-widest text-brand-600">The AI learning loop</p>
              <h2 className="mt-2 font-display text-3xl font-bold md:text-4xl">Plan → learn → practise → evaluate → improve</h2>
              <p className="mt-3 text-ink-300">Each step feeds the next, so teachers spend time teaching and students always know what to work on.</p>
            </Reveal>
            <ol className="mt-12 grid gap-4 md:grid-cols-5">
              {CYCLE.map(({ icon: Icon, step, body }, i) => (
                <Reveal key={step} delay={i * 80}>
                  <li className="relative h-full rounded-2xl border border-line bg-ink-900 p-5">
                    <span className="absolute -top-3 left-5 rounded-full bg-brand-500 px-2 py-0.5 text-xs font-semibold text-white">Step {i + 1}</span>
                    <Icon className="mb-3 mt-2 h-7 w-7 text-brand-600" />
                    <h3 className="font-display text-lg font-semibold">{step}</h3>
                    <p className="mt-1 text-sm text-ink-300">{body}</p>
                    {i < CYCLE.length - 1 && <ArrowRight aria-hidden className="absolute -right-3.5 top-1/2 hidden h-5 w-5 -translate-y-1/2 text-ink-500 md:block" />}
                  </li>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* ── AI evaluation spotlight ── */}
        <section className="mx-auto max-w-7xl px-4 py-20">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <Reveal>
              <p className="text-sm font-semibold uppercase tracking-widest text-brand-600">AI answer evaluation</p>
              <h2 className="mt-2 font-display text-3xl font-bold md:text-4xl">Marks with reasons — not just a number</h2>
              <p className="mt-3 text-ink-300">Upload the question paper and your SL.No-wise model answers once. Then every script — online test, uploaded assignment or a folder of scanned exams — is marked question by question.</p>
              <ul className="mt-6 space-y-3 text-sm">
                {[
                  ['Reads handwriting', 'Scanned pages are transcribed per question, including formulas.'],
                  ['Explains every mark', 'Why marks were given, what was missing and how to improve.'],
                  ['Finds class-wide gaps', 'Questions nobody answered, weakest topics and students below the pass mark.'],
                  ['You stay in control', 'Edit any mark, anytime; publish results when you’re ready.'],
                ].map(([t, d]) => <li key={t} className="flex gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ok" /><span><b className="text-fg">{t}.</b> <span className="text-ink-300">{d}</span></span></li>)}
              </ul>
              <a href="#demo" className={cn(buttonVariants(), 'mt-8')}>See it marking your own papers <ArrowRight className="h-4 w-4" /></a>
            </Reveal>
            <Reveal delay={120} className="relative">
              <EvaluationMock className="relative z-10 mx-auto max-w-md" />
              <RegisterMock className="absolute -bottom-10 -right-2 hidden w-64 rotate-2 md:block" />
              <UploadMock className="absolute -left-6 -top-10 hidden w-56 -rotate-3 md:block" />
            </Reveal>
          </div>
        </section>

        {/* ── A day with EduAI ── */}
        <section id="day" className="scroll-mt-20 bg-ink-900 py-20">
          <div className="mx-auto max-w-6xl px-4">
            <Reveal className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-semibold uppercase tracking-widest text-brand-600">A day with EduAI</p>
              <h2 className="mt-2 font-display text-3xl font-bold md:text-4xl">What a school day looks like</h2>
            </Reveal>
            <ol className="relative mt-14 space-y-14 before:absolute before:bottom-0 before:left-[1.35rem] before:top-0 before:w-px before:bg-line md:before:left-1/2">
              {DAY.map(({ time, title, body, mock: Mock }, i) => (
                <li key={time} className="relative grid gap-6 pl-14 md:grid-cols-2 md:gap-14 md:pl-0">
                  <span className="absolute left-0 top-0 grid h-11 w-11 place-items-center rounded-full border-4 border-ink-900 bg-brand-500 text-[11px] font-bold text-white md:left-1/2 md:-translate-x-1/2">{time}</span>
                  <Reveal className={cn('md:pt-2', i % 2 ? 'md:order-2 md:pl-6' : 'md:pr-6 md:text-right')}>
                    <h3 className="font-display text-xl font-semibold">{title}</h3>
                    <p className="mt-2 text-ink-300">{body}</p>
                  </Reveal>
                  <Reveal delay={100} className={cn(i % 2 ? 'md:order-1 md:pr-6' : 'md:pl-6')}><Mock className="mx-auto max-w-sm" /></Reveal>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── For your team ── */}
        <section id="roles" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-20">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-brand-600">Built for every role</p>
            <h2 className="mt-2 font-display text-3xl font-bold md:text-4xl">What changes for your team</h2>
          </Reveal>
          <div role="tablist" aria-label="Roles" className="mx-auto mt-10 flex max-w-3xl flex-wrap justify-center gap-2">
            {ROLES.map(({ id, icon: Icon, label }) => (
              <button key={id} role="tab" aria-selected={role === id} onClick={() => setRole(id)}
                className={cn('flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all',
                  role === id ? 'border-brand-500 bg-brand-500 text-white shadow-glow' : 'border-line text-ink-300 hover:border-line-strong hover:text-fg')}>
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
          <div role="tabpanel" key={role} className="mx-auto mt-8 grid max-w-4xl gap-4 animate-fade-up md:grid-cols-2">
            <Card className="p-6">
              <div className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">Today</div>
              <ul className="space-y-2.5 text-sm text-ink-300">{r.before.map((b) => <li key={b} className="flex gap-2"><X className="mt-0.5 h-4 w-4 shrink-0 text-bad" />{b}</li>)}</ul>
            </Card>
            <Card className="border-brand-400/40 p-6 ring-1 ring-brand-400/20">
              <div className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-600">With EduAI</div>
              <ul className="space-y-2.5 text-sm text-ink-100">{r.after.map((a) => <li key={a} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" />{a}</li>)}</ul>
            </Card>
          </div>
        </section>

        {/* ── Getting started ── */}
        <section className="bg-gradient-to-b from-aqua-500/[0.06] to-transparent py-20">
          <div className="mx-auto max-w-6xl px-4">
            <Reveal className="text-center">
              <p className="text-sm font-semibold uppercase tracking-widest text-brand-600">Go live fast</p>
              <h2 className="mt-2 font-display text-3xl font-bold md:text-4xl">From sign-up to first AI-marked test</h2>
            </Reveal>
            <ol className="mt-12 grid gap-4 md:grid-cols-4">
              {STEPS.map(({ title, body }, i) => (
                <Reveal key={title} delay={i * 80}>
                  <li className="h-full rounded-2xl border border-line bg-ink-900 p-5">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-500 font-display font-bold text-white">{i + 1}</span>
                    <h3 className="mt-3 font-semibold text-fg">{title}</h3>
                    <p className="mt-1 text-sm text-ink-300">{body}</p>
                  </li>
                </Reveal>
              ))}
            </ol>
            <Reveal className="mt-6">
              <p className="flex items-center justify-center gap-2 rounded-xl border border-line bg-ink-900 px-4 py-3 text-center text-sm text-ink-300">
                <Upload className="h-4 w-4 shrink-0 text-brand-600" /> Moving from spreadsheets? Import your students by CSV and keep your existing class and subject codes.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ── Trust ── */}
        <section className="mx-auto max-w-7xl px-4 py-20">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-brand-600">Safe by design</p>
            <h2 className="mt-2 font-display text-3xl font-bold md:text-4xl">Student data, protected</h2>
          </Reveal>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {TRUST.map(({ icon: Icon, title, body }, i) => (
              <Reveal key={title} delay={(i % 3) * 70}>
                <div className="flex h-full gap-4 rounded-2xl border border-line bg-ink-900 p-5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ok/10"><Icon className="h-5 w-5 text-ok" /></span>
                  <div><h3 className="font-semibold text-fg">{title}</h3><p className="mt-1 text-sm text-ink-300">{body}</p></div>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── Comparison ── */}
        <section className="bg-ink-900 py-20">
          <div className="mx-auto max-w-5xl px-4">
            <Reveal className="text-center">
              <h2 className="font-display text-3xl font-bold md:text-4xl">One platform instead of five</h2>
              <p className="mt-3 text-ink-300">How EduAI compares with registers and a patchwork of separate tools.</p>
            </Reveal>
            <Reveal className="mt-10 overflow-x-auto rounded-2xl border border-line">
              <table className="w-full min-w-[40rem] text-sm">
                <thead><tr className="bg-ink-800 text-left">
                  <th scope="col" className="p-4 font-semibold text-fg">Capability</th>
                  <th scope="col" className="p-4 font-semibold text-ink-300">Registers & paper</th>
                  <th scope="col" className="p-4 font-semibold text-ink-300">Separate tools</th>
                  <th scope="col" className="bg-brand-500/10 p-4 font-semibold text-brand-600">EduAI</th>
                </tr></thead>
                <tbody>{COMPARE.map(([c, a, b, e]) => (
                  <tr key={c} className="border-t border-line">
                    <th scope="row" className="p-4 text-left font-medium text-ink-100">{c}</th>
                    <td className="p-4 text-ink-500">{a}</td><td className="p-4 text-ink-500">{b}</td>
                    <td className="bg-brand-500/5 p-4 font-medium text-ok"><span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" />{e}</span></td>
                  </tr>
                ))}</tbody>
              </table>
            </Reveal>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section id="faq" className="mx-auto max-w-4xl scroll-mt-20 px-4 py-20">
          <Reveal className="text-center"><h2 className="font-display text-3xl font-bold md:text-4xl">Frequently asked questions</h2></Reveal>
          <div className="mt-10 space-y-8">
            {FAQ.map(({ group, items }) => (
              <Reveal key={group}>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-brand-600">{group}</h3>
                <div className="divide-y divide-line rounded-2xl border border-line bg-ink-900">
                  {items.map(([q, a]) => (
                    <details key={q} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-fg">
                        {q}<ChevronDown className="h-4 w-4 shrink-0 text-ink-500 transition-transform group-open:rotate-180" />
                      </summary>
                      <p className="mt-2 text-sm leading-relaxed text-ink-300">{a}</p>
                    </details>
                  ))}
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── Demo request ── */}
        <section id="demo" className="scroll-mt-20 bg-gradient-to-br from-brand-500/[0.08] via-transparent to-aqua-500/[0.08] py-20">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 lg:grid-cols-[1fr_1.2fr]">
            <Reveal>
              <p className="text-sm font-semibold uppercase tracking-widest text-brand-600">Free personalised demo</p>
              <h2 className="mt-2 font-display text-3xl font-bold md:text-4xl">See EduAI with your own syllabus</h2>
              <p className="mt-3 text-ink-300">A 30-minute walkthrough tailored to your institution.</p>
              <ul className="mt-6 space-y-3 text-sm text-ink-100">
                {['Attendance, timetable and homework set up for your classes', 'AI marking a sample of your own question paper', 'The textbook tutor answering from your books', 'Admin dashboards, score registers and exports', 'Pricing for your number of students and modules'].map((t) => (
                  <li key={t} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" />{t}</li>
                ))}
              </ul>
              <div className="mt-8 grid grid-cols-3 gap-3">
                {[[MonitorCheck, 'Online demo'], [Layers, 'All modules'], [ShieldCheck, 'No commitment']].map(([Icon, t]) => {
                  const I = Icon as typeof MonitorCheck
                  return <div key={t as string} className="rounded-xl border border-line bg-ink-900 p-3 text-center text-xs text-ink-300"><I className="mx-auto mb-1 h-5 w-5 text-brand-600" />{t as string}</div>
                })}
              </div>
            </Reveal>
            <Reveal delay={100}><Card className="p-6 md:p-8"><DemoForm /></Card></Reveal>
          </div>
        </section>

        {/* ── Contact banner ── */}
        {(SALES_EMAIL || SALES_PHONE) && (
          <section className="bg-fg py-10 text-white">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-4">
              <div><h2 className="font-display text-2xl font-bold text-white">Prefer to talk to someone?</h2><p className="text-white/70">Our team will help you plan your rollout.</p></div>
              <div className="flex flex-wrap gap-3">
                {SALES_PHONE && <a href={`tel:${SALES_PHONE.replace(/\s+/g, '')}`} className={cn(buttonVariants({ variant: 'secondary' }))}><Phone className="h-4 w-4" />{SALES_PHONE}</a>}
                {SALES_EMAIL && <a href={`mailto:${SALES_EMAIL}`} className={buttonVariants()}><Mail className="h-4 w-4" />{SALES_EMAIL}</a>}
              </div>
            </div>
          </section>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-line bg-ink-900">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-aqua-500"><Sparkles className="h-5 w-5 text-white" /></span>
              <span className="font-display text-lg font-semibold text-fg">EduAI</span>
            </div>
            <p className="mt-3 max-w-xs text-sm text-ink-300">School ERP and AI learning for schools, colleges and coaching centres. Teach · Learn · Grow.</p>
          </div>
          {[
            ['Platform', [['#modules', 'Attendance & timetable'], ['#modules', 'Homework & assignments'], ['#modules', 'Online tests'], ['#roles', 'Admin console']]],
            ['AI suite', [['#ai', 'AI answer evaluation'], ['#ai', 'Textbook AI tutor'], ['#ai', 'Lesson planner'], ['#day', 'A day with EduAI']]],
            ['Get started', [['#demo', 'Book a free demo'], ['/login', 'Sign in'], ['#faq', 'FAQ'], ['#roles', 'For your team']]],
          ].map(([title, links]) => (
            <div key={title as string}>
              <h3 className="text-sm font-semibold text-fg">{title as string}</h3>
              <ul className="mt-3 space-y-2 text-sm">{(links as string[][]).map(([href, label]) => (
                <li key={label}>{href.startsWith('/') ? <Link to={href} className="text-ink-300 hover:text-brand-600">{label}</Link> : <a href={href} className="text-ink-300 hover:text-brand-600">{label}</a>}</li>
              ))}</ul>
            </div>
          ))}
        </div>
        <div className="border-t border-line py-5 text-center text-xs text-ink-500">© {YEAR} EduAI Platform. All rights reserved.</div>
      </footer>
    </div>
  )
}
