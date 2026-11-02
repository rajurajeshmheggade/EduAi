import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, OctagonX, Play, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ErrorState, PageLoader } from '@/components/ui/loading'
import { ProctorMedia } from '@/lib/proctor/media'
import { type LocalFlag, type MonitorHud, StudentProctorMonitor } from '@/lib/proctor/student/monitor'
import { useQuietHold } from '@/lib/studyFlow/quiet'
import { useAsync } from '@/lib/useAsync'
import { errorMessage } from '@/services/apiClient'
import { type ProctorModule, type ProctorWarning, proctoringService, type StudentSession, type StudentStatus } from '@/services/proctoringService'
import { type BeginResult, PreExamWindow } from './PreExamWindow'
import { ProctorHud } from './ProctorHud'
import { ProctorContext, type ProctorContextValue } from './proctorContext'

type Phase = 'idle' | 'opening' | 'prep' | 'active' | 'ended' | 'unproctored'

/**
 * One gate for every proctored student flow (Online Tests, Virtual Labs, AI Classroom). Start -> the full-screen
 * preparation window (rules + acknowledgement, device checks) -> the module's own start (`onBegin`) -> the session runs
 * (monitor + HUD) around `children`. Leaving the page interrupts the session (or closes an AI Classroom session);
 * a teacher can warn the student or end the session. When proctoring is switched off for the module the gate only
 * asks for the start click (or, when resuming, renders the exam straight away).
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
  const [media] = useState(() => new ProctorMedia())
  const [hud, setHud] = useState<MonitorHud | null>(null)
  const [flags, setFlags] = useState<LocalFlag[]>([])
  const [warnings, setWarnings] = useState<ProctorWarning[]>([])
  const session = useRef<StudentSession | null>(null)      // for callbacks; `current` mirrors it for rendering
  const [current, setCurrent] = useState<StudentSession | null>(null)
  const monitor = useRef<StudentProctorMonitor | null>(null)
  const finished = useRef(false)
  const opened = useRef(false)
  const closeReason = module === 'AI_CLASSROOM' ? 'closed' : 'left'
  const onEndedRef = useRef(onEnded)
  useEffect(() => { onEndedRef.current = onEnded }, [onEnded])

  const stopSensing = useCallback(() => {
    monitor.current?.stop()
    media.stop()
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {})
  }, [media])

  const onStatus = useCallback((s: StudentStatus) => {
    if (s.warnings?.length) setWarnings((cur) => { const ids = new Set(cur.map((w) => w.action_id)); return [...cur, ...s.warnings.filter((w) => !ids.has(w.action_id))] })
    if (s.ended && !finished.current) {
      finished.current = true
      stopSensing()
      setPhase('ended')
      onEndedRef.current?.()
    }
  }, [stopSensing])

  const open = useCallback(async () => {
    setError(null); setPhase('opening')
    try {
      session.current = await proctoringService.prepare(module, refId)
      setCurrent(session.current)
      finished.current = false
      setPhase('prep')
    } catch (e) { setError(errorMessage(e)); setPhase('idle') }
  }, [module, refId])

  useEffect(() => {
    if (autoOpen && cfg.data?.enabled && !opened.current) { opened.current = true; void open() }
  }, [autoOpen, cfg.data, open])

  // Leaving the page (route change) while the session runs: interrupted, or closed for an AI Classroom session.
  useEffect(() => () => {
    const s = session.current
    stopSensing()
    if (s && !finished.current) { finished.current = true; void proctoringService.finish(s.session_id, closeReason).catch(() => {}) }
  }, [stopSensing, closeReason])

  async function begin(r: BeginResult) {
    const s = session.current
    if (!s || !cfg.data) return
    await onBegin?.()                         // the module's own start (e.g. the timed attempt); errors stay in the window
    const started = await proctoringService.start(s.session_id, { acknowledged: true, rules_version: cfg.data.rules_version, checks: r.checks,
      camera_label: r.cameraLabel, mic_label: r.micLabel })
    session.current = started
    setCurrent(started)
    const m = new StudentProctorMonitor({
      media, rules: started.client_rules, lastSeq: started.last_seq, baseline: r.baseline,
      send: (events) => proctoringService.events(started.session_id, events),
      heartbeat: (h) => proctoringService.heartbeat(started.session_id, h),
      onUnload: (pending) => { if (!finished.current) { finished.current = true; proctoringService.finishOnUnload(started.session_id, closeReason, pending) } },
      onHud: setHud, onFlag: (f) => setFlags((x) => [...x.slice(-49), f]), onStatus,
    })
    monitor.current = m
    m.start()
    setPhase('active')
  }

  function cancel() {
    const s = session.current
    stopSensing()
    if (s && !finished.current) { finished.current = true; void proctoringService.finish(s.session_id, closeReason).catch(() => {}) }
    session.current = null
    setCurrent(null)
    setPhase('idle')
    onCancel?.()
  }

  async function startUnproctored() {
    setError(null); setPhase('opening')
    try { await onBegin?.(); setPhase('unproctored') } catch (e) { setError(errorMessage(e)); setPhase('idle') }
  }

  const finish = useCallback(async (reason: 'submitted' | 'closed') => {
    const s = session.current
    if (!s || finished.current) return
    finished.current = true
    const m = monitor.current
    m?.stop()
    await m?.flush().catch(() => {})
    stopSensing()
    await proctoringService.finish(s.session_id, reason).catch(() => {})
  }, [stopSensing])

  // The student study flow (floating focus timer, break reminders) never interrupts an exam or a lab attempt, and the
  // floating timer steps aside during a classroom session.
  const running = phase === 'opening' || phase === 'prep' || phase === 'active' || phase === 'unproctored' || (cfg.data?.enabled === false && resume && phase === 'idle')
  useQuietHold(running, module === 'AI_CLASSROOM' ? 'session' : 'exam')

  const allowAway = useCallback((reason: string) => monitor.current?.allowAway(reason), [])
  const ctx = useMemo<ProctorContextValue>(() => ({ active: phase === 'active', sessionId: current?.session_id ?? null, finish, allowAway }),
    [phase, current, finish, allowAway])

  if (cfg.loading && !cfg.data) return <PageLoader message="Getting the exam ready…" />
  if (cfg.error || !cfg.data) return <div className="mx-auto max-w-3xl p-4 md:p-8"><ErrorState title="Could not load the proctoring settings" message={cfg.error ?? 'Try again'} onRetry={cfg.retry} /></div>
  const rules = cfg.data.client_rules
  // Proctoring switched off: no preparation window, and resuming goes straight back into the exam.
  const unproctored = phase === 'unproctored' || (!cfg.data.enabled && resume && phase === 'idle')

  if (phase === 'active' || unproctored) {
    return (
      <ProctorContext.Provider value={ctx}>
        {children}
        {phase === 'active' && (
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
          <h2 className="font-display text-xl font-semibold text-fg">Your teacher ended this session</h2>
          <p className="text-sm text-ink-300">{module === 'AI_CLASSROOM' ? 'You can start a new classroom session later.' : 'What you saved so far has been handed in. Speak to your teacher if you think this is a mistake.'}</p>
          <Link to="/student/dashboard" className="inline-block text-sm font-medium text-brand-600 hover:underline">Go to my dashboard</Link>
        </Card>
      </div>
    )
  }

  const proctored = cfg.data.enabled
  return (
    <>
      {phase === 'prep' && current && (
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
