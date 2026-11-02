import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Camera, Check, CircleAlert, Flag, Mic, NotebookPen, OctagonX, Send, ShieldQuestion, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label, Textarea } from '@/components/ui/field'
import { ErrorState, Skeleton } from '@/components/ui/loading'
import { toast } from '@/components/ui/toast'
import { useAsync } from '@/lib/useAsync'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/services/apiClient'
import { type ProctorEvent, proctoringService, type ReviewOutcome, type SessionAction } from '@/services/proctoringService'
import { SeverityBadge, StateBadge } from './badges'
import { classLabel, clockTime, dateTime, duration, SIGNALS_NOT_PROOF, timeAgo } from './format'

const OUTCOME: Record<ReviewOutcome, { label: string; hint: string }> = {
  DISMISSED: { label: 'Dismiss', hint: 'False positive — no further action' },
  NOTED: { label: 'Noted', hint: 'Seen; no action needed' },
  CONCERN: { label: 'Concern', hint: 'Follow up with the student' },
}
const ACTION_LABEL: Record<SessionAction['action'], string> = { REMARK: 'Remark', WARNING: 'Warning sent', END_SESSION: 'Session ended', REVIEW: 'Reviewed' }

/**
 * One student's proctoring record for the teacher: who / which exam, device status, the full timeline of flags with
 * review buttons, and the actions (remarks, warnings the student sees, ending the session). Opening it is audited.
 */
export function SessionDrawer({ sessionId, refresh, onClose, onChanged }: { sessionId: string; refresh: number; onClose: () => void; onChanged: () => void }) {
  const d = useAsync((signal) => proctoringService.session(sessionId, signal), [sessionId, refresh])
  const panel = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<'timeline' | 'actions'>('timeline')

  useEffect(() => {
    panel.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const changed = () => { d.retry(); onChanged() }
  const data = d.data
  const st = data?.session.last_status

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-fg/20 backdrop-blur-[1px]" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <aside ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="session-title"
        className="flex h-full w-full max-w-2xl flex-col border-l border-line bg-ink-900 shadow-2xl outline-none animate-fade-up">
        <header className="flex items-start gap-3 border-b border-line p-4">
          <div className="min-w-0 flex-1">
            {data ? (
              <>
                <h2 id="session-title" className="truncate font-display text-lg font-semibold text-fg">{data.student.full_name ?? data.student.student_code}</h2>
                <p className="text-xs text-ink-500">ID {data.student.student_code}{data.student.roll_number ? ` · Roll ${data.student.roll_number}` : ''} · {classLabel(data.student.class_name, data.student.section)}</p>
                <p className="mt-1 truncate text-sm text-ink-300">{data.session.ref_title}</p>
              </>
            ) : <h2 id="session-title" className="font-display text-lg font-semibold text-fg">Proctoring record</h2>}
          </div>
          {data && <StateBadge state={data.session.status} />}
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}><X className="h-5 w-5" /></Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {d.error && !data ? <ErrorState message={d.error} onRetry={d.retry} /> : !data ? (
            <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-64" /></div>
          ) : (
            <div className="space-y-4">
              <p className="flex gap-2 rounded-xl bg-brand-500/5 p-3 text-xs text-ink-300"><ShieldQuestion className="h-4 w-4 shrink-0 text-brand-600" />{SIGNALS_NOT_PROOF}</p>
              <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <Fact label="Started" value={dateTime(data.session.started_at)} />
                <Fact label="Last report" value={timeAgo(data.session.last_heartbeat_at)} />
                <Fact label="Rules acknowledged" value={dateTime(data.session.rules_acknowledged_at)} />
                <Fact label="Resumed" value={`${data.session.resumed_count} time${data.session.resumed_count === 1 ? '' : 's'}`} />
              </dl>
              <div className="flex flex-wrap gap-2 text-xs">
                {data.requires.camera && <Device icon={Camera} ok={st?.camera_live !== false} label={data.session.camera_label ?? 'Camera'} />}
                {data.requires.microphone && <Device icon={Mic} ok={st?.mic_live !== false && st?.mic_permission !== 'denied'} label={data.session.mic_label ?? 'Microphone'} />}
                {data.requires.fullscreen && st && <Device icon={Flag} ok={!!st.fullscreen} label={st.fullscreen ? 'Full screen' : 'Not full screen'} />}
              </div>

              <div role="tablist" className="flex gap-1 rounded-xl border border-line bg-ink-800 p-1 text-sm">
                {(['timeline', 'actions'] as const).map((t) => (
                  <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                    className={cn('flex-1 cursor-pointer rounded-lg px-3 py-1.5 font-medium', tab === t ? 'bg-ink-900 text-brand-600 shadow-sm' : 'text-ink-300 hover:text-fg')}>
                    {t === 'timeline' ? `Timeline (${data.events.length})` : `Actions (${data.actions.length})`}
                  </button>
                ))}
              </div>

              {tab === 'timeline' ? (
                data.events.length === 0 ? <p className="py-6 text-center text-sm text-ink-500">No flags recorded in this session.</p> : (
                  <ol className="space-y-2" aria-label="Event timeline">
                    {data.events.map((e) => <TimelineItem key={e.event_id} e={e} onReviewed={changed} />)}
                  </ol>
                )
              ) : (
                data.actions.length === 0 ? <p className="py-6 text-center text-sm text-ink-500">No remarks, warnings or reviews yet.</p> : (
                  <ol className="space-y-2" aria-label="Actions">
                    {data.actions.map((a) => (
                      <li key={a.action_id} className="rounded-xl border border-line p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
                          <b className="text-fg">{ACTION_LABEL[a.action]}{a.outcome ? ` · ${OUTCOME[a.outcome].label}` : ''}</b>
                          <span>{a.actor_name ?? a.actor_code}</span><span>{dateTime(a.created_at)}</span>
                          {a.action === 'WARNING' && <span>{a.acknowledged_at ? `acknowledged ${clockTime(a.acknowledged_at)}` : a.delivered_at ? 'shown, not yet acknowledged' : 'waiting to be shown'}</span>}
                        </div>
                        {a.message && <p className="mt-1 whitespace-pre-line text-ink-100">{a.message}</p>}
                      </li>
                    ))}
                  </ol>
                )
              )}
              <p className="text-[11px] text-ink-500">Every flag and action here is kept in an append-only audit log. Opened {data.views} time{data.views === 1 ? '' : 's'} by staff.</p>
            </div>
          )}
        </div>

        {data && <ActionBar sessionId={sessionId} canEnd={data.can_end} open={['PRECHECK', 'ACTIVE', 'INTERRUPTED'].includes(data.session.status)} onDone={changed} />}
      </aside>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-ink-800 px-2.5 py-1.5"><dt className="text-ink-500">{label}</dt><dd className="font-medium text-fg">{value}</dd></div>
}

function Device({ icon: Icon, ok, label }: { icon: typeof Camera; ok: boolean; label: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5', ok ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad')}><Icon className="h-3.5 w-3.5" aria-hidden />{label}{ok ? '' : ' — issue'}</span>
}

function TimelineItem({ e, onReviewed }: { e: ProctorEvent; onReviewed: () => void }) {
  const [busy, setBusy] = useState<ReviewOutcome | null>(null)
  async function review(outcome: ReviewOutcome) {
    setBusy(outcome)
    try { await proctoringService.review(e.event_id, outcome); onReviewed() } catch (err) { toast(errorMessage(err), 'error') } finally { setBusy(null) }
  }
  const details = Object.entries(e.details ?? {}).filter(([, v]) => v !== null && v !== '')
  return (
    <li className={cn('rounded-xl border p-3', e.review ? 'border-line opacity-80' : e.severity === 'High' || e.severity === 'Critical' ? 'border-bad/30' : 'border-line')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs tabular-nums text-ink-500">{clockTime(e.client_ts ?? e.server_ts)}</span>
        <SeverityBadge severity={e.severity} />
        <span className="text-sm font-medium text-fg">{e.label}</span>
        {e.duration_ms > 0 && <span className="text-xs text-ink-500">{duration(e.duration_ms)}</span>}
        {e.source === 'server' && <span className="text-[11px] text-ink-500">(server)</span>}
      </div>
      {details.length > 0 && <p className="mt-1 text-xs text-ink-500">{details.map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}</p>}
      {e.severity !== 'Info' && (e.review ? (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-ink-300"><Check className="h-3.5 w-3.5 text-ok" /> {OUTCOME[e.review.outcome].label} by {e.review.by} · {dateTime(e.review.at)}{e.review.note ? ` — ${e.review.note}` : ''}</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={`Review ${e.label}`}>
          {(Object.keys(OUTCOME) as ReviewOutcome[]).map((o) => (
            <Button key={o} size="sm" variant={o === 'CONCERN' ? 'danger' : 'secondary'} title={OUTCOME[o].hint} disabled={!!busy} onClick={() => void review(o)}>{OUTCOME[o].label}</Button>
          ))}
        </div>
      ))}
    </li>
  )
}

function ActionBar({ sessionId, canEnd, open, onDone }: { sessionId: string; canEnd: boolean; open: boolean; onDone: () => void }) {
  const [mode, setMode] = useState<'remark' | 'warn' | 'end' | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!mode) return
    setBusy(true); setError(null)
    try {
      if (mode === 'remark') await proctoringService.remark(sessionId, text.trim())
      else if (mode === 'warn') await proctoringService.warn(sessionId, text.trim())
      else await proctoringService.end(sessionId, text.trim())
      toast(mode === 'remark' ? 'Remark saved' : mode === 'warn' ? 'Warning sent — the student sees it within seconds' : 'Session ended', 'success')
      setMode(null); setText(''); onDone()
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  const PROMPT = { remark: 'Private remark (the student does not see this)', warn: 'Warning shown to the student', end: 'Reason for ending the session (recorded)' }
  return (
    <footer className="border-t border-line p-4">
      {mode ? (
        <form onSubmit={submit} className="space-y-2">
          <Label htmlFor="proctor-action-text">{PROMPT[mode]}</Label>
          <Textarea id="proctor-action-text" rows={3} maxLength={mode === 'end' ? 500 : 1000} value={text} onChange={(e) => setText(e.target.value)} autoFocus
            placeholder={mode === 'warn' ? 'e.g. Please keep your face in view of the camera.' : undefined} />
          {mode === 'end' && <p className="flex gap-1.5 text-xs text-bad"><CircleAlert className="h-3.5 w-3.5 shrink-0" /> The student’s exam closes now and what they saved so far is handed in. This cannot be undone.</p>}
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setMode(null); setError(null) }}>Cancel</Button>
            <Button type="submit" variant={mode === 'end' ? 'danger' : 'default'} disabled={busy || text.trim().length < (mode === 'end' ? 3 : 2)}>
              {mode === 'remark' ? 'Save remark' : mode === 'warn' ? 'Send warning' : 'End session now'}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setMode('remark')}><NotebookPen className="h-4 w-4" /> Add remark</Button>
          {open && <Button variant="secondary" onClick={() => setMode('warn')}><Send className="h-4 w-4" /> Warn student</Button>}
          {open && canEnd && <Button variant="danger" className="ml-auto" onClick={() => setMode('end')}><OctagonX className="h-4 w-4" /> End session</Button>}
        </div>
      )}
    </footer>
  )
}
