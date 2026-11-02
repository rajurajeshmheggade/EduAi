import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CheckCircle2, CircleAlert, EyeOff, Loader2, Mic, RotateCcw, ScanFace, ShieldCheck, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label, Select } from '@/components/ui/field'
import { Spinner } from '@/components/ui/loading'
import { type ProctorMedia, sleep } from '@/lib/proctor/media'
import { cameraBlocked, median } from '@/lib/proctor/rules'
import { type DeviceOption, deviceOptions, type MediaHelp, mediaErrorHelp, micLevel, pickDevice } from '@/lib/proctor/student/devices'
import { beginState, CHECK_LABEL, type CheckKey, type Checks, type CheckState, faceVerdict, initialChecks, requiredChecks, startChecks, type Step } from '@/lib/proctor/student/gating'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/services/apiClient'
import { MODULE_LABEL, type ProctorConfig, type StartChecks } from '@/services/proctoringService'

export interface BeginResult { checks: StartChecks; cameraLabel: string | null; micLabel: string | null; baseline: { yaw: number; pitch: number } }

/**
 * Full-screen proctoring preparation window shown the moment a student clicks Start (spec 2.1–2.3):
 *   1. every examination rule + what is (not) captured, and the mandatory acknowledgement;
 *   2. camera / microphone permission, device choice, live preview, mic level, connection status and the face check.
 * "Begin" stays disabled until every mandatory check passes; it also enters browser full screen when required.
 * Nothing is recorded: the preview and the detectors run on this device only.
 */
export function PreExamWindow({ config, media, title, resume = false, beginLabel = 'Begin exam', beginNote, onCancel, onBegin }: {
  config: ProctorConfig
  media: ProctorMedia
  title: string
  resume?: boolean
  beginLabel?: string
  beginNote?: string
  onCancel: () => void
  onBegin: (r: BeginResult) => Promise<void>
}) {
  const rules = config.client_rules
  const [step, setStep] = useState<Step>('rules')
  const [ack, setAck] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  // Keep focus inside the window and let Esc cancel (it covers the whole page).
  useEffect(() => {
    box.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.fullscreenElement) onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, step])

  return (
    <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="prep-title" data-testid="pre-exam-window"
      className="fixed inset-0 z-[60] overflow-y-auto bg-ink-950 outline-none">
      <div className="mx-auto flex min-h-full max-w-4xl flex-col gap-5 p-4 sm:p-8">
        <header className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-500/10"><ShieldCheck className="h-6 w-6 text-brand-600" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-widest text-ink-500">
              {MODULE_LABEL[config.module]} · {resume ? 'Resume proctored session' : 'Proctoring preparation'} · Step {step === 'rules' ? 1 : 2} of 2
            </p>
            <h1 id="prep-title" className="truncate font-display text-2xl font-bold text-fg">{title}</h1>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close and go back" onClick={onCancel}><X className="h-5 w-5" /></Button>
        </header>

        {step === 'rules' ? (
          <RulesStep config={config} ack={ack} setAck={setAck} onNext={() => setStep('devices')} onCancel={onCancel} />
        ) : (
          <DeviceStep config={config} media={media} acknowledged={ack} beginLabel={beginLabel} beginNote={beginNote}
            onBack={() => setStep('rules')} onBegin={onBegin} />
        )}
        <p className="mt-auto text-center text-xs text-ink-500">Flags are signals for your teacher to review — never proof of anything on their own.
          {rules.camera_required && ' Your camera picture never leaves this device.'}</p>
      </div>
    </div>
  )
}

function RulesStep({ config, ack, setAck, onNext, onCancel }: { config: ProctorConfig; ack: boolean; setAck: (v: boolean) => void; onNext: () => void; onCancel: () => void }) {
  const n = config.notice
  return (
    <section className="space-y-5" aria-label="Examination rules">
      <div className="rounded-2xl border border-line bg-ink-900 p-5">
        <h2 className="mb-3 font-display text-lg font-semibold text-fg">Examination rules</h2>
        <ol className="space-y-2">
          {config.rules.map((r, i) => (
            <li key={r} className="flex gap-3 text-sm text-ink-100">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-500/10 text-xs font-semibold text-brand-600">{i + 1}</span>
              <span className="pt-0.5">{r}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="grid gap-4 rounded-2xl border border-line bg-ink-900 p-5 text-sm md:grid-cols-2">
        <div>
          <h2 className="mb-1.5 flex items-center gap-1.5 font-semibold text-fg"><Sparkles className="h-4 w-4 text-brand-600" /> What is recorded</h2>
          <ul className="list-disc space-y-1 pl-5 text-ink-100">{n.captured.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
        <div>
          <h2 className="mb-1.5 flex items-center gap-1.5 font-semibold text-fg"><EyeOff className="h-4 w-4 text-ok" /> What is never recorded</h2>
          <ul className="list-disc space-y-1 pl-5 text-ink-100">{n.not_captured.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
        <dl className="space-y-1 text-ink-300 md:col-span-2">
          <div><dt className="inline font-medium text-fg">Where: </dt><dd className="inline">{n.where}</dd></div>
          <div><dt className="inline font-medium text-fg">Who sees it: </dt><dd className="inline">{n.who_sees}</dd></div>
          <div><dt className="inline font-medium text-fg">How long: </dt><dd className="inline">{n.retention}</dd></div>
        </dl>
      </div>
      <label className={cn('flex cursor-pointer items-start gap-3 rounded-2xl border p-4 text-sm transition-colors', ack ? 'border-ok/40 bg-ok/5' : 'border-line bg-ink-900')}>
        <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-brand-500" checked={ack} onChange={(e) => setAck(e.target.checked)} id="rules-ack" />
        <span className="font-medium text-fg">{config.acknowledgement}</span>
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Not now</Button>
        <Button size="lg" onClick={onNext} disabled={!ack} id="rules-continue">{ack ? 'Continue to device check' : 'Tick the box to continue'}</Button>
      </div>
    </section>
  )
}

const FIX: Record<CheckKey, string> = {
  camera: 'Allow the camera for this site and make sure no other app is using it.',
  microphone: 'Allow the microphone for this site.',
  detector: 'Check your connection and try again. If it keeps failing, tell your teacher.',
  face: 'Sit in front of the camera, alone, with light on your face (not behind you).',
}

function DeviceStep({ config, media, acknowledged, beginLabel, beginNote, onBack, onBegin }: {
  config: ProctorConfig; media: ProctorMedia; acknowledged: boolean; beginLabel: string; beginNote?: string; onBack: () => void; onBegin: (r: BeginResult) => Promise<void>
}) {
  const rules = config.client_rules
  const needed = requiredChecks(rules)
  const [checks, setChecks] = useState<Checks>(initialChecks)
  const [cams, setCams] = useState<DeviceOption[]>([])
  const [mics, setMics] = useState<DeviceOption[]>([])
  const [camId, setCamId] = useState<string | null>(null)
  const [micId, setMicId] = useState<string | null>(null)
  const [help, setHelp] = useState<{ camera?: MediaHelp; microphone?: MediaHelp }>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [level, setLevel] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const preview = useRef<HTMLVideoElement>(null)
  const baseline = useRef({ yaw: 0, pitch: 0 })
  const faceRun = useRef(0)
  const set = (k: CheckKey, v: CheckState) => setChecks((c) => ({ ...c, [k]: v }))

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const all = await navigator.mediaDevices.enumerateDevices().catch(() => [])
    setCams(deviceOptions(all, 'videoinput'))
    setMics(deviceOptions(all, 'audioinput'))
  }, [])

  const checkFace = useCallback(async () => {
    const run = ++faceRun.current
    set('face', { status: 'running', detail: 'Looking for your face…' })
    let good = 0
    const poses: { yaw: number; pitch: number }[] = []
    const end = Date.now() + 30_000
    while (Date.now() < end && good < 3 && run === faceRun.current) {
      const r = await media.analyse()
      if (!r) { await sleep(200); continue }
      const v = faceVerdict(r, cameraBlocked)
      good = v.ok ? good + 1 : 0
      if (v.ok && r.pose) poses.push(r.pose)
      if (run === faceRun.current) set('face', { status: 'running', detail: v.ok ? `Good (${good}/3)` : v.hint })
      await sleep(300)
    }
    if (run !== faceRun.current) return
    if (good >= 3) {
      if (poses.length) baseline.current = { yaw: median(poses.map((p) => p.yaw)), pitch: median(poses.map((p) => p.pitch)) }
      set('face', { status: 'pass', detail: 'One face, clearly visible' })
    } else set('face', { status: 'fail', detail: 'We could not see exactly one face clearly' })
  }, [media])

  const startCamera = useCallback(async (deviceId?: string) => {
    set('camera', { status: 'running', detail: 'Asking for camera permission…' })
    setHelp((h) => ({ ...h, camera: undefined }))
    try {
      const stream = await media.startCamera(deviceId)
      if (preview.current) { preview.current.srcObject = stream; void preview.current.play?.()?.catch(() => {}) }
      setCamId(media.cameraDeviceId())
      set('camera', { status: 'pass', detail: media.cameraLabel ?? 'Camera on' })
      for (const t of stream.getVideoTracks()) t.addEventListener('ended', () => set('camera', { status: 'fail', detail: 'The camera was disconnected' }))
      await refreshDevices()   // labels become readable once permission is granted
      return true
    } catch (e) {
      set('camera', { status: 'fail', detail: mediaErrorHelp(e, 'camera').title })
      setHelp((h) => ({ ...h, camera: mediaErrorHelp(e, 'camera') }))
      set('face', { status: 'pending' })
      return false
    }
  }, [media, refreshDevices])

  const startMic = useCallback(async (deviceId?: string) => {
    set('microphone', { status: 'running', detail: 'Asking for microphone permission…' })
    setHelp((h) => ({ ...h, microphone: undefined }))
    try {
      await media.startMic(deviceId)
      setMicId(media.micDeviceId())
      for (const t of media.mic?.getAudioTracks() ?? []) t.addEventListener('ended', () => set('microphone', { status: 'fail', detail: 'The microphone was disconnected' }))
      if (rules.detect_voice) {
        set('microphone', { status: 'running', detail: 'Measuring room noise — stay quiet for 3 seconds' })
        await media.calibrateMic(3000)
      }
      set('microphone', { status: 'pass', detail: media.micLabel ?? 'Microphone on' })
      await refreshDevices()
      return true
    } catch (e) {
      set('microphone', { status: 'fail', detail: mediaErrorHelp(e, 'microphone').title })
      setHelp((h) => ({ ...h, microphone: mediaErrorHelp(e, 'microphone') }))
      return false
    }
  }, [media, refreshDevices, rules.detect_voice])

  const loadDetector = useCallback(async () => {
    set('detector', { status: 'running', detail: 'Loading on-device detection (first time can take a minute)…' })
    try {
      const backend = await media.loadModels({ embed: false, objects: rules.detect_objects })
      set('detector', { status: 'pass', detail: `Ready (${backend})` })
      return true
    } catch (e) {
      set('detector', { status: 'fail', detail: errorMessage(e, 'On-device detection could not start') })
      return false
    }
  }, [media, rules.detect_objects])

  const runAll = useCallback(async () => {
    setError(null)
    let camOk = false
    if (rules.camera_required) camOk = await startCamera()
    if (rules.mic_required) await startMic()
    if (rules.camera_required && (await loadDetector()) && camOk) await checkFace()
  }, [rules.camera_required, rules.mic_required, startCamera, startMic, loadDetector, checkFace])

  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void runAll()
  }, [runAll])

  // Live microphone level (also tells the student the right microphone is picked).
  useEffect(() => {
    if (checks.microphone.status !== 'pass' && checks.microphone.status !== 'running') return
    const t = window.setInterval(() => setLevel(micLevel(media.micDb())), 120)
    return () => window.clearInterval(t)
  }, [checks.microphone.status, media])

  // A camera / microphone plugged in or out: refresh the lists, keep the student's choice, say so when it is gone.
  useEffect(() => {
    const md = navigator.mediaDevices
    if (!md?.addEventListener) return
    const onChange = async () => {
      const all = await md.enumerateDevices().catch(() => [])
      const c = deviceOptions(all, 'videoinput')
      const m = deviceOptions(all, 'audioinput')
      setCams(c)
      setMics(m)
      if (rules.camera_required && camId) {
        const p = pickDevice(c, camId, media.cameraDeviceId())
        if (p.lost) {
          setNotice('The camera you chose was disconnected. Switched to another one — check the preview.')
          if (p.id && (await startCamera(p.id))) void checkFace()
        }
      }
      if (rules.mic_required && micId) {
        const p = pickDevice(m, micId, media.micDeviceId())
        if (p.lost) {
          setNotice('The microphone you chose was disconnected. Switched to another one.')
          if (p.id) await startMic(p.id)
        }
      }
    }
    md.addEventListener('devicechange', onChange)
    return () => md.removeEventListener('devicechange', onChange)
  }, [camId, micId, media, rules.camera_required, rules.mic_required, startCamera, startMic, checkFace])

  async function chooseCamera(id: string) {
    setNotice(null)
    faceRun.current++
    if (await startCamera(id)) {
      if (checks.detector.status === 'pass') void checkFace()
    }
  }

  async function chooseMic(id: string) {
    setNotice(null)
    await startMic(id)
  }

  const fullscreenSupported = !rules.fullscreen_required || typeof document.documentElement.requestFullscreen === 'function'
  const gate = beginState(rules, acknowledged, checks, fullscreenSupported)

  async function begin() {
    setBusy(true); setError(null)
    try {
      if (rules.fullscreen_required && !document.fullscreenElement) {
        try { await document.documentElement.requestFullscreen() } catch {
          throw new Error('This exam must run in full screen. Allow full screen when the browser asks, then press Begin again.')
        }
      }
      await onBegin({ checks: startChecks(checks, !!document.fullscreenElement || !rules.fullscreen_required),
        cameraLabel: media.cameraLabel, micLabel: rules.mic_required ? media.micLabel : null, baseline: baseline.current })
    } catch (e) {
      setError(errorMessage(e))
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {})
    } finally { setBusy(false) }
  }

  return (
    <section className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]" aria-label="Device check">
      <div className="space-y-4">
        {rules.camera_required && (
          <div className="overflow-hidden rounded-2xl border border-line bg-black">
            <div className="relative">
              <video ref={preview} muted playsInline autoPlay aria-label="Your camera preview (stays on this device)" className="aspect-video w-full -scale-x-100 object-cover" />
              {checks.camera.status !== 'pass' && (
                <div className="absolute inset-0 grid place-items-center text-sm text-white/80">
                  {checks.camera.status === 'running' ? <Spinner label="Starting the camera" /> : <Camera className="h-8 w-8" aria-hidden />}
                </div>
              )}
              <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white">Preview only · not recorded</span>
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {rules.camera_required && (
            <div>
              <Label htmlFor="cam-select">Camera</Label>
              <Select id="cam-select" value={camId ?? ''} disabled={!cams.length || checks.camera.status === 'running'} onChange={(e) => void chooseCamera(e.target.value)}>
                {!cams.length && <option value="">No camera found yet</option>}
                {cams.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </Select>
            </div>
          )}
          {rules.mic_required && (
            <div>
              <Label htmlFor="mic-select">Microphone</Label>
              <Select id="mic-select" value={micId ?? ''} disabled={!mics.length || checks.microphone.status === 'running'} onChange={(e) => void chooseMic(e.target.value)}>
                {!mics.length && <option value="">No microphone found yet</option>}
                {mics.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </Select>
              <div className="mt-2 flex items-center gap-2" aria-hidden>
                <Mic className="h-3.5 w-3.5 text-ink-500" />
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-700"><div className="h-full rounded-full bg-ok transition-[width] duration-100" style={{ width: `${Math.round(level * 100)}%` }} /></div>
              </div>
              <p className="mt-1 text-[11px] text-ink-500">Speak — the bar should move. Only a loudness level is used; nothing is recorded.</p>
            </div>
          )}
        </div>
        {notice && <p role="status" className="rounded-xl border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-ink-100">{notice}</p>}
        {(['camera', 'microphone'] as const).map((k) => help[k] && (
          <div key={k} role="alert" className="rounded-2xl border border-bad/30 bg-bad/5 p-4 text-sm">
            <p className="flex items-center gap-2 font-semibold text-fg"><CircleAlert className="h-4 w-4 text-bad" /> {help[k]!.title}</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-300">{help[k]!.steps.map((s) => <li key={s}>{s}</li>)}</ol>
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => void (k === 'camera' ? startCamera(camId ?? undefined).then((ok) => { if (ok && checks.detector.status === 'pass') void checkFace() }) : startMic(micId ?? undefined))}>
              <RotateCcw className="h-3.5 w-3.5" /> Try again
            </Button>
          </div>
        ))}
      </div>

      <div className="space-y-4">
        <ul className="space-y-2" aria-label="Mandatory checks">
          {needed.length === 0 && <li className="rounded-xl border border-line bg-ink-900 px-3 py-2 text-sm text-ink-300">No device checks are needed for this session.</li>}
          {needed.map((k) => {
            const c = checks[k]
            return (
              <li key={k} className="rounded-xl border border-line bg-ink-900 px-3 py-2" data-check={k} data-status={c.status}>
                <div className="flex items-center gap-2 text-sm">
                  {c.status === 'pass' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" aria-label="Passed" />
                    : c.status === 'fail' ? <CircleAlert className="h-4 w-4 shrink-0 text-bad" aria-label="Failed" />
                      : <Loader2 className={cn('h-4 w-4 shrink-0 text-ink-500', c.status === 'running' && 'animate-spin')} aria-label="Checking" />}
                  <span className="font-medium text-fg">{CHECK_LABEL[k]}</span>
                </div>
                {c.detail && <p className="mt-0.5 pl-6 text-xs text-ink-500">{c.detail}</p>}
                {c.status === 'fail' && <p className="mt-0.5 pl-6 text-xs text-warn">{FIX[k]}</p>}
              </li>
            )
          })}
        </ul>
        {rules.camera_required && checks.detector.status === 'fail' && (
          <Button variant="secondary" className="w-full" onClick={() => void loadDetector().then((ok) => { if (ok && checks.camera.status === 'pass') void checkFace() })}>
            <RotateCcw className="h-4 w-4" /> Retry detection
          </Button>
        )}
        {rules.camera_required && checks.face.status === 'fail' && checks.detector.status === 'pass' && (
          <Button variant="secondary" className="w-full" onClick={() => void checkFace()}><ScanFace className="h-4 w-4" /> Check my face again</Button>
        )}
        {rules.fullscreen_required && <p className="rounded-xl bg-brand-500/5 px-3 py-2 text-xs text-ink-300">The exam opens in full screen. Leaving full screen is recorded as a flag.</p>}
        {beginNote && <p className="rounded-xl bg-ink-800 px-3 py-2 text-xs text-ink-300">{beginNote}</p>}
        {!gate.ready && (
          <ul className="space-y-0.5 text-xs text-ink-500" aria-label="Still needed">{gate.blocking.map((b) => <li key={b.key}>• {b.message}</li>)}</ul>
        )}
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onBack}>Back</Button>
          <Button size="lg" className="flex-1" disabled={!gate.ready || busy} onClick={() => void begin()} id="begin-exam">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShieldCheck className="h-5 w-5" />} {gate.ready ? beginLabel : 'Complete the checks'}
          </Button>
        </div>
      </div>
    </section>
  )
}
