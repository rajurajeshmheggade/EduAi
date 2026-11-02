import { useEffect, useRef, useState } from 'react'
import { Camera, CircleAlert, Loader2, ShieldCheck, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { ProctorMedia } from '@/lib/proctor/media'

const DEVICE_LABELS = new Set(['cell phone', 'laptop', 'tv'])
const TICK_MS = 1500
const STREAK_HITS = 2          // consecutive ticks before a flag fires (debounce against single-frame noise)
const NOISE_MARGIN_DB = 15     // over the calibrated quiet-room floor

type Phase = 'intro' | 'starting' | 'live' | 'error'
interface Flag { id: number; label: string; at: number }
let seq = 0

/**
 * Light ("low") on-device camera + mic check, shared by Virtual Labs and Online Tests: shows a live camera
 * preview, and flags multiple people, no one in frame, background noise and phones/laptops/TVs seen in shot.
 * Nothing is recorded or streamed anywhere — the caller's `reportFlag` sends only a running *count* to the
 * server (so the teacher can see something was flagged), never a video, image or the detail of what was seen.
 * This is an on-screen, advisory check, not an exam-grade proctoring audit trail (see `@/lib/proctor` for that
 * heavier system, used by the admission exam).
 *
 * When `totalQuestions` is given (> 0), `onReady(true)` fires only once the camera has stayed on *and* every
 * question got answered — for callers that gate a Submit button on it (Virtual Labs, Online Tests). Without
 * it, `onReady(true)` fires as soon as the camera is live — a purely advisory check with nothing to gate
 * (e.g. AI Classroom). `reportFlag`/`onReady` are optional; without `reportFlag` the flag count is just kept
 * locally (nothing is sent anywhere).
 */
export function LiveCameraCheck({ title = 'Camera check', totalQuestions = 0, answered = 0, reportFlag, onReady }: {
  title?: string
  totalQuestions?: number
  answered?: number
  /** Persists one more flag server-side; resolves with the new total. */
  reportFlag?: () => Promise<{ flag_count: number }>
  onReady?: (ready: boolean) => void
}) {
  const gated = totalQuestions > 0
  const [phase, setPhase] = useState<Phase>('intro')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [faces, setFaces] = useState<number | null>(null)
  const [flags, setFlags] = useState<Flag[]>([])
  const [flagCount, setFlagCount] = useState(0)
  const [ready, setReady] = useState(false)   // mirrors `done` below, for rendering only
  const videoRef = useRef<HTMLVideoElement>(null)
  const [media] = useState(() => new ProctorMedia())
  const tick = useRef<number | undefined>(undefined)
  const done = useRef(false)
  const multiStreak = useRef(0)
  const noFaceStreak = useRef(0)
  const deviceStreak = useRef(0)
  const noiseStreak = useRef(0)

  const pushFlag = (label: string) => {
    setFlags((xs) => [...xs.slice(-3), { id: ++seq, label, at: Date.now() }])
    toast(`⚠ ${label}`, 'error')
    if (reportFlag) reportFlag().then((r) => setFlagCount(r.flag_count)).catch(() => setFlagCount((n) => n + 1))
    else setFlagCount((n) => n + 1)
  }

  async function runTick() {
    if (!media.cameraLive()) { setPhase('error'); setErrorMsg('The camera turned off. Turn it back on to continue.'); if (!done.current) onReady?.(false); return }
    const r = await media.analyse({ objects: true })
    if (r) {
      setFaces(r.faces)
      const people = Math.max(r.faces, r.objects.filter((o) => o.label === 'person' && o.score >= 0.5).length)
      multiStreak.current = people >= 2 ? multiStreak.current + 1 : 0
      if (multiStreak.current === STREAK_HITS) { pushFlag('Multiple people in the camera'); multiStreak.current = 0 }
      noFaceStreak.current = r.faces === 0 ? noFaceStreak.current + 1 : 0
      if (noFaceStreak.current === STREAK_HITS + 1) { pushFlag('No one in front of the camera'); noFaceStreak.current = 0 }
      const device = r.objects.some((o) => DEVICE_LABELS.has(o.label) && o.score >= 0.5)
      deviceStreak.current = device ? deviceStreak.current + 1 : 0
      if (deviceStreak.current === STREAK_HITS) { pushFlag('A phone, laptop or TV was seen in the camera'); deviceStreak.current = 0 }
    }
    const db = media.micDb()
    if (db !== null) {
      noiseStreak.current = db > media.floorDb + NOISE_MARGIN_DB ? noiseStreak.current + 1 : 0
      if (noiseStreak.current === STREAK_HITS) { pushFlag('Background noise or talking detected'); noiseStreak.current = 0 }
    }
  }

  async function begin() {
    setPhase('starting'); setErrorMsg(null)
    try {
      const stream = await media.startCamera()
      if (videoRef.current) videoRef.current.srcObject = stream
      await media.startMic().catch(() => {})     // noise check is best-effort; camera is the part that matters
      await media.calibrateMic(1200).catch(() => {})
      await media.loadModels({ embed: false, objects: true })
      setPhase('live')
      tick.current = window.setInterval(() => { void runTick() }, TICK_MS)
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Could not start the camera for the viva check.')
      setPhase('error')
    }
  }

  // Gated: ready once the camera has been on throughout and every question is answered. Not gated: ready as
  // soon as the camera is live — nothing to wait for.
  useEffect(() => {
    if (phase === 'live' && !done.current && (!gated || answered >= totalQuestions)) {
      done.current = true
      setReady(true)
      onReady?.(true)
    }
  }, [phase, answered, totalQuestions, gated, onReady])

  // Release the camera/mic/worker when the student leaves the Viva tab or the lab entirely.
  useEffect(() => () => {
    window.clearInterval(tick.current)
    media.stop()
  }, [media])

  const stage = phase === 'intro' ? (
    <div className="space-y-3 p-4 text-center">
      <Camera className="mx-auto h-8 w-8 text-brand-600" />
      <p className="text-sm text-ink-100"><b>Turn on your camera.</b> It helps check you're working on your own.{gated && " It unlocks Submit once you're done."}</p>
      <Button onClick={() => void begin()}><Video className="h-4 w-4" /> Turn on camera</Button>
    </div>
  ) : phase === 'starting' ? (
    <div className="flex items-center gap-2 p-4 text-sm text-ink-300"><Loader2 className="h-4 w-4 animate-spin" /> Starting the camera check…</div>
  ) : phase === 'error' ? (
    <div className="space-y-2 p-4">
      <p className="flex items-start gap-2 text-sm text-bad"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{errorMsg}</p>
      <Button size="sm" variant="secondary" onClick={() => void begin()}>Try again</Button>
    </div>
  ) : (
    <div className="space-y-2 p-3">
      <div className="relative overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} autoPlay muted playsInline className="aspect-[4/3] w-full object-cover" />
        <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-bad/90 px-2 py-0.5 text-[10px] font-medium text-white">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> LIVE
        </span>
        {faces !== null && <span className="absolute top-2 right-2 rounded-full bg-ink-900/80 px-2 py-0.5 text-[10px] text-ink-100">{faces} face{faces === 1 ? '' : 's'}</span>}
      </div>
      <div className="flex items-center justify-between gap-2 text-xs">
        {ready ? (
          <p className="flex items-center gap-1.5 text-ok"><ShieldCheck className="h-4 w-4" /> {gated ? "Camera check complete — you can submit once you're ready." : 'Camera check active.'}</p>
        ) : (
          <p className="text-ink-500">Keep your camera on and answer every question to unlock Submit.</p>
        )}
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 font-medium', flagCount > 0 ? 'bg-warn/15 text-warn' : 'bg-ink-800 text-ink-500')}>{flagCount} flag{flagCount === 1 ? '' : 's'}</span>
      </div>
      {flags.length > 0 && (
        <ul className="space-y-1" aria-label="Camera check flags">
          {flags.map((f) => (
            <li key={f.id} className="flex items-start gap-1.5 text-xs text-warn"><CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />{f.label}</li>
          ))}
        </ul>
      )}
    </div>
  )

  return (
    <Card className="overflow-hidden p-0" aria-label={title}>
      <div className={cn('border-b border-line px-4 py-2 text-xs font-medium uppercase tracking-wide', phase === 'live' ? 'text-ok' : 'text-ink-500')}>{title}</div>
      {stage}
    </Card>
  )
}
