import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Camera, Clock, Loader2, RotateCcw, ShieldCheck, UserCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/field'
import { exam, type ExamView } from '@/lib/proctor/examApi'
import { sleep, type ProctorMedia } from '@/lib/proctor/media'
import { errorMessage } from '@/services/apiClient'

export function StepCard({ icon: Icon, title, step, children }: { icon: typeof Camera; title: string; step?: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-full place-items-center p-6">
      <section className="glass w-full max-w-2xl space-y-5 rounded-3xl p-7" aria-labelledby="step-h">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-500/10"><Icon className="h-6 w-6 text-brand-600" /></div>
          <div>
            {step && <div className="text-xs font-medium uppercase tracking-widest text-ink-500">{step}</div>}
            <h1 id="step-h" className="font-display text-2xl font-bold text-fg">{title}</h1>
          </div>
        </div>
        {children}
      </section>
    </main>
  )
}

/** "Is this you?" + date of birth (3 tries, then the session locks and the teacher's monitor shows it). */
export function ConfirmStep({ view, onDone }: { view: ExamView; onDone: (v: ExamView) => void }) {
  const [dob, setDob] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try { onDone(await exam.confirm(dob)) } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status
      if (status === 423) onDone({ ...view, status: 'LOCKED', locked: true })
      else setError(errorMessage(err))
    } finally { setBusy(false) }
  }
  return (
    <StepCard icon={UserCheck} step="Step 1 of 5" title={`Hello, ${view.candidate.first_name}`}>
      <p className="text-ink-100">Welcome to <b>{view.test.title}</b>. Please confirm this is you: <b className="text-fg">{view.candidate.full_name}</b>.</p>
      <form onSubmit={submit} className="space-y-3">
        <div className="max-w-xs"><Label htmlFor="dob">Your date of birth</Label><Input id="dob" type="date" required value={dob} onChange={(e) => setDob(e.target.value)} /></div>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy || !dob} id="confirm-identity">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Yes, this is me</Button>
          <span className="text-xs text-ink-500">Not you? Hand the device back to your teacher.</span>
        </div>
      </form>
    </StepCard>
  )
}

/** Plain-language notice and explicit consent before ANY capture. */
export function ConsentStep({ view, onDone }: { view: ExamView; onDone: (v: ExamView) => void }) {
  const n = view.consent_notice
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [declined, setDeclined] = useState(false)
  async function accept() {
    setBusy(true); setError(null)
    try { onDone(await exam.consent(n.version)) } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  return (
    <StepCard icon={ShieldCheck} step="Step 2 of 5" title="How this test is supervised">
      <div className="grid gap-4 text-sm md:grid-cols-2">
        <div><h2 className="mb-1 font-semibold text-fg">What is captured</h2><ul className="list-disc space-y-1 pl-5 text-ink-100">{n.captured.map((x) => <li key={x}>{x}</li>)}</ul></div>
        <div><h2 className="mb-1 font-semibold text-fg">What is NOT captured</h2><ul className="list-disc space-y-1 pl-5 text-ink-100">{n.not_captured.map((x) => <li key={x}>{x}</li>)}</ul></div>
      </div>
      <dl className="space-y-1 text-sm text-ink-300">
        <div><dt className="inline font-medium text-fg">Who sees it: </dt><dd className="inline">{n.who_sees}</dd></div>
        <div><dt className="inline font-medium text-fg">How long: </dt><dd className="inline">{n.retention}</dd></div>
        <div><dt className="inline font-medium text-fg">Deletion: </dt><dd className="inline">{n.deletion}</dd></div>
        <div><dt className="inline font-medium text-fg">Why: </dt><dd className="inline">to make the admission test fair for every candidate. The system can make mistakes: flags are checked by your teacher.</dd></div>
      </dl>
      <label className="flex items-start gap-2 rounded-xl border border-line p-3 text-sm text-fg">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-500" checked={ok} onChange={(e) => setOk(e.target.checked)} id="consent-check" />
        I have read this and I agree to be supervised by camera, microphone level and screen sharing during this test.
      </label>
      {declined && <p role="status" className="rounded-xl bg-warn/10 p-3 text-sm text-ink-100">{n.alternative}</p>}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={accept} disabled={!ok || busy} id="consent-accept">{busy && <Loader2 className="h-4 w-4 animate-spin" />} I agree</Button>
        <Button variant="ghost" onClick={() => setDeclined(true)}>I do not agree</Button>
      </div>
    </StepCard>
  )
}

/** Three frames, the sharpest one with exactly one face is the reference (its face template stays in memory only). */
export function IdPhotoStep({ media, onDone }: { media: ProctorMedia; onDone: (v: ExamView, embedding: number[] | null, photo: string) => void }) {
  const preview = useRef<HTMLVideoElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const v = preview.current
    if (v && media.camera) { v.srcObject = media.camera; void v.play().catch(() => {}) }
    return () => { if (v) v.srcObject = null }
  }, [media])

  async function take() {
    setBusy(true); setError(null)
    try {
      const shots: { blob: Blob; sharp: number; canvas: HTMLCanvasElement }[] = []
      for (let i = 0; i < 3; i++) {
        const v = media.camVideo
        const c = document.createElement('canvas')
        c.width = 640
        c.height = Math.round((v.videoHeight / v.videoWidth) * 640) || 480
        c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
        const sharp = media.sharpness()
        const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.85))
        if (blob) shots.push({ blob, sharp, canvas: c })
        await sleep(300)
      }
      const best = shots.sort((a, b) => b.sharp - a.sharp)[0]
      if (!best) throw new Error('The camera did not give a picture')
      let r = null
      for (let i = 0; i < 20 && !r; i++) { r = await media.analyse({ embed: true, source: best.canvas }); if (!r) await sleep(150) }
      if (!r || r.faces !== 1) throw new Error(r && r.faces > 1 ? 'Only you should be in the photo' : 'We could not see your face clearly. Face the camera in good light and try again.')
      const v = await exam.idPhoto(best.blob)
      onDone(v, r.embedding, URL.createObjectURL(best.blob))
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  return (
    <StepCard icon={Camera} step="Step 4 of 5" title="Your ID photo">
      <p className="text-sm text-ink-300">Look straight at the camera, in good light, with only you in view. This photo appears on your result report.</p>
      <video ref={preview} muted playsInline className="mx-auto aspect-video w-full max-w-md -scale-x-100 rounded-2xl bg-black object-cover" aria-label="Camera preview" />
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <Button onClick={take} disabled={busy} id="take-id-photo">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : error ? <RotateCcw className="h-4 w-4" /> : <Camera className="h-4 w-4" />} {error ? 'Try again' : 'Take photo'}</Button>
    </StepCard>
  )
}

export function ReadyStep({ view, onStart }: { view: ExamView; onStart: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const minutes = view.test.duration_minutes + view.test.extra_time_minutes
  return (
    <StepCard icon={Clock} step="Step 5 of 5" title="Ready to start">
      <ul className="grid gap-2 text-sm sm:grid-cols-3">
        <li className="rounded-xl border border-line p-3"><b className="font-display text-xl text-fg">{minutes}</b> minutes{view.test.extra_time_minutes ? ` (incl. ${view.test.extra_time_minutes} extra)` : ''}</li>
        <li className="rounded-xl border border-line p-3"><b className="font-display text-xl text-fg">{view.test.sections.reduce((n, s) => n + s.count, 0)}</b> questions in {view.test.sections.length} sections</li>
        <li className="rounded-xl border border-line p-3">Auto-submitted after <b className="text-fg">{view.rules.max_warnings}</b> warnings</li>
      </ul>
      {view.test.instructions && <p className="whitespace-pre-line rounded-xl bg-ink-800 p-3 text-sm text-ink-100">{view.test.instructions}</p>}
      <ul className="list-disc space-y-1 pl-5 text-sm text-ink-300">
        <li>Stay in full screen, keep your face in view and keep sharing your entire screen.</li>
        <li>No phones, books, other people, other tabs or apps. Copy and paste are switched off.</li>
        <li>Your answers save automatically. The timer runs on the school's server and does not stop.</li>
        <li>The first minute only gives gentle reminders while the system gets used to your room.</li>
      </ul>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <Button size="lg" className="w-full" disabled={busy} id="start-exam"
        onClick={async () => { setBusy(true); setError(null); try { await onStart() } catch (e) { setError(errorMessage(e)); setBusy(false) } }}>
        {busy && <Loader2 className="h-5 w-5 animate-spin" />} Start the test
      </Button>
    </StepCard>
  )
}
