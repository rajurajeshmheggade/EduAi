import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, Bookmark, Camera, ChevronLeft, ChevronRight, Loader2, Maximize, Mic, MonitorUp, Send, ShieldAlert, UserCog, Wifi } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label, Textarea } from '@/components/ui/field'
import { toast } from '@/components/ui/toast'
import { AnswerQueue } from '@/lib/proctor/answerQueue'
import { ProctorEngine, type Hud, type LocalFlag, type PauseReason } from '@/lib/proctor/engine'
import { exam, examStore, type ExamAnswer, type ExamQuestion, type ExamView, type StatusInfo } from '@/lib/proctor/examApi'
import { sleep, type ProctorMedia } from '@/lib/proctor/media'
import { EventTransport } from '@/lib/proctor/transport'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/services/apiClient'

const NUDGE: Record<string, string> = {
  FULLSCREEN_EXIT: 'Stay in full screen.', TAB_HIDDEN: 'Stay on the test — do not switch tabs or apps.', WINDOW_BLUR: 'Keep the test window in focus.',
  NO_FACE: 'Keep your face in view of the camera.', MULTIPLE_FACES: 'Only you should be in view of the camera.', LOOKING_AWAY: 'Please keep your eyes on the screen.',
  PHONE_DETECTED: 'Put your phone away, out of view.', BOOK_OR_PAPER: 'Put books and notes away.', EXTRA_DEVICE: 'Turn other screens and laptops away.',
  VOICE_DETECTED: 'Please work silently.', COPY_PASTE: 'Copy and paste are switched off.', PASTE_BURST: 'Please type your answers yourself.',
  BLOCKED_SHORTCUT: 'That key combination is switched off.', CONTEXT_MENU: 'Right-click is switched off.', PRINT_ATTEMPT: 'Printing is switched off.',
  DEVTOOLS_SUSPECTED: 'Please close developer tools.', WINDOW_RESIZED: 'Keep the window full size.', EXTENSION_INJECTION: 'A browser extension changed the page. Tell your teacher.',
  NETWORK_OFFLINE: 'The connection dropped. Your answers are kept and will sync.', CAMERA_LOST: 'The camera stopped.', CAMERA_BLOCKED: 'Your camera looks covered or dark.',
  SCREEN_SHARE_STOPPED: 'Screen sharing stopped.', MULTI_MONITOR: 'A second screen is connected.',
  FACE_MISMATCH: 'We could not match your face to your ID photo. Face the camera.', HEARTBEAT_MISSING: 'Proctoring stopped reporting for a while. Keep this page open and in front.',
  PORTAL_ACCESS_ATTEMPT: 'The EduAI portal is locked during the test.', SECOND_SESSION: 'The test was opened somewhere else.', PERF_DEGRADED: 'This computer is running slowly.',
}
const PAUSE_TEXT: Record<PauseReason, string> = {
  fullscreen: 'Return to full screen to continue.', camera: 'Your camera stopped. Turn it back on to continue.',
  screen: 'Screen sharing stopped. Share your entire screen again to continue.', monitor: 'Disconnect the second screen to continue.',
}
const LETTER = 'ABCDEFGH'
const answeredQ = (q: ExamQuestion, a: ExamAnswer | null | undefined) =>
  !!a && (q.qtype === 'MULTI' ? !!a.options?.length : q.qtype === 'MCQ' || q.qtype === 'SJT' ? a.option !== undefined : q.qtype === 'NUMERICAL' ? !!a.value?.trim() : !!a.text?.trim())

export function Runner({ view, media, reference, baseline, onEnded }: {
  view: ExamView
  media: ProctorMedia
  reference: number[] | null
  baseline: { yaw: number; pitch: number }
  onEnded: (reason: string | null) => void
}) {
  const questions = useMemo(() => view.questions ?? [], [view.questions])
  const sections = view.test.sections.filter((s) => questions.some((q) => q.section === s.key))
  const [answers, setAnswers] = useState<Record<string, ExamAnswer | null>>(() => view.answers ?? {})
  const [index, setIndex] = useState(() => Math.max(0, questions.findIndex((q) => !answeredQ(q, view.answers?.[q.question_id]))))
  const [marked, setMarked] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<StatusInfo>(view)
  const [hud, setHud] = useState<Hud | null>(null)
  const [pauses, setPauses] = useState<PauseReason[]>([])
  const [modals, setModals] = useState<LocalFlag[]>([])
  const [save, setSave] = useState({ pending: 0, offline: false, error: null as string | null })
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const [supervisor, setSupervisor] = useState(false)
  const [ending, setEnding] = useState<string | null>(null)
  const offset = useRef(Date.parse(view.server_time) - Date.now())
  const [now, setNow] = useState(() => Date.now())
  const engine = useRef<ProctorEngine | null>(null)
  const queue = useRef<AnswerQueue | null>(null)
  const active = useRef({ qid: questions[0]?.question_id ?? '', since: Date.now() })
  const ended = useRef(false)
  const answersRef = useRef(answers)
  const preview = useRef<HTMLVideoElement>(null)

  const finish = useCallback(async (reason: string | null) => {
    if (ended.current) return
    ended.current = true
    engine.current?.stop()
    await queue.current?.flush().catch(() => {})
    media.stop()
    try { (navigator as Navigator & { keyboard?: { unlock(): void } }).keyboard?.unlock() } catch { /* not supported */ }
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
    onEnded(reason)
  }, [media, onEnded])

  const onStatus = useCallback((st: StatusInfo) => {
    setStatus(st)
    if (st.ended) void finish(st.submit_reason)
  }, [finish])

  // ---------------------------------------------------------------- set-up: autosave queue, transport, engine
  useEffect(() => {
    const s = examStore.get()!
    const q = new AnswerQueue(s.sessionId, (qid, a, t) => exam.answer(qid, a, t))
    q.onChange = setSave
    void q.restore().then((rows) => { if (rows.length) setAnswers((x) => ({ ...x, ...Object.fromEntries(rows.map((r) => [r.question_id, r.answer])) })) })
    queue.current = q
    const transport = new EventTransport({
      nextSeq: () => examStore.nextSeq(), send: (evs) => exam.events(evs),
      upload: (blob, kind, seq) => exam.evidence(blob, kind, seq), onStatus: (st) => onStatus(st),
    })
    const e = new ProctorEngine({
      media, rules: view.rules, transport, startedAt: Date.parse(view.started_at ?? view.server_time) - offset.current, reference, baseline,
      answered: () => questions.filter((x) => answeredQ(x, answersRef.current[x.question_id])).length,
      heartbeat: (h) => exam.heartbeat(h), presence: (b) => exam.evidence(b, 'presence'),
      onFlag: (f) => {
        if (f.modal) setModals((m) => [...m, f])
        else toast(NUDGE[f.code] ?? f.label, f.severity === 'Low' ? 'info' : 'error')
      },
      onHud: setHud, onPause: setPauses, onServer: (st) => onStatus(st),
    })
    engine.current = e
    e.start()
    const online = () => void q.flush()
    window.addEventListener('online', online)
    // Back / forward stay inside the exam.
    history.pushState(null, '', location.href)
    const pop = () => history.pushState(null, '', location.href)
    window.addEventListener('popstate', pop)
    const hide = () => { void q.flush(); exam.release() }
    window.addEventListener('pagehide', hide)
    return () => {
      e.stop()
      window.removeEventListener('online', online)
      window.removeEventListener('popstate', pop)
      window.removeEventListener('pagehide', hide)
    }
  // The exam runs once per mount; later prop changes must not restart proctoring.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // After a reload the in-memory face template is gone: take a fresh one from the first clear single-face frame.
  useEffect(() => {
    if (reference || !view.rules.require_camera) return
    let live = true
    void (async () => {
      for (let i = 0; i < 60 && live; i++) {
        const r = await media.analyse({ embed: true })
        if (r?.faces === 1 && r.embedding) { engine.current?.setReference(r.embedding); return }
        await sleep(1000)
      }
    })()
    return () => { live = false }
  }, [media, reference, view.rules.require_camera])

  useEffect(() => { answersRef.current = answers }, [answers])
  useEffect(() => {
    if (preview.current && media.camera) { preview.current.srcObject = media.camera; void preview.current.play().catch(() => {}) }
  }, [media])

  // ---------------------------------------------------------------- server timer
  const deadline = status.deadline_at ? Date.parse(status.deadline_at) : null
  const left = deadline ? Math.max(0, Math.floor((deadline - (now + offset.current)) / 1000)) : null
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (left !== 0 || ended.current) return
    setEnding('Time is up — submitting your answers…')
    let live = true
    void (async () => {
      await queue.current?.flush().catch(() => {})
      while (live && !ended.current) {
        try { const st = await exam.status(); if (st.ended) { onStatus(st); return } } catch { /* retry */ }
        await sleep(3000)
      }
    })()
    return () => { live = false }
  }, [left, onStatus])

  // ---------------------------------------------------------------- answering
  const q = questions[index]
  function takeTime(qid: string) {
    const a = active.current
    const t = a.qid === qid ? Date.now() - a.since : 0
    active.current = { qid, since: Date.now() }
    return t
  }
  function setAnswer(a: ExamAnswer | null) {
    if (!q) return
    setAnswers((x) => ({ ...x, [q.question_id]: a }))
    queue.current?.change(q.question_id, a, takeTime(q.question_id))
  }
  function go(i: number) {
    if (!q || i === index || i < 0 || i >= questions.length) return
    const t = takeTime(questions[i].question_id)
    if (answers[q.question_id] && t > 0) queue.current?.change(q.question_id, answers[q.question_id], t)
    setIndex(i)
  }
  const unanswered = questions.filter((x) => !answeredQ(x, answers[x.question_id]))

  async function submit() {
    setConfirmSubmit(false)
    setEnding('Submitting your answers…')
    await queue.current?.flush().catch(() => {})
    try { const st = await exam.submit(); onStatus({ ...st, ended: true }) } catch (e) { setEnding(null); toast(errorMessage(e), 'error') }
  }

  const modal = modals[0]
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const chip = (ok: boolean | undefined, Icon: typeof Camera, label: string) => (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]', ok ? 'border-ok/30 bg-ok/10 text-ok' : 'border-bad/30 bg-bad/10 text-bad')}
      title={`${label}: ${ok ? 'OK' : 'problem'}`}><Icon className="h-3 w-3" />{label}</span>
  )

  return (
    <div className="exam-root flex h-full flex-col select-none" data-testid="exam-runner">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-ink-900 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-base font-semibold text-fg">{view.test.title}</div>
          <div className="text-xs text-ink-500">{view.candidate.full_name}</div>
        </div>
        <Badge tone={status.warnings_count ? 'warn' : 'neutral'} aria-label={`Warnings ${status.warnings_count} of ${status.max_warnings}`}>
          <ShieldAlert className="h-3 w-3" /> {status.warnings_count} / {status.max_warnings}</Badge>
        <div className={cn('rounded-xl px-3 py-1 font-display text-lg font-bold tabular-nums', left !== null && left < 300 ? 'bg-warn/15 text-warn' : 'bg-ink-800 text-fg')}
          role="timer" aria-label="Time left" data-testid="exam-timer">{left === null ? '--:--' : fmt(left)}</div>
        <Button size="sm" variant="ghost" onClick={() => setSupervisor(true)} id="supervisor"><UserCog className="h-4 w-4" /> Supervisor</Button>
      </header>
      {(save.offline || save.error) && (
        <p role="status" className={cn('px-4 py-1.5 text-center text-sm', save.offline ? 'bg-warn/15 text-warn' : 'bg-bad/15 text-bad')}>
          {save.offline ? `Offline — ${save.pending} answer(s) kept on this device and will sync when the connection returns.` : save.error}
        </p>
      )}
      <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[1fr_17rem]">
        <section className="flex min-h-0 flex-col rounded-2xl border border-line bg-ink-900" aria-label="Question">
          <div className="flex gap-1 overflow-x-auto border-b border-line p-2" role="tablist" aria-label="Sections">
            {sections.map((s) => {
              const first = questions.findIndex((x) => x.section === s.key)
              return <button key={s.key} role="tab" aria-selected={q?.section === s.key} onClick={() => go(first)}
                className={cn('shrink-0 cursor-pointer rounded-lg px-3 py-1.5 text-sm', q?.section === s.key ? 'bg-brand-500/10 font-medium text-brand-600' : 'text-ink-300 hover:bg-ink-800')}>{s.title}</button>
            })}
          </div>
          {q && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-display text-lg font-semibold text-fg"><span className="text-ink-500">Q{q.number}.</span> <span className="whitespace-pre-line">{q.prompt}</span></h2>
                {q.marks !== null && <Badge>{q.marks} mark{q.marks === 1 ? '' : 's'}</Badge>}
              </div>
              <AnswerInput q={q} value={answers[q.question_id] ?? null} onChange={setAnswer} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-line p-3">
            <Button variant="secondary" onClick={() => go(index - 1)} disabled={index === 0}><ChevronLeft className="h-4 w-4" /> Previous</Button>
            <Button variant="ghost" aria-pressed={q ? marked.has(q.question_id) : false}
              onClick={() => q && setMarked((m) => { const n = new Set(m); if (n.has(q.question_id)) n.delete(q.question_id); else n.add(q.question_id); return n })}>
              <Bookmark className="h-4 w-4" /> {q && marked.has(q.question_id) ? 'Marked for review' : 'Mark for review'}</Button>
            <span className="ml-auto text-xs text-ink-500" aria-live="polite">{save.pending ? 'Saving…' : 'All answers saved'}</span>
            {index < questions.length - 1
              ? <Button onClick={() => go(index + 1)} id="next-question">Next <ChevronRight className="h-4 w-4" /></Button>
              : <Button onClick={() => setConfirmSubmit(true)} id="submit-exam"><Send className="h-4 w-4" /> Submit</Button>}
          </div>
        </section>
        <aside className="space-y-3" aria-label="Proctoring">
          <div className="rounded-2xl border border-line bg-ink-900 p-3">
            <video ref={preview} muted playsInline className="aspect-[4/3] w-full -scale-x-100 rounded-xl bg-black object-cover" aria-label="Your camera (what is monitored)" />
            <div className="mt-2 flex flex-wrap gap-1">
              {chip(hud?.camera, Camera, 'Camera')}{chip(hud?.mic, Mic, 'Mic')}{view.rules.require_screen_share && chip(hud?.screen, MonitorUp, 'Screen')}
              {chip(hud?.fullscreen, Maximize, 'Full screen')}{chip(hud?.online, Wifi, 'Network')}
            </div>
            {hud?.hint && <p className="mt-2 text-xs text-warn" aria-live="polite">{hud.hint}</p>}
          </div>
          <div className="rounded-2xl border border-line bg-ink-900 p-3">
            <div className="mb-2 flex justify-between text-xs text-ink-500"><span>{questions.length - unanswered.length}/{questions.length} answered</span><span>{marked.size} marked</span></div>
            <ol className="grid grid-cols-6 gap-1.5" aria-label="Question navigator">
              {questions.map((x, i) => {
                const done = answeredQ(x, answers[x.question_id])
                return (
                  <li key={x.question_id}>
                    <button onClick={() => go(i)} aria-label={`Question ${x.number}${done ? ', answered' : ''}${marked.has(x.question_id) ? ', marked' : ''}`} aria-current={i === index}
                      className={cn('h-8 w-full cursor-pointer rounded-lg border text-xs tabular-nums', i === index && 'ring-2 ring-brand-400',
                        marked.has(x.question_id) ? 'border-warn/40 bg-warn/15 text-warn' : done ? 'border-brand-400/40 bg-brand-500/15 text-brand-600' : 'border-line text-ink-300')}>
                      {x.number}
                    </button>
                  </li>
                )
              })}
            </ol>
          </div>
        </aside>
      </div>

      {pauses.length > 0 && !ending && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-ink-950/95 p-6 backdrop-blur" role="alertdialog" aria-labelledby="pause-h" data-testid="pause-overlay">
          <div className="max-w-lg space-y-4 text-center">
            <AlertTriangle className="mx-auto h-12 w-12 text-warn" />
            <h2 id="pause-h" className="font-display text-2xl font-bold text-fg">Test paused</h2>
            <ul className="space-y-1 text-ink-100">{pauses.map((p) => <li key={p}>{PAUSE_TEXT[p]}</li>)}</ul>
            <p className="text-sm text-warn">The timer keeps running while the test is paused.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {pauses.includes('fullscreen') && <Button id="resume-fullscreen" onClick={() => void document.documentElement.requestFullscreen({ navigationUI: 'hide' })
                .then(() => (navigator as Navigator & { keyboard?: { lock(): Promise<void> } }).keyboard?.lock().catch(() => {})).catch(() => {})}>
                <Maximize className="h-4 w-4" /> Return to full screen</Button>}
              {pauses.includes('screen') && <Button onClick={() => void media.startScreen().then(() => engine.current?.rebindScreen()).catch((e) => toast(errorMessage(e), 'error'))}>
                <MonitorUp className="h-4 w-4" /> Share entire screen</Button>}
              {pauses.includes('camera') && <Button onClick={() => void media.startCamera().then(() => engine.current?.unpause('camera')).catch((e) => toast(errorMessage(e), 'error'))}>
                <Camera className="h-4 w-4" /> Turn camera on</Button>}
            </div>
          </div>
        </div>
      )}

      {/* Warnings wait until a pause is fixed (a modal dialog would sit above the pause overlay). */}
      {modal && !ending && pauses.length === 0 && (
        <Dialog open onClose={() => setModals((m) => m.slice(1))} title={`Warning ${Math.max(1, status.warnings_count)} of ${status.max_warnings}`} className="w-[min(30rem,calc(100vw-2rem))]">
          <div className="space-y-3" role="alert">
            <p className="font-medium text-fg">{modal.label}</p>
            <p className="text-sm text-ink-300">{NUDGE[modal.code] ?? ''} After {status.max_warnings} warnings the test is submitted automatically.</p>
            {modal.evidence && <img src={modal.evidence} alt="Snapshot taken for this warning" className="mx-auto max-h-40 rounded-xl" />}
            <Button className="w-full" onClick={() => setModals((m) => m.slice(1))} id="ack-warning">I understand</Button>
          </div>
        </Dialog>
      )}

      {confirmSubmit && (
        <Dialog open onClose={() => setConfirmSubmit(false)} title="Submit the test?">
          <div className="space-y-3">
            {unanswered.length ? <p className="text-sm text-warn">You have not answered {unanswered.length} question{unanswered.length === 1 ? '' : 's'}: {unanswered.map((x) => x.number).join(', ')}.</p>
              : <p className="text-sm text-ink-300">All questions are answered.</p>}
            <p className="text-sm text-ink-300">You cannot change your answers after submitting.</p>
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setConfirmSubmit(false)}>Keep working</Button><Button onClick={submit} id="confirm-submit">Submit now</Button></div>
          </div>
        </Dialog>
      )}
      {supervisor && <SupervisorDialog onClose={() => setSupervisor(false)} onEnded={(st) => { setSupervisor(false); onStatus({ ...st, ended: true }) }} />}
      {ending && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/95" role="status"><p className="flex items-center gap-2 text-lg text-fg"><Loader2 className="h-5 w-5 animate-spin" /> {ending}</p></div>
      )}
    </div>
  )
}

function AnswerInput({ q, value, onChange }: { q: ExamQuestion; value: ExamAnswer | null; onChange: (a: ExamAnswer | null) => void }) {
  if (q.qtype === 'MCQ' || q.qtype === 'SJT') {
    return (
      <fieldset className="space-y-2"><legend className="sr-only">Choose one answer</legend>
        {q.options.map((o, i) => (
          <label key={o.id} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm', value?.option === o.id ? 'border-brand-400/60 bg-brand-500/10 text-fg' : 'border-line text-ink-100 hover:bg-ink-800')}>
            <input type="radio" name={q.question_id} className="mt-0.5 accent-brand-500" checked={value?.option === o.id} onChange={() => onChange({ option: o.id })} />
            <span><b className="mr-1 text-ink-500">{LETTER[i]}.</b>{o.text}</span>
          </label>
        ))}
      </fieldset>
    )
  }
  if (q.qtype === 'MULTI') {
    const sel = new Set(value?.options ?? [])
    return (
      <fieldset className="space-y-2"><legend className="text-xs text-ink-500">Choose all that apply</legend>
        {q.options.map((o, i) => (
          <label key={o.id} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm', sel.has(o.id) ? 'border-brand-400/60 bg-brand-500/10' : 'border-line hover:bg-ink-800')}>
            <input type="checkbox" className="mt-0.5 accent-brand-500" checked={sel.has(o.id)}
              onChange={() => { const n = new Set(sel); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); onChange(n.size ? { options: [...n] } : null) }} />
            <span><b className="mr-1 text-ink-500">{LETTER[i]}.</b>{o.text}</span>
          </label>
        ))}
      </fieldset>
    )
  }
  if (q.qtype === 'NUMERICAL') {
    return <div className="max-w-xs"><Label htmlFor={`a-${q.question_id}`}>Your answer (a number)</Label>
      <Input id={`a-${q.question_id}`} inputMode="decimal" autoComplete="off" spellCheck={false} maxLength={40} value={value?.value ?? ''} onChange={(e) => onChange(e.target.value ? { value: e.target.value } : null)} /></div>
  }
  const rows = q.qtype === 'SHORT' ? 3 : 9
  const hint = q.qtype === 'IDEAS' ? 'Write one idea per line.' : q.qtype === 'REFLECTIVE' ? 'Write about 80–200 words.' : null
  const words = (value?.text ?? '').trim().split(/\s+/).filter(Boolean).length
  return (
    <div>
      <Label htmlFor={`a-${q.question_id}`}>Your answer</Label>
      <Textarea id={`a-${q.question_id}`} rows={rows} maxLength={5000} autoComplete="off" spellCheck={false} value={value?.text ?? ''}
        onChange={(e) => onChange(e.target.value ? { text: e.target.value } : null)} className="select-text" />
      <p className="mt-1 flex justify-between text-xs text-ink-500"><span>{hint}</span><span>{words} words</span></p>
    </div>
  )
}

function SupervisorDialog({ onClose, onEnded }: { onClose: () => void; onEnded: (st: StatusInfo) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try { onEnded(await exam.supervisorEnd(email.trim(), password)) } catch (err) { setError(errorMessage(err)); setPassword('') } finally { setBusy(false) }
  }
  return (
    <Dialog open onClose={onClose} title="Supervisor: end this test" description="Only the teacher who launched the test (or a school administrator).">
      <form onSubmit={submit} className="space-y-3">
        <div><Label htmlFor="sv-email">Email</Label><Input id="sv-email" type="email" autoComplete="off" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><Label htmlFor="sv-password">Password</Label><Input id="sv-password" type="password" autoComplete="off" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" variant="danger" disabled={busy}>End test</Button></div>
      </form>
    </Dialog>
  )
}
