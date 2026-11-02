import { useEffect, useRef, useState } from 'react'
import { Camera, Eye, Maximize, MonitorUp, Radio, Square, Wifi } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/services/apiClient'
import { admissionTestService as svc, type LiveSession } from '@/services/admissionTestService'

const STATUS = { LAUNCHED: 'Launched', CONFIRMED: 'Identity confirmed', CHECKED: 'Checks done', IN_PROGRESS: 'In progress', SUBMITTED: 'Submitted', ENDED: 'Ended', LOCKED: 'Locked (DOB)' } as const
const BAND_TONE = { High: 'ok', Moderate: 'warn', Low: 'bad' } as const
const SEV_TONE: Record<string, 'bad' | 'warn' | 'brand'> = { Crit: 'bad', High: 'warn', Med: 'brand' }

/** Live monitor (open it on another device): progress, time left, status chips, integrity, warnings, latest flags. */
export function LiveTab({ testId }: { testId?: string }) {
  const [rows, setRows] = useState<LiveSession[] | null>(null)
  const [hot, setHot] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const since = useRef<string | null>(null)

  useEffect(() => {
    let live = true
    const poll = async () => {
      try {
        const d = await svc.live(testId, since.current ?? undefined)
        if (!live) return
        setRows(d.sessions)
        setError(null)
        if (since.current) {
          for (const a of d.alerts) toast(`⚠ ${a.candidate_name}: ${a.label}`, 'error')
          const ids = d.alerts.map((a) => a.session_id)
          if (ids.length) {
            setHot((h) => new Set([...h, ...ids]))
            setTimeout(() => setHot((h) => new Set([...h].filter((x) => !ids.includes(x)))), 15_000)
          }
        }
        since.current = d.server_time
      } catch (e) { if (live) setError(errorMessage(e)) }
    }
    void poll()
    const t = setInterval(() => void poll(), 10_000)
    return () => { live = false; clearInterval(t) }
  }, [testId])

  async function end(r: LiveSession) {
    if (!confirm(`End ${r.candidate_name}'s test now? Their answers so far are kept and scored.`)) return
    try { await svc.endSession(r.session_id); toast(`✓ Ended ${r.candidate_name}'s test`); setRows((x) => x?.map((s) => (s.session_id === r.session_id ? { ...s, status: 'ENDED' } : s)) ?? null) }
    catch (e) { toast(`✗ ${errorMessage(e)}`) }
  }

  const chip = (ok: boolean | undefined, Icon: typeof Camera, label: string) => (
    <span title={`${label}: ${ok === undefined ? 'unknown' : ok ? 'OK' : 'problem'}`} aria-label={`${label} ${ok === undefined ? 'unknown' : ok ? 'OK' : 'problem'}`}
      className={cn('inline-grid h-6 w-6 place-items-center rounded-full border', ok === undefined ? 'border-line text-ink-500' : ok ? 'border-ok/30 bg-ok/10 text-ok' : 'border-bad/30 bg-bad/10 text-bad')}>
      <Icon className="h-3.5 w-3.5" /></span>
  )
  const fmt = (s: number | null) => (s === null ? '—' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)

  if (!rows) return error ? <p role="alert" className="text-sm text-bad">{error}</p> : <div className="skeleton h-48" />
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm text-ink-300"><Radio className="h-4 w-4 text-ok" /> Updates every 10 seconds. Open this page on another device while candidates sit the test.</p>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      {rows.length === 0 ? <p className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-ink-300">No active sessions.</p> : (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full text-sm">
            <caption className="sr-only">Active sessions</caption>
            <thead className="bg-ink-800 text-xs text-ink-300"><tr>
              <th className="px-3 py-2 text-left font-medium">Candidate</th><th className="px-3 py-2 text-left font-medium">Status</th><th className="px-3 py-2 text-left font-medium">Progress</th>
              <th className="px-3 py-2 text-left font-medium">Time left</th><th className="px-3 py-2 text-left font-medium">Live</th><th className="px-3 py-2 text-left font-medium">Integrity</th>
              <th className="px-3 py-2 text-left font-medium">Warnings</th><th className="px-3 py-2 text-left font-medium">Latest flags</th><th className="px-3 py-2" /></tr></thead>
            <tbody>{rows.map((r) => {
              const open = !['SUBMITTED', 'ENDED'].includes(r.status)
              const c = r.chips
              return (
                <tr key={r.session_id} className={cn('border-t border-line transition-colors', hot.has(r.session_id) && 'bg-bad/10')}>
                  <td className="px-3 py-2"><div className="font-medium text-fg">{r.candidate_name}</div><div className="text-xs text-ink-500">{r.test_title}</div></td>
                  <td className="px-3 py-2"><Badge tone={r.status === 'LOCKED' ? 'bad' : open ? 'brand' : 'neutral'}>{STATUS[r.status]}</Badge>
                    {r.heartbeat_stale && <div className="mt-1 text-xs text-bad">No heartbeat</div>}</td>
                  <td className="px-3 py-2 tabular-nums">{r.total ? `${r.answered}/${r.total}` : '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{fmt(r.seconds_left)}</td>
                  <td className="px-3 py-2"><div className="flex gap-1">{chip(c.camera_live, Camera, 'Camera')}{chip(c.screen_live, MonitorUp, 'Screen')}{chip(c.fullscreen, Maximize, 'Full screen')}{chip(c.online, Wifi, 'Online')}{chip(c.faces === undefined || c.faces === null ? undefined : c.faces === 1, Eye, `Faces ${c.faces ?? '?'}`)}</div></td>
                  <td className="px-3 py-2"><Badge tone={BAND_TONE[r.integrity_band]}>{r.integrity_score}</Badge></td>
                  <td className="px-3 py-2 tabular-nums">{r.warnings}/{r.max_warnings}</td>
                  <td className="px-3 py-2 text-xs">{r.latest_flags.length ? r.latest_flags.map((f, i) => (
                    <div key={i}><Badge tone={SEV_TONE[f.severity] ?? 'neutral'} className="mr-1">{f.severity}</Badge>{f.label} <span className="text-ink-500">{new Date(f.at).toLocaleTimeString()}</span></div>
                  )) : <span className="text-ink-500">None</span>}</td>
                  <td className="px-3 py-2 text-right">{open && <Button size="sm" variant="danger" onClick={() => end(r)} aria-label={`End session of ${r.candidate_name}`}><Square className="h-3.5 w-3.5" /> End</Button>}</td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
