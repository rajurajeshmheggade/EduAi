/**
 * The student's Focus Timer, available on every student page (floating button + popup, and the Wellness Focus Mode
 * card). One timer per student: it survives navigation, and a reload via per-user storage; other open tabs follow it.
 * A finished session of FOCUS_XP_MIN_MINUTES or more earns the Wellness "pomodoro" XP (amount and daily cap decided by
 * the server); the Wellness page listens for the result to update its XP bar.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import type { FocusSoundId } from '@/components/wellness/audio/ambientAudio'
import { toast } from '@/components/ui/toast'
import { FOCUS_XP_MIN_MINUTES, isExamPath } from '@/lib/studyFlow/config'
import {
  focusRemaining, initialFocus, pauseFocus, resetFocus, restoreFocus, setFocusMinutes, startFocus, tickFocus, type FocusTimerState,
} from '@/lib/studyFlow/focusTimer'
import { quietNow, useQuiet } from '@/lib/studyFlow/quiet'
import { readStored, storageKey, writeStored } from '@/lib/studyFlow/storage'
import { errorMessage } from '@/services/apiClient'
import { wellnessService } from '@/services/wellnessService'
import type { XpResult } from '@/types/wellness'
import { FocusSoundEngine, isFocusSound } from './focusSound'

export interface FocusPrefs {
  /** Ambient sound played while the timer runs (null = none). */
  sound: FocusSoundId | null
  volume: number
  muted: boolean
}
const DEFAULT_PREFS: FocusPrefs = { sound: null, volume: 0.6, muted: false }

export interface FocusTimerApi {
  timer: FocusTimerState
  remainingMs: number
  prefs: FocusPrefs
  /** Web Audio exists in this browser (sound options are offered). */
  audioAvailable: boolean
  panelOpen: boolean
  openPanel: () => void
  closePanel: () => void
  togglePanel: () => void
  /** Start (or resume) — call from a click: it also unlocks audio. */
  start: () => void
  pause: () => void
  reset: () => void
  setMinutes: (minutes: number) => void
  chooseSound: (id: FocusSoundId | null) => void
  setVolume: (v: number) => void
  toggleMute: () => void
  /** Receive the XP result of finished sessions (instead of the default toast) while subscribed. */
  onXp: (handler: (r: XpResult) => void) => () => void
}

const Ctx = createContext<FocusTimerApi | null>(null)

/** The focus timer, or null outside a student session. */
// eslint-disable-next-line react-refresh/only-export-components
export const useFocusTimer = () => useContext(Ctx)

/** Call `handler` with the XP of each finished focus session while mounted (e.g. to update the Wellness XP bar). */
// eslint-disable-next-line react-refresh/only-export-components
export function useFocusXp(handler: (r: XpResult) => void) {
  const focus = useFocusTimer()
  const ref = useRef(handler)
  useEffect(() => { ref.current = handler })
  const onXp = focus?.onXp
  useEffect(() => (onXp ? onXp((r) => ref.current(r)) : undefined), [onXp])
}

interface Stored { timer: FocusTimerState; prefs: FocusPrefs }

function restorePrefs(raw: unknown): FocusPrefs {
  const r = (raw ?? {}) as Partial<FocusPrefs>
  return {
    sound: isFocusSound(r.sound) ? r.sound : null,
    volume: typeof r.volume === 'number' && r.volume >= 0 && r.volume <= 1 ? r.volume : DEFAULT_PREFS.volume,
    muted: r.muted === true,
  }
}

function load(scope: string | null): Stored & { scope: string | null } {
  const raw = scope ? readStored<Partial<Stored>>(storageKey('focusTimer', scope)) : null
  return { scope, timer: raw ? restoreFocus(raw.timer) : initialFocus(), prefs: restorePrefs(raw?.prefs) }
}

const hasWebAudio = () => typeof window !== 'undefined' && !!(window.AudioContext ?? (window as { webkitAudioContext?: unknown }).webkitAudioContext)
const status = (e: unknown) => (e as { response?: { status?: number } })?.response?.status

export function FocusTimerProvider({ scope, children }: { scope: string | null; children: ReactNode }) {
  const [store, setStore] = useState(() => load(scope))
  if (store.scope !== scope) setStore(load(scope))            // signed in as someone else: their own timer
  const { timer, prefs } = store
  const [now, setNow] = useState(() => Date.now())
  const [panelOpen, setPanelOpen] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [engine] = useState(() => new FocusSoundEngine())
  const quiet = useQuiet()
  const examRoute = isExamPath(useLocation().pathname)
  const examRouteRef = useRef(examRoute)
  useEffect(() => { examRouteRef.current = examRoute }, [examRoute])
  const key = scope ? storageKey('focusTimer', scope) : null
  const timerRef = useRef(timer)
  useEffect(() => { timerRef.current = timer }, [timer])
  const listeners = useRef(new Set<(r: XpResult) => void>())

  const setTimer = useCallback((f: (t: FocusTimerState) => FocusTimerState) => setStore((s) => ({ ...s, timer: f(s.timer) })), [])
  const setPrefs = useCallback((p: Partial<FocusPrefs>) => setStore((s) => ({ ...s, prefs: { ...s.prefs, ...p } })), [])

  // A session ended: chime, XP and a word of praise — once, even with several tabs open (they share the deadline).
  const finished = useCallback((done: FocusTimerState, endedAt: number) => {
    if (key) {
      const doneKey = `${key}.done`
      if (readStored<number>(doneKey) === endedAt) return     // another tab already announced this one
      writeStored(doneKey, endedAt)
    }
    const quietExam = quietNow().exam || examRouteRef.current
    if (!quietExam) engine.chime()
    const say = (text: string, tone: 'success' | 'info' | 'error' = 'success') => { if (!quietExam) toast(text, tone) }
    if (done.minutes < FOCUS_XP_MIN_MINUTES) { say('Focus session complete — nice work!'); return }
    wellnessService.activity('pomodoro', `Focus timer · ${done.minutes} min`)
      .then((r) => {
        if (listeners.current.size) { for (const l of listeners.current) l(r); return }
        say(r.capped ? 'Focus session complete! (Daily focus XP limit reached — great consistency.)'
          : r.awarded > 0 ? `Focus session complete · +${r.awarded} XP` : 'Focus session complete — nice work!')
      })
      // No Wellness profile yet (409): the session still counts for the student, there is just no XP to show.
      .catch((e: unknown) => say(status(e) === 409 ? 'Focus session complete — nice work!' : errorMessage(e, 'Could not record your focus session'),
        status(e) === 409 ? 'success' : 'error'))
  }, [engine, key])

  // Tick while running (also catches a deadline that passed during a reload or a sleeping laptop).
  const running = timer.status === 'running'
  useEffect(() => {
    if (!running) return
    const step = () => {
      const t = Date.now()
      setNow(t)
      const cur = timerRef.current
      const { state, completed } = tickFocus(cur, t)
      if (completed) {
        timerRef.current = state
        setTimer(() => state)
        finished(state, cur.endsAt ?? t)
      }
    }
    const id = window.setInterval(step, 500)
    return () => window.clearInterval(id)
  }, [running, setTimer, finished])

  // Remember it (per student) and follow the other tabs.
  useEffect(() => { if (key) writeStored(key, { timer, prefs }) }, [key, timer, prefs])
  useEffect(() => {
    if (!key) return
    const on = (e: StorageEvent) => {
      if (e.key !== key || !e.newValue) return
      try {
        const raw = JSON.parse(e.newValue) as Partial<Stored>
        setStore((s) => ({ ...s, timer: restoreFocus(raw.timer), prefs: restorePrefs(raw.prefs) }))
        setNow(Date.now())
      } catch { /* not ours */ }
    }
    window.addEventListener('storage', on)
    return () => window.removeEventListener('storage', on)
  }, [key])

  // Ambient sound: only while the timer runs, never during an exam or a classroom session, and not after sign-out.
  const wantSound = !!scope && running && !!prefs.sound && !quiet.session && !examRoute
  useEffect(() => {
    if (wantSound && unlocked && prefs.sound) engine.play(prefs.sound)
    else engine.stop()
  }, [engine, wantSound, unlocked, prefs.sound])
  useEffect(() => { engine.setVolume(prefs.volume); engine.setMuted(prefs.muted) }, [engine, prefs.volume, prefs.muted])
  useEffect(() => () => engine.dispose(), [engine])
  // After a reload the browser needs a fresh gesture before it plays sound: the first click or key press resumes it.
  useEffect(() => {
    if (!wantSound || unlocked) return
    const on = () => { if (engine.unlock()) setUnlocked(true) }
    window.addEventListener('pointerdown', on, { once: true })
    window.addEventListener('keydown', on, { once: true })
    return () => { window.removeEventListener('pointerdown', on); window.removeEventListener('keydown', on) }
  }, [wantSound, unlocked, engine])

  const unlock = useCallback(() => { if (engine.unlock()) setUnlocked(true) }, [engine])
  const onXp = useCallback((h: (r: XpResult) => void) => { listeners.current.add(h); return () => { listeners.current.delete(h) } }, [])

  const api = useMemo<FocusTimerApi>(() => ({
    timer, prefs, remainingMs: focusRemaining(timer, now), audioAvailable: hasWebAudio(), panelOpen,
    openPanel: () => setPanelOpen(true),
    closePanel: () => setPanelOpen(false),
    togglePanel: () => setPanelOpen((o) => !o),
    start: () => { unlock(); const t = Date.now(); setNow(t); setTimer((s) => startFocus(s, t)) },
    pause: () => { const t = Date.now(); setNow(t); setTimer((s) => pauseFocus(s, t)) },
    reset: () => setTimer(resetFocus),
    setMinutes: (m) => setTimer((s) => setFocusMinutes(s, m)),
    chooseSound: (id) => { if (id) unlock(); setPrefs({ sound: id }) },
    setVolume: (v) => setPrefs({ volume: Math.min(1, Math.max(0, v)), ...(v > 0 ? { muted: false } : {}) }),
    toggleMute: () => setPrefs({ muted: !prefs.muted }),
    onXp,
  }), [timer, prefs, now, panelOpen, unlock, setTimer, setPrefs, onXp])

  return <Ctx.Provider value={scope ? api : null}>{children}</Ctx.Provider>
}
