import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Lock, Maximize, MonitorX } from 'lucide-react'
import { ApplicantReturn } from '@/components/exam/ApplicantReturn'
import { ConfirmStep, ConsentStep, IdPhotoStep, ReadyStep, StepCard } from '@/components/exam/ExamSteps'
import { HandBack } from '@/components/exam/HandBack'
import { Runner } from '@/components/exam/Runner'
import { SystemCheck } from '@/components/exam/SystemCheck'
import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'
import { ErrorState, PageLoader } from '@/components/ui/loading'
import { Toaster } from '@/components/ui/toast'
import { exam, examStore, PAGE_ID, type ExamView as View } from '@/lib/proctor/examApi'
import { examChannel, setExamLock } from '@/lib/proctor/examLock'
import { useProctorMedia } from '@/lib/proctor/useProctorMedia'
import { errorMessage } from '@/services/apiClient'

const CSP = [
  "default-src 'self'", `script-src 'self' 'wasm-unsafe-eval'${import.meta.env.DEV ? " 'unsafe-inline'" : ''}`, "worker-src 'self' blob:",
  `connect-src 'self'${import.meta.env.DEV ? ' ws: wss:' : ''}`, "img-src 'self' blob: data:", "media-src 'self' blob: mediastream:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com", "frame-src 'none'", "object-src 'none'",
  "base-uri 'self'",
].join('; ')

function useExamHead() {
  useEffect(() => {
    // Exam-route policy: models and code only from this site, no eval (WASM compile allowed), no frames. A meta CSP
    // cannot be removed, so leaving the exam always does a full page load (see HandBack).
    for (const [attr, name, content] of [['http-equiv', 'Content-Security-Policy', CSP], ['name', 'referrer', 'no-referrer']]) {
      if (document.head.querySelector(`meta[${attr}="${name}"]`)) continue
      const m = document.createElement('meta')
      m.setAttribute(attr, name)
      m.content = content
      document.head.appendChild(m)
    }
  }, [])
}

/** The locked exam view: no portal chrome, exam token only, full screen, proctored. */
export default function ExamView() {
  useExamHead()
  const { sessionId = '' } = useParams()
  const { logout } = useAuth()
  // No portal session may survive on the exam device (Launch already cleared the tokens and told other tabs).
  useEffect(() => { logout() }, [logout])
  const creds = examStore.get()
  const mine = !!creds && creds.sessionId === sessionId
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refused, setRefused] = useState(false)
  const [full, setFull] = useState(() => !!document.fullscreenElement)
  const [ended, setEnded] = useState<string | null | undefined>(undefined)
  // Started from the standalone admission application: the end screen returns there instead of the teacher hand-back.
  const [origin, setOrigin] = useState<string | undefined>(undefined)
  const [proctorReady, setProctorReady] = useState(false)
  // Owned by this page: switched off when it unmounts, and as soon as the exam is over for this tab (below).
  const media = useProctorMedia()
  const [reference, setReference] = useState<number[] | null>(null)
  const [baseline, setBaseline] = useState({ yaw: 0, pitch: 0 })

  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])

  // Same browser, second exam tab: the first tab answers and this one stops. The server enforces it across devices.
  useEffect(() => {
    if (!mine) return
    setExamLock(sessionId)
    const c = examChannel((m) => {
      if (m.type === 'exam-hello' && m.page !== PAGE_ID) c.post({ type: 'exam-taken', page: PAGE_ID })
      if (m.type === 'exam-taken' && m.page !== PAGE_ID) setRefused(true)
    })
    c.post({ type: 'exam-hello', page: PAGE_ID })
    return () => c.close()
  }, [mine, sessionId])

  const load = useCallback(async () => {
    try {
      const st = await exam.claim()
      setOrigin(st.origin)
      if (st.ended) { setEnded(st.submit_reason); return }
      setView(await exam.view())
    } catch (e) {
      if ((e as { response?: { status?: number } }).response?.status === 409) setRefused(true)
      else setError(errorMessage(e))
    }
  }, [])
  useEffect(() => { if (mine) queueMicrotask(() => void load()) }, [mine, load])
  // Submitted, timed out, ended by the teacher, locked, or taken over by another tab: the end / hand-back screen
  // shows no camera — every proctoring stream (camera, microphone, screen share) and the models are switched off.
  const over = refused || ended !== undefined || !!view?.ended || view?.status === 'LOCKED'
  useEffect(() => { if (over) media.stop() }, [over, media])

  if (!mine) return <Shell><HandBack title="This exam is not open on this device" /></Shell>
  if (refused) {
    return <Shell><StepCard icon={MonitorX} title="This test is open in another tab or window"><p className="text-ink-300">Only one page can run the test. Close this tab and continue in the other one.</p></StepCard></Shell>
  }
  const applicant = origin === 'applicant' || view?.origin === 'applicant'
  if (ended !== undefined) return <Shell>{applicant ? <ApplicantReturn reason={ended} /> : <HandBack reason={ended} />}</Shell>
  if (error) return <Shell><StepCard icon={Lock} title="The test could not be opened"><ErrorState message={error} onRetry={() => { setError(null); void load() }} /></StepCard></Shell>
  if (!view) return <Shell><PageLoader className="h-full" message="Opening the test…" detail="Checking this exam session." /></Shell>
  if (view.ended) return <Shell>{applicant ? <ApplicantReturn reason={view.submit_reason} /> : <HandBack reason={view.submit_reason} />}</Shell>
  if (view.status === 'LOCKED' && applicant) return <Shell><ApplicantReturn locked /></Shell>
  if (view.status === 'LOCKED') {
    return <Shell><StepCard icon={Lock} title="Please ask your teacher"><p className="text-ink-300">The date of birth did not match three times, so the test is locked. Your teacher can launch it again.</p></StepCard>
      <HandBack title="Teacher: sign in to continue" /></Shell>
  }
  // Before the test: full screen is required to go on. During the test the runner keeps running and shows its own
  // pause overlay (unmounting it here would stop proctoring and drop its state).
  if (!full && view.status !== 'IN_PROGRESS') {
    return (
      <Shell>
        <main className="grid h-full place-items-center p-6" data-testid="fullscreen-gate">
          <Button size="lg" id="enter-fullscreen" onClick={() => void document.documentElement.requestFullscreen({ navigationUI: 'hide' })
            .then(() => (navigator as Navigator & { keyboard?: { lock(): Promise<void> } }).keyboard?.lock().catch(() => {})).catch(() => {})}>
            <Maximize className="h-5 w-5" /> Enter full screen to begin</Button>
        </main>
      </Shell>
    )
  }

  const s = view.steps
  let body: React.ReactNode
  if (view.status === 'LAUNCHED') body = <ConfirmStep view={view} onDone={setView} />
  else if (!s.started && !s.consent) body = <ConsentStep view={view} onDone={setView} />
  else if (!s.started && (!s.system_check || !proctorReady)) {
    body = <SystemCheck view={view} media={media} onDone={(v, b) => { setBaseline(b); setProctorReady(true); if (v) setView(v) }} />
  } else if (!s.started && !s.id_photo) {
    body = <IdPhotoStep media={media} onDone={(v, emb) => { setReference(emb); setView(v) }} />
  } else if (view.status === 'CHECKED') {
    body = <ReadyStep view={view} onStart={async () => setView(await exam.start())} />
  } else if (view.status === 'IN_PROGRESS' && !proctorReady) {
    body = <SystemCheck view={view} media={media} resume onDone={(_, b) => { setBaseline(b); setProctorReady(true) }} />
  } else if (view.status === 'IN_PROGRESS') {
    body = <Runner view={view} media={media} reference={reference} baseline={baseline} onEnded={(r) => setEnded(r)} />
  } else body = <div className="grid h-full place-items-center text-ink-300">Please wait…</div>
  return <Shell>{body}</Shell>
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto bg-ink-950 text-ink-100">
      {children}
      <Toaster />
    </div>
  )
}
