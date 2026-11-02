import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2, CircleAlert, Loader2, Lock, Rocket, ShieldCheck } from 'lucide-react'
import { PlainText } from '@/components/admission-forms/FormFields'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/field'
import { ageOn, allFields } from '@/lib/admissionForm'
import { browserGate } from '@/lib/proctor/browserGate'
import { examStore, newDeviceId } from '@/lib/proctor/examApi'
import { setExamLock } from '@/lib/proctor/examLock'
import { setExamReturn } from '@/lib/proctor/examReturn'
import { MODELS_BASE } from '@/lib/proctor/media'
import { errorMessage } from '@/services/apiClient'
import { applyService, applyStore } from '@/services/applyService'
import { useApply } from './context'

const MODEL_FILES = ['mediapipe/vision_wasm_module_internal.js', 'mediapipe/vision_wasm_module_internal.wasm', 'mediapipe/face_landmarker.task',
  'mediapipe/efficientdet_lite0.tflite', 'face-api/face_recognition_model-weights_manifest.json', 'face-api/face_recognition_model.bin']
const card = 'rounded-2xl border border-line bg-ink-900 p-5 shadow-sm sm:p-6'

/**
 * After submitting an application whose form has a linked admission test: device checks, guardian consent for minors,
 * then the existing proctored exam view (full screen, exam token only). The credential is removed when the test ends.
 */
export default function ApplyTest() {
  const { me, slug, base } = useApply()
  const nav = useNavigate()
  const test = me!.test
  const app = me!.application
  const core = (k: string) => { const f = allFields(me!.form.definition).find((x) => x.core === k); return f ? app.answers[f.key] : undefined }
  const dob = core('date_of_birth')
  const minor = typeof dob !== 'string' || ageOn(dob) < 18
  const [guardian, setGuardian] = useState(String(core('guardian_name') ?? ''))
  const [relationship, setRelationship] = useState(String(core('guardian_relationship') ?? ''))
  const [agree, setAgree] = useState(false)
  const [devices, setDevices] = useState<{ camera: boolean; mic: boolean } | null>(null)
  const [preload, setPreload] = useState({ done: 0, failed: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const gate = browserGate()

  useEffect(() => {
    if (app.status !== 'test_pending') return
    void import('@/pages/exam/ExamView')
    navigator.mediaDevices?.enumerateDevices?.().then((ds) => setDevices({ camera: ds.some((d) => d.kind === 'videoinput'), mic: ds.some((d) => d.kind === 'audioinput') }))
      .catch(() => setDevices({ camera: false, mic: false }))
    let live = true
    void (async () => {
      for (const f of MODEL_FILES) {
        try { const r = await fetch(`${MODELS_BASE}/${f}`, { cache: 'force-cache' }); await r.arrayBuffer(); if (!r.ok) throw new Error() }
        catch { if (live) setPreload((p) => ({ ...p, failed: true })) }
        if (live) setPreload((p) => ({ ...p, done: p.done + 1 }))
      }
    })()
    return () => { live = false }
  }, [app.status])

  if (!test || app.status !== 'test_pending') {
    return (
      <div className={`${card} mx-auto max-w-lg space-y-3 text-center`}>
        <CheckCircle2 className="mx-auto h-10 w-10 text-ok" />
        <p className="text-ink-300">{app.editable ? 'Submit your application first; the admission test follows.' : 'There is no admission test to take now.'}</p>
        <Link to={`${base}/dashboard`} className="text-sm font-medium text-brand-600 hover:underline">Back to the dashboard</Link>
      </div>
    )
  }

  const consentOk = !minor || (guardian.trim().length >= 2 && relationship.trim().length >= 2 && agree)
  function start() {
    setBusy(true); setError(null)
    // Full screen must be requested inside the click (a user gesture), before any await.
    const fs = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })
      .then(() => (navigator as Navigator & { keyboard?: { lock(): Promise<void> } }).keyboard?.lock().catch(() => {})).catch(() => null)
    const device = newDeviceId()
    void (async () => {
      try {
        const r = await applyService.launchTest(slug, { device_id: device, guardian_consent: minor ? { guardian_name: guardian.trim(), relationship: relationship.trim(), confirm: agree } : null })
        await fs
        if (app.reference_no) applyStore.saveDone({ slug, reference_no: app.reference_no, status: 'submitted', at: new Date().toISOString(), test: true })
        setExamReturn(`${base}/submitted`)
        examStore.save(r.session_id, r.exam_token, device)
        setExamLock(r.session_id)
        nav(`/admission/exam/${r.session_id}`, { replace: true })
      } catch (e) {
        setError(errorMessage(e)); setBusy(false)
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
      }
    })()
  }
  const check = (ok: boolean | null, label: string) => (
    <li className="flex items-center gap-2 text-sm">{ok === false ? <CircleAlert className="h-4 w-4 text-bad" /> : <CheckCircle2 className={ok ? 'h-4 w-4 text-ok' : 'h-4 w-4 text-ink-500'} />}{label}</li>
  )
  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 font-display text-3xl font-bold"><ShieldCheck className="h-7 w-7 text-brand-600" /> Admission test</h1>
        <p className="mt-1 text-ink-300">Your application {app.reference_no && <span className="font-mono">{app.reference_no}</span>} is saved. The last step is the online admission test.</p>
      </div>
      {test.locked && <p role="alert" className="flex items-center gap-2 rounded-xl border border-bad/30 bg-bad/10 p-3 text-sm text-bad"><Lock className="h-4 w-4" />
        The test is locked after three date-of-birth mismatches. Please contact the school.</p>}
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_18rem]">
        <section className={`${card} space-y-4`}>
          <div><h2 className="font-display text-lg font-semibold">{test.title}</h2><p className="text-sm text-ink-300">{test.duration_minutes} minutes · proctored</p></div>
          {test.instructions && <PlainText text={test.instructions} />}
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-300">
            <li>Use a desktop or laptop with Google Chrome or Microsoft Edge, a camera and a microphone; sit alone in a quiet, well-lit room.</li>
            <li>The test runs in full screen. The camera, microphone level and the shared screen are supervised; nothing is recorded as video or audio.</li>
            <li>When you submit the test, your application is complete and these credentials stop working.</li>
          </ul>
          {gate && <p role="alert" className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{gate}</p>}
          {minor && (
            <fieldset className="space-y-3 rounded-2xl border border-warn/30 bg-warn/5 p-4">
              <legend className="px-1 text-sm font-medium text-fg">Parent / guardian consent</legend>
              <p className="text-xs text-ink-300">The student is under 18. A parent or guardian must agree to camera, microphone-level and screen supervision during the test.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label htmlFor="tg-name">Parent / guardian name</Label><Input id="tg-name" maxLength={200} value={guardian} onChange={(e) => setGuardian(e.target.value)} /></div>
                <div><Label htmlFor="tg-rel">Relationship</Label><Input id="tg-rel" maxLength={60} value={relationship} onChange={(e) => setRelationship(e.target.value)} /></div>
              </div>
              <label className="flex items-start gap-2 text-sm text-ink-100"><input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} id="tg-agree" />
                I am the parent / guardian and I agree to the supervised test for this student.</label>
            </fieldset>
          )}
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <Button size="lg" onClick={start} disabled={!!gate || !consentOk || busy || test.locked || !test.available} id="start-admission-test">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Rocket className="h-5 w-5" />} {test.session_status ? 'Return to the test' : 'Start the admission test'}</Button>
          {!test.available && <p className="text-sm text-warn">The test is not available yet. Please try again later or contact the school.</p>}
        </section>
        <aside className={card}>
          <h2 className="mb-2 text-sm font-semibold text-fg">Device check</h2>
          <ul className="space-y-1.5">
            {check(!gate, 'Desktop Chrome or Edge, secure connection')}
            {check(devices ? devices.camera : null, 'Camera present')}
            {check(devices ? devices.mic : null, 'Microphone present')}
            {check(preload.failed ? false : preload.done === MODEL_FILES.length ? true : null,
              preload.failed ? 'Supervision models could not load' : `Supervision models ${preload.done}/${MODEL_FILES.length}`)}
          </ul>
          <p className="mt-3 text-xs text-ink-500">You will be asked for camera, microphone and screen permissions in the test itself.</p>
        </aside>
      </div>
    </div>
  )
}
