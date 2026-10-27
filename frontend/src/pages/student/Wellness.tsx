import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Award, BookOpen, Gamepad2, HeartHandshake, LayoutDashboard, Loader2, MessageSquare, Phone, ShieldCheck, Sparkles, Video, Wind } from 'lucide-react'
import { Overlay } from '@/components/lesson-plan/dialogs'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { KnowledgeBadge } from '@/components/wellness/AcademicProfile'
import { Onboarding } from '@/components/wellness/Onboarding'
import { WellnessContext, celebrate, type WellnessCtx } from '@/components/wellness/WellnessContext'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/services/apiClient'
import { wellnessService } from '@/services/wellnessService'
import type { WellnessMe, WellnessMeta, WellnessStats, XpResult } from '@/types/wellness'

// Each tab is its own chunk; three.js + Web Audio code only loads when a tab that needs it is opened.
const DashboardTab = lazy(() => import('@/components/wellness/dashboard/DashboardTab').then((m) => ({ default: m.DashboardTab })))
const JournalTab = lazy(() => import('@/components/wellness/journal/JournalTab').then((m) => ({ default: m.JournalTab })))
const ChatTab = lazy(() => import('@/components/wellness/chat/ChatTab').then((m) => ({ default: m.ChatTab })))
const AuraLiveTab = lazy(() => import('@/components/wellness/live/AuraLiveTab').then((m) => ({ default: m.AuraLiveTab })))
const BreathingTab = lazy(() => import('@/components/wellness/breathing/BreathingTab').then((m) => ({ default: m.BreathingTab })))
const StressBusterTab = lazy(() => import('@/components/wellness/stress/StressBusterTab').then((m) => ({ default: m.StressBusterTab })))
const Particles = lazy(() => import('@/components/wellness/three/ThreeDimensionalParticles'))

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'journal', label: 'Journal', icon: BookOpen },
  { id: 'chat', label: 'Aura Chat', icon: MessageSquare },
  { id: 'aura-live', label: 'Aura Live', icon: Video },
  { id: 'breathing', label: 'Breathing', icon: Wind },
  { id: 'stress-buster', label: 'Stress Buster', icon: Gamepad2 },
] as const
type TabId = (typeof TABS)[number]['id']

interface ModalState { title: string; message: ReactNode; onConfirm?: () => void }

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Student ▸ Wellness — the MindAlign stress & wellness companion inside EduAI (no separate login). */
export default function Wellness() {
  const [me, setMe] = useState<WellnessMe | null>(null)
  const [meta, setMeta] = useState<WellnessMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [params, setParams] = useSearchParams()
  const tab: TabId = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'dashboard')
  const setTab = (id: TabId) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', id); return n }, { replace: true })

  const refresh = useCallback(async () => {
    try { setMe(await wellnessService.me()); setError(null) } catch (e) { setError(errorMessage(e, 'Could not load your wellness space')) }
  }, [])
  useEffect(() => {
    let alive = true
    wellnessService.me().then((m) => { if (alive) setMe(m) }).catch((e) => { if (alive) setError(errorMessage(e, 'Could not load your wellness space')) })
    wellnessService.meta().then((m) => { if (alive) setMeta(m) }).catch(() => {})
    return () => { alive = false }
  }, [])

  const ctx = useMemo<WellnessCtx | null>(() => {
    if (!me?.profile) return null
    const profile = me.profile
    return {
      me, profile, context: me.context, meta,
      stats: me.stats ?? { avgStress: 0, journalsCount: 0, moodTrend: [] },
      refresh,
      setStats: (s: WellnessStats) => setMe((m) => (m ? { ...m, stats: s } : m)),
      applyXp: (r: XpResult | null | undefined, taskName: string) => {
        if (!r) return
        setMe((m) => (m && m.profile ? { ...m, profile: { ...m.profile, xp: r.xp, level: r.level, levelTitle: r.levelTitle, xpToNext: r.xpToNext, totalXp: r.totalXp } } : m))
        if (r.capped) { toast(`Daily XP limit reached for ${taskName.toLowerCase()} — great consistency!`); return }
        if (r.awarded > 0) toast(`+${r.awarded} XP · ${taskName}`, 'success')
        if (r.leveledUp) {
          celebrate({ particleCount: 200, spread: 100, origin: { y: 0.5 } })
          setModal({ title: '🌟 MINDSET LEVEL UP!', message: `Amazing work! By practicing ${taskName}, you have ascended to Level ${r.level} (${r.levelTitle})! Keep maintaining your emotional equilibrium.` })
        }
      },
      alert: (title, message) => setModal({ title, message }),
      confirm: (title, message, onConfirm) => setModal({ title, message, onConfirm }),
      setAnalyzing,
    }
  }, [me, meta, refresh])

  if (error && !me) return <div className="p-8"><p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p></div>
  if (!me) return <div className="grid h-full place-items-center p-8"><Loader2 className="h-6 w-6 animate-spin text-brand-400" /></div>
  if (!me.profile || !ctx) return <Onboarding name={me.student.name} context={me.context} meta={meta} onDone={() => { celebrate({ particleCount: 150, spread: 80, origin: { y: 0.6 } }); void refresh() }} />

  const p = ctx.profile
  const ac = ctx.context
  const avgStress = ctx.stats.avgStress || 50
  return (
    <WellnessContext.Provider value={ctx}>
      <div className="relative min-h-full">
        {!reducedMotion() && (
          <Suspense fallback={null}>
            <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden opacity-60">
              <Particles isAnalyzing={analyzing} stressLevel={avgStress} activeMode={avgStress > 70 ? 'quantum' : 'nebula'} />
            </div>
          </Suspense>
        )}
        <div className="relative mx-auto max-w-7xl space-y-5 p-4 md:p-8">
          <header className="glass flex flex-wrap items-center justify-between gap-4 rounded-2xl px-5 py-4 animate-fade-up">
            <div className="flex items-center gap-3">
              <span className="text-4xl" aria-hidden>{p.avatar}</span>
              <div>
                <h1 className="font-display text-xl font-bold text-fg">Hello, {me.student.name}!</h1>
                <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-ink-300">
                  <b className="text-fg">{ac.className}</b>{ac.term && <span>· {ac.term}</span>}
                  <span aria-hidden>·</span>
                  <span className="flex items-center gap-1.5" title={ac.knowledge.avgPct === null ? 'No graded assessments yet' : `Average ${Math.round(ac.knowledge.avgPct)}% across ${ac.knowledge.assessments} graded assessments`}>
                    Knowledge level <KnowledgeBadge level={ac.knowledge.level} />
                  </span>
                  <span aria-hidden>·</span>
                  <span><span className="text-gradient font-semibold">MindAlign</span> wellness companion</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-line bg-ink-900 px-3.5 py-2" title={`${p.xp} / ${p.xpToNext} XP for next level`}>
              <Award className="h-5 w-5 text-purple-500" />
              <div className="min-w-44">
                <div className="text-xs font-semibold text-fg">Lvl {p.level}: <span className="text-gradient">{p.levelTitle}</span></div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-700" role="progressbar" aria-valuemin={0} aria-valuemax={p.xpToNext} aria-valuenow={p.xp} aria-label="XP towards next level">
                    <div className="h-full rounded-full bg-gradient-to-r from-brand-500 via-purple-500 to-rose-400 transition-[width] duration-500" style={{ width: `${Math.min(100, (p.xp / p.xpToNext) * 100)}%` }} />
                  </div>
                  <span className="text-[11px] tabular-nums text-ink-500">{p.xp}/{p.xpToNext} XP</span>
                </div>
              </div>
            </div>
          </header>

          <nav role="tablist" aria-label="Wellness sections" className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-ink-800 p-1">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} role="tab" id={`wellness-tab-${id}`} aria-selected={tab === id} onClick={() => setTab(id)}
                className={cn('flex shrink-0 cursor-pointer items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-all',
                  tab === id ? 'bg-ink-900 text-brand-600 shadow-sm ring-1 ring-line' : 'text-ink-300 hover:text-fg')}>
                <Icon className="h-4 w-4" />{label}
              </button>
            ))}
          </nav>

          <Suspense fallback={<div className="skeleton h-80" />}>
            <div key={tab} className="animate-fade-up">
              {tab === 'dashboard' && <DashboardTab />}
              {tab === 'journal' && <JournalTab />}
              {tab === 'chat' && <ChatTab />}
              {tab === 'aura-live' && <AuraLiveTab />}
              {tab === 'breathing' && <BreathingTab />}
              {tab === 'stress-buster' && <StressBusterTab />}
            </div>
          </Suspense>

          <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-ink-900/80 px-4 py-3 text-xs text-ink-300">
            <span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-aqua-400" />Journal and chats are private — your teacher sees trends and safety alerts only.</span>
            <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-rose-400" />Need help now? Tele-MANAS <b className="text-fg">14416</b> · KIRAN <b className="text-fg">1800-599-0019</b> (24x7, free)</span>
          </footer>
        </div>

        {modal && (
          <Overlay onClose={() => setModal(null)}>
            <div className="glass w-[min(460px,100%)] rounded-2xl" role="dialog" aria-modal="true" aria-label={modal.title}>
              <div className="flex items-center gap-2 px-6 pt-5 font-display text-lg font-semibold text-fg"><Sparkles className="h-5 w-5 text-rose-400" />{modal.title}</div>
              <div className="px-6 pb-2 pt-3 text-sm leading-relaxed text-ink-300">{modal.message}</div>
              <div className="flex justify-end gap-2.5 px-6 pb-5 pt-3">
                {modal.onConfirm ? (
                  <>
                    <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
                    <Button onClick={() => { const f = modal.onConfirm; setModal(null); f?.() }}>Confirm</Button>
                  </>
                ) : <Button onClick={() => setModal(null)}><HeartHandshake className="h-4 w-4" />Acknowledge</Button>}
              </div>
            </div>
          </Overlay>
        )}
      </div>
    </WellnessContext.Provider>
  )
}
