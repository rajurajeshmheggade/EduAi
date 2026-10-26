/**
 * Product "screenshots" drawn in code: small, theme-matched replicas of real EduAI screens used as the landing
 * page's imagery (no stock photos, no licensing, always in sync with the brand colours). Decorative: aria-hidden.
 */
import { BookMarked, Bot, CalendarCheck, CheckCircle2, Clock, Flag, Lightbulb, Medal, Sparkles, TriangleAlert, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'

function Frame({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div aria-hidden className={cn('overflow-hidden rounded-2xl border border-line bg-ink-900 shadow-[0_24px_60px_-28px_hsl(236_60%_30%/0.35)]', className)}>
      <div className="flex items-center gap-1.5 border-b border-line bg-ink-800 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-bad/60" /><span className="h-2.5 w-2.5 rounded-full bg-warn/60" /><span className="h-2.5 w-2.5 rounded-full bg-ok/60" />
        <span className="ml-2 truncate text-[11px] font-medium text-ink-500">{title}</span>
      </div>
      <div className="p-3.5">{children}</div>
    </div>
  )
}

const P = 'bg-ok text-white', A = 'bg-bad text-white', L = 'bg-warn text-white'

export function AttendanceMock({ className }: { className?: string }) {
  const rows: [string, string][] = [['1', 'Aarav Sharma'], ['2', 'Diya Patel'], ['3', 'Kabir Shah'], ['4', 'Meera Nair']]
  const marks = [P, P, A, L]
  return (
    <Frame title="Attendance · Grade 10-A · Physics · Period 2" className={className}>
      <div className="mb-2 flex items-center justify-between text-[11px]"><span className="font-semibold text-fg">Thu, 24 Oct</span><span className="rounded-full bg-ok/15 px-2 py-0.5 font-medium text-ok">3 / 4 present</span></div>
      <div className="space-y-1.5">
        {rows.map(([roll, name], i) => (
          <div key={roll} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5 text-[11px]">
            <span className="w-3 text-ink-500">{roll}</span><span className="flex-1 font-medium text-ink-100">{name}</span>
            {['P', 'A', 'L', 'LV'].map((k, j) => (
              <span key={k} className={cn('grid h-5 min-w-5 place-items-center rounded px-1 text-[9px] font-bold', j === [0, 0, 1, 2][i] ? marks[i] : 'border border-line text-ink-500')}>{k}</span>
            ))}
          </div>
        ))}
      </div>
    </Frame>
  )
}

export function EvaluationMock({ className }: { className?: string }) {
  return (
    <Frame title="AI evaluation · SL.No 2" className={className}>
      <div className="flex items-start gap-2">
        <span className="grid h-6 min-w-6 place-items-center rounded-md bg-brand-500 text-[11px] font-bold text-white">2</span>
        <p className="flex-1 text-[11px] font-medium text-fg">Object 20 cm from a concave mirror, f = 15 cm. Find the image distance.</p>
        <span className="font-display text-base font-bold text-ok">4.5/5</span>
      </div>
      <div className="mt-2 rounded-lg border border-ok/25 bg-ok/8 p-2 text-[10.5px] text-ink-100"><b className="text-ok">Why:</b> Mirror formula, sign convention and v = −60 cm correct.</div>
      <div className="mt-1.5 rounded-lg border border-warn/30 bg-warn/8 p-2 text-[10.5px] text-ink-100"><b className="text-warn">Missing:</b> Nature of image — inverted, magnified (−0.5M)</div>
      <div className="mt-1.5 rounded-lg border border-brand-400/25 bg-brand-500/6 p-2 text-[10.5px] text-ink-100"><b className="text-brand-600">Feedback:</b> Always state nature, position and size of the image.</div>
    </Frame>
  )
}

export function TutorMock({ className }: { className?: string }) {
  return (
    <Frame title="AI classroom · Physics textbook" className={className}>
      <div className="space-y-2 text-[11px]">
        <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-brand-600 px-3 py-1.5 text-white">Why does a passenger lurch forward when a bus brakes?</div>
        <div className="flex gap-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-aqua-500 to-brand-500"><Bot className="h-3.5 w-3.5 text-white" /></span>
          <div className="rounded-2xl rounded-tl-sm border border-line bg-ink-800 px-3 py-1.5 text-ink-100">
            Because of <b>inertia</b> — the body keeps moving while the bus stops
            <span className="mx-1 inline-flex items-center gap-0.5 rounded border border-aqua-400/40 bg-aqua-500/10 px-1 text-[10px] font-semibold text-aqua-400"><BookMarked className="h-2.5 w-2.5" />Page 14</span>.
          </div>
        </div>
        <div className="flex flex-wrap gap-1 pl-8">{['p.14 · Newton’s First Law', 'p.15 · Inertia', 'p.12 · Motion'].map((t) => <span key={t} className="rounded border border-line px-1.5 py-0.5 text-[9.5px] text-ink-300">{t}</span>)}</div>
      </div>
    </Frame>
  )
}

export function TimetableMock({ className }: { className?: string }) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const grid = [['PHY', 'ENG', 'PHY', 'ENG', 'PHY'], ['MAT', 'MAT', 'MAT', 'MAT', 'MAT'], ['ENG', 'PHY', 'LAB', 'PHY', 'ENG']]
  const tone: Record<string, string> = { PHY: 'bg-brand-500/12 text-brand-600', MAT: 'bg-aqua-500/12 text-aqua-400', ENG: 'bg-rose-400/12 text-rose-400', LAB: 'bg-warn/15 text-warn' }
  return (
    <Frame title="Timetable · Grade 9-B" className={className}>
      <div className="grid grid-cols-[2rem_repeat(5,1fr)] gap-1 text-center text-[10px]">
        <span />{days.map((d) => <span key={d} className={cn('font-semibold', d === 'Thu' ? 'text-brand-600' : 'text-ink-500')}>{d}</span>)}
        {grid.map((row, i) => [<span key={`p${i}`} className="py-1.5 text-ink-500">P{i + 1}</span>,
          ...row.map((s, j) => <span key={`${i}${j}`} className={cn('rounded-md py-1.5 font-semibold', tone[s])}>{s}</span>)])}
      </div>
    </Frame>
  )
}

export function TestRunnerMock({ className }: { className?: string }) {
  return (
    <Frame title="Online test · Laws of Motion" className={className}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-fg">Question 3 of 10</span>
        <span className="flex items-center gap-1 rounded-lg bg-ink-800 px-2 py-1 font-display text-sm font-bold tabular-nums text-fg"><Clock className="h-3.5 w-3.5" />18:42</span>
      </div>
      <p className="mt-2 text-[11px] text-ink-100">What is the SI unit of force?</p>
      <div className="mt-2 space-y-1">{['(a) Joule', '(b) Newton', '(c) Watt'].map((o, i) => (
        <div key={o} className={cn('rounded-lg border px-2 py-1 text-[10.5px]', i === 1 ? 'border-brand-400 bg-brand-500/8 font-medium text-fg' : 'border-line text-ink-300')}>{o}</div>
      ))}</div>
      <div className="mt-2.5 flex gap-1">{Array.from({ length: 10 }, (_, i) => (
        <span key={i} className={cn('relative grid h-5 flex-1 place-items-center rounded text-[9px] font-bold', i < 3 ? 'bg-ok text-white' : 'border border-line text-ink-500', i === 2 && 'ring-2 ring-brand-400')}>
          {i + 1}{i === 5 && <Flag className="absolute -right-1 -top-1 h-2.5 w-2.5 fill-warn text-warn" />}
        </span>
      ))}</div>
    </Frame>
  )
}

export function LessonPlanMock({ className }: { className?: string }) {
  return (
    <Frame title="How to teach · Ch 2 · 45 min" className={className}>
      <div className="space-y-1.5 text-[10.5px]">
        {[['0–7', 'Hook: why seat belts matter'], ['7–32', 'Newton’s three laws + board work'], ['32–41', 'Pair practice: 2 numericals'], ['41–45', 'Exit questions']].map(([t, s]) => (
          <div key={t} className="flex gap-2"><span className="w-9 shrink-0 rounded bg-brand-500/10 px-1 text-center font-semibold text-brand-600">{t}</span><span className="text-ink-100">{s}</span></div>
        ))}
        <div className="mt-1 flex items-start gap-1.5 rounded-lg bg-warn/10 p-1.5 text-warn"><Lightbulb className="mt-px h-3 w-3 shrink-0" /> Misconception: action–reaction cancel out</div>
      </div>
    </Frame>
  )
}

export function UploadMock({ className }: { className?: string }) {
  return (
    <Frame title="Assignment · Upload answers" className={className}>
      <div className="grid place-items-center rounded-xl border-2 border-dashed border-brand-400/50 bg-brand-500/5 py-4 text-center text-[10.5px] text-ink-300">
        <Upload className="mb-1 h-5 w-5 text-brand-600" />Diya_Patel.pdf · 3 pages
      </div>
      <div className="mt-2 flex items-center gap-2 text-[10.5px]"><Sparkles className="h-3.5 w-3.5 text-brand-600" /><span className="flex-1 text-ink-100">Reading handwriting… SL.No 1–5 found</span><span className="font-semibold text-ok">82%</span></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-700"><div className="h-full w-4/5 rounded-full bg-brand-500" /></div>
    </Frame>
  )
}

export function RegisterMock({ className }: { className?: string }) {
  const rows: [string, string, string, string][] = [['1', 'Aarav S.', '42/50', 'A'], ['2', 'Diya P.', '38/50', 'B+'], ['—', 'Kabir S.', 'Not submitted', ''], ['4', 'Meera N.', '17/50', 'F']]
  return (
    <Frame title="Score register · Unit Test 2" className={className}>
      <table className="w-full text-[10.5px]"><tbody>
        {rows.map(([r, n, m, g]) => (
          <tr key={n} className="border-b border-line last:border-0">
            <td className="py-1 text-ink-500">{r}</td><td className="py-1 font-medium text-ink-100">{n}</td>
            <td className={cn('py-1 text-right tabular-nums', m === 'Not submitted' ? 'text-bad' : 'text-fg')}>{m}</td>
            <td className="py-1 pl-2 text-right">{g && <span className={cn('rounded px-1 font-semibold', g === 'F' ? 'bg-bad/12 text-bad' : 'bg-ok/12 text-ok')}>{g}</span>}</td>
          </tr>
        ))}
      </tbody></table>
    </Frame>
  )
}

/** Hero collage: overlapping product screens with floating "result" chips. */
export function HeroCollage() {
  return (
    <div aria-hidden className="relative mx-auto h-[25rem] w-full max-w-[34rem] sm:h-[28rem]">
      <div className="absolute inset-0 -z-10 rounded-[3rem] bg-[radial-gradient(circle_at_30%_30%,hsl(236_90%_70%/0.18),transparent_60%),radial-gradient(circle_at_80%_70%,hsl(184_80%_45%/0.16),transparent_60%)]" />
      <EvaluationMock className="absolute left-0 top-6 w-[64%] rotate-[-2deg]" />
      <TutorMock className="absolute right-0 top-0 w-[56%] rotate-[2deg]" />
      <AttendanceMock className="absolute bottom-0 left-[14%] w-[62%]" />
      <div className="absolute bottom-24 right-0 flex items-center gap-2 rounded-xl border border-line bg-ink-900 px-3 py-2 shadow-lg animate-float">
        <Medal className="h-4 w-4 text-warn" /><div className="text-[11px]"><div className="font-semibold text-fg">Class average 72%</div><div className="text-ink-500">Unit Test 2 · AI-marked</div></div>
      </div>
      <div className="absolute left-0 top-[52%] flex items-center gap-2 rounded-xl border border-line bg-ink-900 px-3 py-2 shadow-lg animate-float [animation-delay:-2s]">
        <CalendarCheck className="h-4 w-4 text-ok" /><div className="text-[11px] font-semibold text-fg">Attendance saved</div>
      </div>
      <div className="absolute right-6 top-[44%] flex items-center gap-1.5 rounded-full border border-bad/30 bg-ink-900 px-2.5 py-1 text-[10.5px] font-medium text-bad shadow animate-float [animation-delay:-4s]">
        <TriangleAlert className="h-3 w-3" /> 2 below 75% attendance
      </div>
      <div className="absolute bottom-[30%] left-[45%] grid h-9 w-9 place-items-center rounded-full bg-ok shadow-lg"><CheckCircle2 className="h-5 w-5 text-white" /></div>
    </div>
  )
}
