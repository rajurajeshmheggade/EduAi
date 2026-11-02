import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, CircleAlert, Loader2, MonitorUp, RotateCcw, Stethoscope } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StepCard } from '@/components/exam/ExamSteps'
import { exam, type ExamView, type SystemCheck as Payload } from '@/lib/proctor/examApi'
import { ScreenSurfaceError, sleep, type ProctorMedia } from '@/lib/proctor/media'
import { cameraBlocked, isVirtualCamera, luminance, median } from '@/lib/proctor/rules'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/services/apiClient'

type Key = 'secure' | 'screens' | 'camera' | 'mic' | 'models' | 'face' | 'network' | 'screen' | 'fullscreen'
type State = { status: 'idle' | 'running' | 'pass' | 'fail'; detail?: string }
const LABEL: Record<Key, string> = {
  secure: 'Secure connection', screens: 'Single screen', camera: 'Camera', mic: 'Microphone (quiet room)', models: 'Proctoring models',
  face: 'Your face', network: 'Network', screen: 'Entire-screen sharing', fullscreen: 'Full screen',
}
const FIX: Record<Key, string> = {
  secure: 'Open EduAI over https (ask your teacher).', screens: 'Disconnect the second monitor or projector, then wait a moment.',
  camera: 'Allow the camera in the address bar, close other apps using it, uncover it and switch on the light.',
  mic: 'Allow the microphone in the address bar.', models: 'Reload the page; if it keeps failing, ask your teacher.',
  face: 'Sit centred in front of the camera, alone, in good light.', network: 'Move closer to the Wi-Fi or ask your teacher.',
  screen: 'Click "Share entire screen" and pick your whole screen — not a tab or a window.', fullscreen: 'Click "Enter full screen".',
}

/** Live pass / fail checklist before the test (also re-run after a reload to resume proctoring). */
export function SystemCheck({ view, media, resume, onDone }: {
  view: ExamView
  media: ProctorMedia
  resume?: boolean
  onDone: (v: ExamView | null, baseline: { yaw: number; pitch: number }) => void
}) {
  const needCam = view.rules.require_camera
  const needScreen = view.rules.require_screen_share
  const keys: Key[] = (['secure', 'screens', 'camera', 'mic', 'models', 'face', 'network', 'screen', 'fullscreen'] as Key[])
    .filter((k) => (needCam || !['camera', 'face'].includes(k)) && (needScreen || k !== 'screen'))
  const [s, setS] = useState<Record<Key, State>>(() => Object.fromEntries(keys.map((k) => [k, { status: 'idle' }])) as Record<Key, State>)
  const [micProgress, setMicProgress] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const baseline = useRef({ yaw: 0, pitch: 0 })
  const network = useRef<number | null>(null)
  const started = useRef(false)
  const preview = useRef<HTMLVideoElement>(null)
  const set = (k: Key, v: State) => setS((x) => ({ ...x, [k]: v }))
  // Unmounted (or proctoring ended): checks still running stop here and open no further device.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    const v = preview.current
    return () => {
      alive.current = false
      if (v) v.srcObject = null
    }
  }, [])
  const running = useCallback(() => alive.current && !media.closed, [media])

  const checkFace = useCallback(async () => {
    set('face', { status: 'running', detail: 'Looking for your face…' })
    let good = 0
    const poses: { yaw: number; pitch: number }[] = []
    const end = performance.now() + 30_000
    while (performance.now() < end && good < 3 && running()) {
      const r = await media.analyse()
      if (!r) { await sleep(150); continue }
      const ok = r.faces === 1 && r.centred && !cameraBlocked(r.luma)
      good = ok ? good + 1 : 0
      if (ok && r.pose) poses.push(r.pose)
      set('face', { status: 'running', detail: r.faces === 0 ? 'No face yet — face the camera' : r.faces > 1 ? 'Only you should be in view' : !r.centred ? 'Move to the centre of the picture' : cameraBlocked(r.luma) ? 'It is too dark' : `Good (${good}/3)` })
      await sleep(250)
    }
    if (!running()) return
    if (good >= 3) {
      baseline.current = { yaw: median(poses.map((p) => p.yaw)), pitch: median(poses.map((p) => p.pitch)) }
      set('face', { status: 'pass', detail: 'One face, centred and lit' })
    } else set('face', { status: 'fail', detail: 'We could not see exactly one face clearly' })
  }, [media, running])

  const runAuto = useCallback(async () => {
    set('secure', window.isSecureContext ? { status: 'pass' } : { status: 'fail', detail: 'Not a secure (https) page' })
    const ext = (window.screen as Screen & { isExtended?: boolean }).isExtended
    set('screens', ext ? { status: 'fail', detail: 'A second screen is connected' } : { status: 'pass', detail: ext === undefined ? 'Not reported by this browser' : 'One screen' })
    set('fullscreen', document.fullscreenElement ? { status: 'pass' } : { status: 'fail', detail: 'Not in full screen' })
    if (needCam) {
      set('camera', { status: 'running' })
      try {
        await media.startCamera()
        if (preview.current && media.camera) { preview.current.srcObject = media.camera; void preview.current.play().catch(() => {}) }
        const c = document.createElement('canvas')
        c.width = 64
        c.height = 48
        const g = c.getContext('2d', { willReadFrequently: true })!
        g.drawImage(media.camVideo, 0, 0, 64, 48)
        const l = luminance(g.getImageData(0, 0, 64, 48).data)
        if (isVirtualCamera(media.cameraLabel)) set('camera', { status: 'fail', detail: `“${media.cameraLabel}” looks like a virtual camera. Use the built-in camera.` })
        else if (cameraBlocked(l)) set('camera', { status: 'fail', detail: 'The picture is dark or covered' })
        else set('camera', { status: 'pass', detail: media.cameraLabel ?? 'Camera on' })
      } catch (e) { set('camera', { status: 'fail', detail: errorMessage(e, 'Camera not available') }) }
    }
    if (!running()) return
    set('mic', { status: 'running', detail: 'Measuring room noise — stay quiet for 5 seconds' })
    try {
      await media.startMic()
      const floor = await media.calibrateMic(5000, setMicProgress)
      set('mic', { status: 'pass', detail: `Room noise ${Math.round(floor)} dB` })
    } catch (e) { set('mic', { status: 'fail', detail: errorMessage(e, 'Microphone not available') }) }
    if (!running()) return
    set('models', { status: 'running', detail: 'Loading on-device models…' })
    try {
      const backend = await media.loadModels({ embed: needCam, objects: needCam })
      set('models', { status: 'pass', detail: `Ready (${backend})` })
    } catch (e) { set('models', { status: 'fail', detail: errorMessage(e) }) }
    if (needCam && media.modelsReady && media.camera) await checkFace()
    if (!running()) return
    set('network', { status: 'running' })
    const times: number[] = []
    for (let i = 0; i < 3; i++) {
      const t = performance.now()
      try { await exam.ping(); times.push(performance.now() - t) } catch { /* counted as missing */ }
    }
    network.current = times.length ? Math.round(median(times)) : null
    set('network', network.current !== null && network.current < 800 ? { status: 'pass', detail: `${network.current} ms` } : { status: 'fail', detail: network.current === null ? 'No connection' : `${network.current} ms (slow)` })
  }, [media, needCam, checkFace, running])

  useEffect(() => {
    if (started.current) return
    started.current = true
    void runAuto()
  }, [runAuto])

  // live re-checks: full screen and second monitor
  useEffect(() => {
    const t = setInterval(() => {
      setS((x) => ({ ...x, fullscreen: document.fullscreenElement ? { status: 'pass' } : { status: 'fail', detail: 'Not in full screen' },
        screens: (window.screen as Screen & { isExtended?: boolean }).isExtended ? { status: 'fail', detail: 'A second screen is connected' } : x.screens.status === 'fail' ? { status: 'pass', detail: 'One screen' } : x.screens }))
    }, 1000)
    return () => clearInterval(t)
  }, [])

  async function share() {
    set('screen', { status: 'running' })
    try { await media.startScreen(); set('screen', { status: 'pass', detail: 'Entire screen shared' }) }
    catch (e) { set('screen', { status: 'fail', detail: e instanceof ScreenSurfaceError ? e.message : errorMessage(e, 'Screen sharing was cancelled') }) }
  }

  const all = keys.every((k) => s[k].status === 'pass')
  async function next() {
    setBusy(true); setError(null)
    const payload: Payload = {
      secure_context: window.isSecureContext, screens_extended: (window.screen as Screen & { isExtended?: boolean }).isExtended ?? null,
      camera: s.camera?.status === 'pass', camera_label: media.cameraLabel, virtual_camera_suspected: isVirtualCamera(media.cameraLabel),
      microphone: s.mic.status === 'pass', face_ok: needCam ? s.face?.status === 'pass' : true, screen_surface: media.screenSurface,
      fullscreen: !!document.fullscreenElement, network_ms: network.current, models_ready: media.modelsReady,
      browser: navigator.userAgent.slice(0, 200), screen: `${window.screen.width}×${window.screen.height}`,
    }
    try { onDone(resume ? null : await exam.systemCheck(payload), baseline.current) } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <StepCard icon={Stethoscope} step={resume ? 'Resuming your test' : 'Step 3 of 5'} title={resume ? 'Reconnect proctoring' : 'System check'}>
      <div className="grid gap-4 md:grid-cols-[1fr_14rem]">
        <ul className="space-y-1.5" aria-label="System checks">
          {keys.map((k) => (
            <li key={k} className="rounded-xl border border-line px-3 py-2" data-check={k} data-status={s[k].status}>
              <div className="flex items-center gap-2 text-sm">
                {s[k].status === 'pass' ? <CheckCircle2 className="h-4 w-4 text-ok" aria-label="Passed" /> : s[k].status === 'fail'
                  ? <CircleAlert className="h-4 w-4 text-bad" aria-label="Failed" /> : <Loader2 className={cn('h-4 w-4 text-ink-500', s[k].status === 'running' && 'animate-spin')} aria-label="Checking" />}
                <span className="font-medium text-fg">{LABEL[k]}</span>
                <span className="ml-auto truncate text-xs text-ink-500">{k === 'mic' && s.mic.status === 'running' ? `${Math.round(micProgress * 100)}%` : s[k].detail}</span>
              </div>
              {s[k].status === 'fail' && <p className="mt-1 pl-6 text-xs text-warn">Fix it: {FIX[k]}</p>}
            </li>
          ))}
        </ul>
        <div className="space-y-2">
          {needCam && <video ref={preview} muted playsInline className="aspect-[4/3] w-full -scale-x-100 rounded-xl bg-black object-cover" aria-label="Camera preview" />}
          {needScreen && <Button className="w-full" variant={s.screen?.status === 'pass' ? 'secondary' : 'default'} onClick={share} id="share-screen"><MonitorUp className="h-4 w-4" /> Share entire screen</Button>}
          {!document.fullscreenElement && <Button className="w-full" variant="secondary" onClick={() => void document.documentElement.requestFullscreen?.().catch(() => {})}>Enter full screen</Button>}
          {needCam && s.face?.status === 'fail' && media.modelsReady && <Button className="w-full" variant="ghost" onClick={() => void checkFace()}><RotateCcw className="h-4 w-4" /> Check my face again</Button>}
          {keys.some((k) => s[k].status === 'fail' && ['camera', 'mic', 'models', 'network'].includes(k)) && (
            <Button className="w-full" variant="ghost" onClick={() => void runAuto()}><RotateCcw className="h-4 w-4" /> Run the checks again</Button>
          )}
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <Button className="w-full" disabled={!all || busy} onClick={next} id="checks-continue">{busy && <Loader2 className="h-4 w-4 animate-spin" />} {all ? 'Continue' : 'Complete every check to continue'}</Button>
    </StepCard>
  )
}
