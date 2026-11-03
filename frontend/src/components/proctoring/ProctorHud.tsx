import { useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, ChevronDown, Eye, EyeOff, Maximize, Mic, MicOff, ShieldCheck, TriangleAlert, Wifi, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ProctorMedia } from '@/lib/proctor/media'
import type { LocalFlag, MonitorHud } from '@/lib/proctor/student/monitor'
import { cn } from '@/lib/utils'
import type { ProctorWarning } from '@/services/proctoringService'

const time = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/**
 * The student's view of a running proctored session: a small status panel (camera / microphone / connection, the flags
 * recorded so far, a private preview they can hide), teacher warnings that must be acknowledged, and blocking prompts
 * when full screen is required or the camera dropped.
 */
export function ProctorHud({ hud, media, flags, warnings, fullscreenRequired, cameraRequired, micRequired, onAck, onReconnectCamera, onReconnectMic }: {
  hud: MonitorHud | null
  media: ProctorMedia
  flags: LocalFlag[]
  warnings: ProctorWarning[]
  fullscreenRequired: boolean
  cameraRequired: boolean
  micRequired: boolean
  onAck: (w: ProctorWarning) => Promise<void>
  onReconnectCamera: () => Promise<void>
  onReconnectMic: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [showPreview, setShowPreview] = useState(true)
  const [busy, setBusy] = useState(false)
  const [fixError, setFixError] = useState<string | null>(null)
  const video = useRef<HTMLVideoElement>(null)

  // The private preview shows the running camera; it lets go of the stream when hidden, closed or gone.
  useEffect(() => {
    const v = video.current
    if (!open || !showPreview || !v || !media.camera) return
    v.srcObject = media.camera
    void v.play?.()?.catch(() => {})
    return () => { v.srcObject = null }
  }, [open, showPreview, media, hud?.camera])

  const warning = warnings[0]
  const cameraDown = cameraRequired && hud !== null && !hud.camera
  const micDown = micRequired && hud !== null && hud.mic === false
  const needFullscreen = fullscreenRequired && hud !== null && !hud.fullscreen && !hud.away
  const ok = hud && !cameraDown && !micDown && hud.online && !needFullscreen

  async function fix(action: () => Promise<void>) {
    setBusy(true); setFixError(null)
    try { await action() } catch (e) { setFixError(e instanceof Error ? e.message : 'That did not work — check the browser permission and try again.') } finally { setBusy(false) }
  }

  return (
    <>
      <div className={cn('fixed bottom-3 right-3 z-40 print:hidden', open ? 'w-[min(20rem,calc(100vw-1.5rem))]' : 'w-auto')} aria-label="Proctoring status">
        {open && (
          <div className="mb-2 space-y-3 rounded-2xl border border-line bg-ink-900 p-3 shadow-xl animate-fade-up">
            {cameraRequired && (
              <div>
                <div className="mb-1 flex items-center justify-between text-xs text-ink-500">
                  <span>Your camera (only you see this)</span>
                  <button className="flex cursor-pointer items-center gap-1 hover:text-fg" onClick={() => setShowPreview((v) => !v)} aria-pressed={!showPreview}>
                    {showPreview ? <><EyeOff className="h-3.5 w-3.5" /> Hide</> : <><Eye className="h-3.5 w-3.5" /> Show</>}
                  </button>
                </div>
                {showPreview && <video ref={video} muted playsInline autoPlay className="aspect-video w-full -scale-x-100 rounded-lg bg-black object-cover" aria-label="Your camera preview" />}
              </div>
            )}
            <ul className="grid grid-cols-2 gap-1.5 text-xs">
              {cameraRequired && <Chip on={!!hud?.camera} icon={hud?.camera ? Camera : CameraOff} label={hud?.camera ? 'Camera on' : 'Camera off'} />}
              {hud?.mic !== null && hud?.mic !== undefined && <Chip on={hud.mic} icon={hud.mic ? Mic : MicOff} label={hud.mic ? 'Microphone on' : 'Microphone off'} />}
              <Chip on={!!hud?.online} icon={hud?.online ? Wifi : WifiOff} label={hud?.online ? 'Online' : 'Offline'} />
              {fullscreenRequired && <Chip on={!!hud?.fullscreen} icon={Maximize} label={hud?.fullscreen ? 'Full screen' : 'Not full screen'} />}
            </ul>
            {hud?.hint && <p className="rounded-lg bg-warn/10 px-2 py-1 text-xs text-warn" role="status">{hud.hint}</p>}
            {hud?.away && <p className="rounded-lg bg-brand-500/10 px-2 py-1 text-xs text-ink-300">You opened the lab simulation — that is allowed. Come back here when you are done.</p>}
            <div>
              <div className="mb-1 text-xs font-medium text-fg">Flags recorded in this session ({flags.length})</div>
              {flags.length === 0 ? <p className="text-xs text-ink-500">None so far.</p> : (
                <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs text-ink-300">
                  {[...flags].reverse().map((f, i) => <li key={`${f.at}-${i}`} className="flex justify-between gap-2"><span>{f.label}</span><span className="tabular-nums text-ink-500">{time(f.at)}</span></li>)}
                </ul>
              )}
              <p className="mt-1.5 text-[11px] text-ink-500">Only these flags are sent to your teacher — no video, photo or audio. A flag is a signal for review, not proof.</p>
            </div>
          </div>
        )}
        <button onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className={cn('flex w-full cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-sm shadow-lg backdrop-blur',
            ok ? 'border-ok/30 bg-ink-900/95 text-ink-100' : 'border-warn/40 bg-warn/10 text-fg')}>
          {ok ? <ShieldCheck className="h-4 w-4 text-ok" /> : <TriangleAlert className="h-4 w-4 text-warn" />}
          <span className="flex-1 text-left font-medium">{ok ? 'Proctoring on' : 'Check proctoring'}</span>
          {flags.length > 0 && <span className="rounded-full bg-ink-800 px-1.5 text-[11px] tabular-nums text-ink-300">{flags.length} flag{flags.length === 1 ? '' : 's'}</span>}
          <ChevronDown className={cn('h-4 w-4 transition-transform', !open && 'rotate-180')} />
        </button>
      </div>

      {(cameraDown || micDown) && !needFullscreen && (
        <div role="alert" className="fixed inset-x-3 top-3 z-40 mx-auto flex max-w-2xl flex-wrap items-center gap-3 rounded-2xl border border-bad/30 bg-ink-900 p-3 shadow-xl">
          {cameraDown ? <CameraOff className="h-5 w-5 text-bad" /> : <MicOff className="h-5 w-5 text-bad" />}
          <p className="min-w-0 flex-1 text-sm text-fg">{cameraDown ? 'Your camera disconnected or its permission was removed.' : 'Your microphone disconnected or its permission was removed.'} This is recorded — reconnect it to continue properly.
            {fixError && <span className="block text-xs text-bad">{fixError}</span>}</p>
          <Button size="sm" disabled={busy} onClick={() => void fix(cameraDown ? onReconnectCamera : onReconnectMic)}>Reconnect</Button>
        </div>
      )}

      {needFullscreen && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="fs-title" className="fixed inset-0 z-[55] grid place-items-center bg-ink-950/95 p-6">
          <div className="max-w-md space-y-4 text-center">
            <Maximize className="mx-auto h-10 w-10 text-warn" />
            <h2 id="fs-title" className="font-display text-xl font-bold text-fg">Return to full screen</h2>
            <p className="text-sm text-ink-300">This exam runs in full screen. Leaving it has been recorded as a flag for your teacher to review. Your timer keeps running.</p>
            <Button size="lg" onClick={() => void document.documentElement.requestFullscreen?.().catch(() => {})} autoFocus>Back to full screen</Button>
          </div>
        </div>
      )}

      {warning && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="warn-title" aria-describedby="warn-text" className="fixed inset-0 z-[56] grid place-items-center bg-fg/30 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-line bg-ink-900 p-6 shadow-2xl">
            <div className="flex items-center gap-2"><TriangleAlert className="h-5 w-5 text-warn" /><h2 id="warn-title" className="font-display text-lg font-semibold text-fg">Message from your teacher</h2></div>
            <p id="warn-text" className="rounded-xl border border-warn/30 bg-warn/10 p-3 text-sm text-fg">{warning.message}</p>
            {fixError && <p className="text-xs text-bad">{fixError}</p>}
            <div className="flex justify-end"><Button disabled={busy} onClick={() => void fix(() => onAck(warning))} autoFocus>I understand</Button></div>
          </div>
        </div>
      )}
    </>
  )
}

function Chip({ on, icon: Icon, label }: { on: boolean; icon: typeof Camera; label: string }) {
  return (
    <li className={cn('flex items-center gap-1.5 rounded-lg px-2 py-1', on ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad')}>
      <Icon className="h-3.5 w-3.5" aria-hidden />{label}
    </li>
  )
}
