import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, CircleAlert, Loader2, Rocket } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label, Select } from '@/components/ui/field'
import { browserGate } from '@/lib/proctor/browserGate'
import { examStore, newDeviceId } from '@/lib/proctor/examApi'
import { broadcastLogout, setExamLock } from '@/lib/proctor/examLock'
import { MODELS_BASE } from '@/lib/proctor/media'
import { errorMessage } from '@/services/apiClient'
import { admissionTestService as svc, type AdmTest, type Candidate, type GuardianConsent } from '@/services/admissionTestService'

const MODEL_FILES = ['mediapipe/vision_wasm_module_internal.js', 'mediapipe/vision_wasm_module_internal.wasm', 'mediapipe/face_landmarker.task',
  'mediapipe/efficientdet_lite0.tflite', 'face-api/face_recognition_model-weights_manifest.json', 'face-api/face_recognition_model.bin']

/** Pick a published test + candidate, confirm guardian consent for minors, then launch into full screen on THIS device. */
export function LaunchTab({ tests, candidates }: { tests: AdmTest[] | null; candidates: Candidate[] | null }) {
  const nav = useNavigate()
  const { logout } = useAuth()
  const published = useMemo(() => (tests ?? []).filter((t) => t.status === 'PUBLISHED'), [tests])
  const [testId, setTestId] = useState('')
  const [candidateId, setCandidateId] = useState('')
  const [consent, setConsent] = useState<GuardianConsent>({ guardian_name: '', relationship: '', method: 'in_person' })
  const [devices, setDevices] = useState<{ camera: boolean; mic: boolean; single: boolean | null } | null>(null)
  const [preload, setPreload] = useState<{ done: number; total: number; failed: boolean }>({ done: 0, total: MODEL_FILES.length, failed: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const gate = browserGate()
  const test = published.find((t) => t.test_id === testId) ?? published[0]
  const done = (c: Candidate) => c.sessions.some((s) => s.test_id === test?.test_id && (s.status === 'SUBMITTED' || s.status === 'ENDED'))
  const pool = (candidates ?? []).filter((c) => !done(c))
  const cand = pool.find((c) => c.candidate_id === candidateId) ?? null
  const minor = !!cand?.minor
  const consentOk = !minor || (consent.guardian_name.trim().length >= 2 && consent.relationship.trim().length >= 2)

  // Pre-check devices and warm the exam chunk + proctoring models, so the exam is ready seconds after Launch.
  useEffect(() => {
    void import('@/pages/exam/ExamView')
    navigator.mediaDevices?.enumerateDevices?.().then((ds) => setDevices({
      camera: ds.some((d) => d.kind === 'videoinput'), mic: ds.some((d) => d.kind === 'audioinput'),
      single: (window.screen as Screen & { isExtended?: boolean }).isExtended === undefined ? null : !(window.screen as Screen & { isExtended?: boolean }).isExtended,
    })).catch(() => setDevices({ camera: false, mic: false, single: null }))
    let live = true
    void (async () => {
      for (const f of MODEL_FILES) {
        try { const r = await fetch(`${MODELS_BASE}/${f}`, { cache: 'force-cache' }); await r.arrayBuffer(); if (!r.ok) throw new Error() }
        catch { if (live) setPreload((p) => ({ ...p, failed: true })) }
        if (live) setPreload((p) => ({ ...p, done: p.done + 1 }))
      }
    })()
    return () => { live = false }
  }, [])

  function launch() {
    if (!test || !cand) return
    setBusy(true); setError(null)
    // Full screen must be requested inside the click (a user gesture), before any await.
    const fs = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })
      .then(() => (navigator as Navigator & { keyboard?: { lock(): Promise<void> } }).keyboard?.lock().catch(() => {}))
      .catch(() => null)
    const device = newDeviceId()
    void (async () => {
      try {
        const r = await svc.launch({ test_id: test.test_id, candidate_id: cand.candidate_id, device_id: device, guardian_consent: minor ? consent : null })
        await fs
        examStore.save(r.session_id, r.exam_token, device)
        setExamLock(r.session_id)
        nav(`/admission/exam/${r.session_id}`, { replace: true })
        // Close the teacher's portal session on this device, in every tab.
        logout()
        broadcastLogout()
      } catch (e) {
        setError(errorMessage(e))
        setBusy(false)
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
      }
    })()
  }

  if (!tests || !candidates) return <div className="skeleton h-64" />
  const check = (ok: boolean | null, label: string) => (
    <li className="flex items-center gap-2 text-sm">{ok === false ? <CircleAlert className="h-4 w-4 text-bad" /> : <CheckCircle2 className={ok ? 'h-4 w-4 text-ok' : 'h-4 w-4 text-ink-500'} />}{label}</li>
  )
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Rocket className="h-5 w-5 text-brand-600" /> Launch an exam on this device</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {gate && <p role="alert" className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{gate}</p>}
          {published.length === 0 ? <p className="text-sm text-ink-300">Publish an admission test first.</p> : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="l-test">Published test</Label>
                <Select id="l-test" value={test?.test_id ?? ''} onChange={(e) => { setTestId(e.target.value); setCandidateId('') }}>
                  {published.map((t) => <option key={t.test_id} value={t.test_id}>{t.title} · {t.grade_applying}</option>)}</Select></div>
              <div><Label htmlFor="l-cand">Candidate</Label>
                <Select id="l-cand" value={cand?.candidate_id ?? ''} onChange={(e) => setCandidateId(e.target.value)}>
                  <option value="">Choose a candidate</option>
                  {pool.map((c) => <option key={c.candidate_id} value={c.candidate_id}>{c.full_name} · {c.grade_applying}{c.minor ? ' · minor' : ''}</option>)}</Select></div>
            </div>
          )}
          {minor && (
            <fieldset className="space-y-3 rounded-2xl border border-warn/30 bg-warn/5 p-4">
              <legend className="px-1 text-sm font-medium text-fg">Guardian consent (candidate is {cand?.age})</legend>
              <p className="text-xs text-ink-300">Confirm that the guardian agreed to camera, microphone-level and screen supervision for this test. It is recorded with your name and the time.</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div><Label htmlFor="g-name">Guardian name</Label><Input id="g-name" maxLength={200} value={consent.guardian_name} placeholder={cand?.guardian_name ?? ''} onChange={(e) => setConsent({ ...consent, guardian_name: e.target.value })} /></div>
                <div><Label htmlFor="g-rel">Relationship</Label><Input id="g-rel" maxLength={60} placeholder="Mother" value={consent.relationship} onChange={(e) => setConsent({ ...consent, relationship: e.target.value })} /></div>
                <div><Label htmlFor="g-method">How consent was given</Label>
                  <Select id="g-method" value={consent.method} onChange={(e) => setConsent({ ...consent, method: e.target.value as GuardianConsent['method'] })}>
                    <option value="in_person">In person</option><option value="signed_form">Signed form</option><option value="otp" disabled>OTP (needs an SMS/email sender)</option></Select></div>
              </div>
            </fieldset>
          )}
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={launch} disabled={!!gate || !test || !cand || !consentOk || busy} id="launch-exam">
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Rocket className="h-5 w-5" />} Launch exam
            </Button>
            <p className="text-xs text-ink-500">The browser goes full screen and your portal session closes on this device. Sign in again after the test.</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Device pre-check</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-1.5">
            {check(!gate, 'Desktop Chrome or Edge, https')}
            {check(devices ? devices.camera : null, 'Camera present')}
            {check(devices ? devices.mic : null, 'Microphone present')}
            {check(devices ? devices.single : null, devices?.single === null ? 'Screen count not reported' : 'Single screen')}
            {check(preload.failed ? false : preload.done === preload.total ? true : null, preload.failed ? 'Proctoring models missing (npm run models:proctor)' : `Proctoring models ${preload.done}/${preload.total}`)}
          </ul>
          <p className="mt-3 text-xs text-ink-500">The candidate grants camera, microphone and screen permissions in the exam itself.</p>
          {cand?.accommodations.extra_time_minutes ? <Badge className="mt-2" tone="aqua">+{cand.accommodations.extra_time_minutes} min extra time</Badge> : null}
        </CardContent>
      </Card>
    </div>
  )
}
