import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, OctagonX, Play, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ErrorState, PageLoader } from '@/components/ui/loading'
import { ProctorMedia } from '@/lib/proctor/media'
import { type LocalFlag, type MonitorHud, sessionOver, StudentProctorMonitor } from '@/lib/proctor/student/monitor'
import { useAsync } from '@/lib/useAsync'
import { errorMessage } from '@/services/apiClient'
import { type ProctorModule, type ProctorStatus, type ProctorWarning, proctoringService, type StudentSession, type StudentStatus } from '@/services/proctoringService'
import { type BeginResult, PreExamWindow } from './PreExamWindow'
import { ProctorHud } from './ProctorHud'
import { ProctorContext, type ProctorContextValue } from './proctorContext'

/** `finished`: handed in / closed by the module itself — the exam stays on screen without any proctoring around it. */
type Phase = 'idle' | 'opening' | 'prep' | 'active' | 'finished' | 'ended' | 'unproctored'

/**
 * One gate for every proctored student flow (Online Tests, Virtual Labs, AI Classroom). Start -> the full-screen
 * preparation window (rules + acknowledgement, device checks) -> the module's own start (`onBegin`) -> the session runs
 * (monitor + HUD) around `children`. Leaving the page interrupts the session (or closes an AI Classroom session);
 * a teacher can warn the student or end the session. When proctoring is switched off for the module the gate only
 * asks for the start click (or, when resuming, renders the exam straight away).
 *
 * Ownership: each session gets its own ProctorMedia (created when the preparation window opens). However the session
 * ends — handed in, time up, ended by a teacher or the server, cancelled, the page left, an error — `stopSensing`
 * switches everything off at once: every camera / microphone track, the audio analyser, the detection worker, the
 * monitor's timers, heartbeat and listeners, and full screen; the HUD, preview and warning overlays go with the phase.
 */
export function ProctorGate({ module, refId, title, autoOpen = false, resume = false, startLabel = 'Start', beginLabel, beginNote, intro, onBegin, onCancel, onEnded, children }: {
  module: ProctorModule
  refId: string
  title: string
  /** The student already clicked Start on the previous screen: open the preparation window at once. */
  autoOpen?: boolean
  /** The exam is already under way (reload / coming back): the preparation is a resume. */
  resume?: boolean
  startLabel?: string
  beginLabel?: string
  beginNote?: string
  intro?: ReactNode
  onBegin?: () => Promise<void>
  onCancel?: () => void
  onEnded?: () => void
  children: ReactNode
}) {
  const cfg = useAsync(() => proctoringService.config(module), [module])
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [media, setMedia] = useState<ProctorMedia | null>(null)
  const mediaRef = useRef<ProctorMedia | null>(null)          // for callbacks and the unmount clean-up
  const [hud, setHud] = useState<MonitorHud | null>(null)
  const [flags, setFlags] = useState<LocalFlag[]>([])
  const [warnings, setWarnings] = useState<ProctorWarning[]>([])
  const [endedBy, setEndedBy] = useState<ProctorStatus | null>(null)
  const session = useRef<StudentSession | null>(null)      // for callbacks; `current` mirrors it for rendering
  const [current, setCurrent] = useState<StudentSession | null>(null)
  const monitor = useRef<StudentProctorMonitor | null>(null)
  const finished = useRef(false)
  const opened = useRef(false)
  const alive = useRef(true)
  const closeReason = module === 'AI_CLASSROOM' ? 'closed' : 'left'
  const onEndedRef = useRef(onEnded)
  useEffect(() => { onEndedRef.current = onEnded }, [onEnded])

  /** Switches every proctoring device and sensor off. Synchronous and idempotent: safe from any end path. */
  const stopSensing = useCallback(() => {
    monitor.current?.stop()
    mediaRef.current?.stop()
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {})
  }, [])

  /** Closes the server session once the flags still queued (and a heartbeat on its way) are through. */
  const closeSession = useCallback((s: StudentSession, reason: 'submitted' | 'left' | 'closed'): Promise<void> => {
    const m = monitor.current
    const close = () => proctoringService.finish(s.session_id, reason).then(() => {}, () => {})
    return m ? m.settle().then(close) : close()
  }, [])

  const onStatus = useCallback((s: StudentStatus) => {
    if (finished.current) return
    if (s.warnings?.length) setWarnings((cur) => { const ids = new Set(cur.map((w) => w.action_id)); return [...cur, ...s.warnings.filter((w) => !ids.has(w.action_id))] })
    if (sessionOver(s)) {
      // Ended by a teacher, or handed in / closed somewhere else: nothing more to report, everything off.
      finished.current = true
      stopSensing()
      setEndedBy(s.status)
      setPhase('ended')
      onEndedRef.current?.()
    }
  }, [stopSensing])

  const open = useCallback(async () => {
    setError(null); setPhase('opening')
    try {
      const s = await proctoringService.prepare(module, refId)
      if (!alive.current) { void proctoringService.finish(s.session_id, closeReason).catch(() => {}); return }
      session.current = s
      setCurrent(s)
      finished.current = false
      monitor.current = null
      mediaRef.current?.stop()
      const m = new ProctorMedia()                            // a fresh one per session: a stopped one never reopens
      mediaRef.current = m
      setMedia(m)
      setPhase('prep')
    } catch (e) { setError(errorMessage(e)); setPhase('idle') }
  }, [module, refId, closeReason])

  useEffect(() => {
    if (autoOpen && cfg.data?.enabled && !opened.current) { opened.current = true; void open() }
  }, [autoOpen, cfg.data, open])

  // Leaving the page (route change) while the session runs: interrupted, or closed for an AI Classroom session.
  useEffect(() => {
    alive.current = true                                      // StrictMode (dev) runs this clean-up once at mount
    return () => {
      alive.current = false
      const s = session.current
      stopSensing()
      if (s && !finished.current) { finished.current = true; void closeSession(s, closeReason) }
    }
  }, [stopSensing, closeSession, closeReason])

  async function begin(r: BeginResult) {
    const s = session.current
    const m = mediaRef.current
    if (!s || !cfg.data || !m) return
    await onBegin?.()                         // the module's own start (e.g. the timed attempt); errors stay in the window
    const started = await proctoringService.start(s.session_id, { acknowledged: true, rules_version: cfg.data.rules_version, checks: r.checks,
      camera_label: r.cameraLabel, mic_label: r.micLabel })
    // Left the page or cancelled while the exam was starting: nothing may start sensing after the teardown.
    if (!alive.current || finished.current || m.closed || mediaRef.current !== m) return
    session.current = started
    setCurrent(started)
    const mon = new StudentProctorMonitor({
      media: m, rules: started.client_rules, lastSeq: started.last_seq, baseline: r.baseline,
      send: (events) => proctoringService.events(started.session_id, events),
      heartbeat: (h) => proctoringService.heartbeat(started.session_id, h),
      onUnload: (pending) => {
        stopSensing()
        if (!finished.current) { finished.current = true; proctoringService.finishOnUnload(started.session_id, closeReason, pending) }
      },
      onHud: setHud, onFlag: (f) => setFlags((x) => [...x.slice(-49), f]), onStatus,
    })
    monitor.current = mon
    mon.start()
    setPhase('active')
  }

  function cancel() {
    const s = session.current
    stopSensing()
    if (s && !finished.current) { finished.current = true; void closeSession(s, closeReason) }
    session.current = null
    setCurrent(null)
    mediaRef.current = null
    setMedia(null)
    setPhase('idle')
    onCancel?.()
  }

  async function startUnproctored() {
    setError(null); setPhase('opening')
    try { await onBegin?.(); setPhase('unproctored') } catch (e) { setError(errorMessage(e)); setPhase('idle') }
  }

  const finish = useCallback(async (reason: 'submitted' | 'closed') => {
    const s = session.current
    // Devices off first, at once — sending what is left and closing the session can wait for the network.
    stopSensing()
    setPhase((p) => (p === 'active' ? 'finished' : p))
    if (!s || finished.current) return
    finished.current = true
    await closeSession(s, reason)
  }, [stopSensing, closeSession])

  const allowAway = useCallback((reason: string) => monitor.current?.allowAway(reason), [])
  const ctx = useMemo<ProctorContextValue>(() => ({ active: phase === 'active', sessionId: current?.session_id ?? null, finish, allowAway }),
    [phase, current, finish, allowAway])

  if (cfg.loading && !cfg.data) return <PageLoader message="Getting the exam ready…" />
  if (cfg.error || !cfg.data) return <div className="mx-auto max-w-3xl p-4 md:p-8"><ErrorState title="Could not load the proctoring settings" message={cfg.error ?? 'Try again'} onRetry={cfg.retry} /></div>
  const rules = cfg.data.client_rules
  // Proctoring switched off: no preparation window, and resuming goes straight back into the exam.
  const unproctored = phase === 'unproctored' || (!cfg.data.enabled && resume && phase === 'idle')

  if (phase === 'active' || phase === 'finished' || unproctored) {
    return (
      <ProctorContext.Provider value={ctx}>
        {children}
        {phase === 'active' && media && (
          <ProctorHud hud={hud} media={media} flags={flags} warnings={warnings} fullscreenRequired={rules.fullscreen_required}
            cameraRequired={rules.camera_required} micRequired={rules.mic_required}
            onAck={async (w) => { await proctoringService.ackWarning(current!.session_id, w.action_id); setWarnings((x) => x.filter((y) => y.action_id !== w.action_id)) }}
            onReconnectCamera={async () => { await monitor.current?.restartCamera(media.cameraDeviceId() ?? undefined) }}
            onReconnectMic={async () => { await monitor.current?.restartMic(media.micDeviceId() ?? undefined) }} />
        )}
      </ProctorContext.Provider>
    )
  }

  if (phase === 'ended') {
    return (
      <div className="mx-auto max-w-xl p-4 md:p-8">
        <Card className="space-y-3 p-6 text-center" role="alert">
          <OctagonX className="mx-auto h-10 w-10 text-bad" />
          <h2 className="font-display text-xl font-semibold text-fg">{endedBy === 'ENDED_BY_TEACHER' ? 'Your teacher ended this session' : 'This session has ended'}</h2>
          <p className="text-sm text-ink-300">{module === 'AI_CLASSROOM' ? 'You can start a new classroom session later.'
            : endedBy === 'ENDED_BY_TEACHER' ? 'What you saved so far has been handed in. Speak to your teacher if you think this is a mistake.'
              : 'It was handed in or closed — on this device or another one. Your camera and microphone are now off.'}</p>
          <Link to="/student/dashboard" className="inline-block text-sm font-medium text-brand-600 hover:underline">Go to my dashboard</Link>
        </Card>
      </div>
    )
  }

  const proctored = cfg.data.enabled
  return (
    <>
      {phase === 'prep' && current && media && (
        <PreExamWindow config={cfg.data} media={media} title={title} resume={resume || current.resumed} beginLabel={beginLabel} beginNote={beginNote}
          onCancel={cancel} onBegin={begin} />
      )}
      <div className="mx-auto max-w-3xl p-4 md:p-8">
        <Card className="space-y-4 p-6">
          {intro}
          {proctored && (
            <p className="flex items-start gap-2 rounded-xl bg-brand-500/5 p-3 text-sm text-ink-300">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
              <span>This {module === 'AI_CLASSROOM' ? 'classroom session' : 'exam'} is proctored on your device. You will see the rules and check your
                {rules.camera_required ? ' camera' : ''}{rules.mic_required ? ' and microphone' : ''} before it begins. Only flags reach your teacher — no video, photos or audio.</span>
            </p>
          )}
          {error && <ErrorState title="Could not start" message={error} />}
          <Button size="lg" className="w-full" id="proctor-start" disabled={phase === 'opening'} onClick={() => void (proctored ? open() : startUnproctored())}>
            {phase === 'opening' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />} {startLabel}
          </Button>
        </Card>
      </div>
    </>
  )
}
