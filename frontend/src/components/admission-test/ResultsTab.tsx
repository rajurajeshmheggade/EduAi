import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, FileText, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Select } from '@/components/ui/field'
import { ErrorState } from '@/components/ui/loading'
import { toast } from '@/components/ui/toast'
import { errorMessage } from '@/services/apiClient'
import { admissionTestService as svc, type AdmTest, type ResultRow } from '@/services/admissionTestService'

const BAND_TONE = { High: 'ok', Moderate: 'warn', Low: 'bad' } as const
const REC_TONE = (b: string | null) => (!b ? 'neutral' : b.startsWith('Strongly') ? 'ok' : b === 'Recommended' ? 'ok' : b === 'Borderline' ? 'warn' : b.startsWith('On hold') ? 'bad' : 'neutral')

/** Completed sessions with composite, band, academic, HQ and integrity; open the report, regenerate, export CSV. */
export function ResultsTab({ tests, org, reportBase = '/teacher/admissions/reports', readOnly }: { tests: AdmTest[] | null; org?: string; reportBase?: string; readOnly?: boolean }) {
  const [testId, setTestId] = useState('')
  const [rows, setRows] = useState<ResultRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => svc.results(testId || undefined, org).then(setRows).catch((e) => setError(errorMessage(e))), [testId, org])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!rows?.some((r) => r.report_status === 'PENDING' || r.report_status === 'RUNNING')) return
    const t = setTimeout(() => void load(), 4000)
    return () => clearTimeout(t)
  }, [rows, load])

  async function csv() {
    try {
      const blob = await svc.resultsCsv(testId || undefined, org)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'admission-results.csv'
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) { toast(`✗ ${errorMessage(e)}`) }
  }
  const pct = (v: number | null) => (v === null || v === undefined ? '—' : `${Math.round(v)}`)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Filter by test" className="w-72" value={testId} onChange={(e) => setTestId(e.target.value)}>
          <option value="">All tests</option>{(tests ?? []).map((t) => <option key={t.test_id} value={t.test_id}>{t.title}</option>)}</Select>
        <Button variant="secondary" className="ml-auto" onClick={csv}><Download className="h-4 w-4" /> Export CSV</Button>
      </div>
      {error && <ErrorState title="Couldn’t load results" message={error} onRetry={() => { setError(null); void load() }} />}
      {!rows ? !error && <div className="skeleton h-48" /> : rows.length === 0 ? <p className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-ink-300">No completed sessions yet.</p> : (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full text-sm">
            <caption className="sr-only">Results</caption>
            <thead className="bg-ink-800 text-xs text-ink-300"><tr>
              <th className="px-3 py-2 text-left font-medium">Candidate</th><th className="px-3 py-2 text-left font-medium">Recommendation</th>
              <th className="px-3 py-2 text-right font-medium">Composite</th><th className="px-3 py-2 text-right font-medium">Academic %</th><th className="px-3 py-2 text-right font-medium">HQ</th>
              <th className="px-3 py-2 text-left font-medium">Integrity</th><th className="px-3 py-2 text-left font-medium">Ended</th><th className="px-3 py-2" /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.session_id} className="border-t border-line">
                <td className="px-3 py-2"><div className="font-medium text-fg">{r.candidate_name}</div><div className="text-xs text-ink-500">{r.test_title} · {r.grade_applying}</div></td>
                <td className="px-3 py-2">{r.band ? <Badge tone={REC_TONE(r.band)}>{r.band}</Badge> : <span className="text-xs text-ink-500">{r.report_status === 'FAILED' ? 'Report failed' : 'Scoring…'}</span>}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-fg">{pct(r.composite)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{pct(r.academic_pct)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{pct(r.hq_composite)}{r.hq_band ? <div className="text-xs text-ink-500">{r.hq_band}</div> : null}</td>
                <td className="px-3 py-2"><Badge tone={BAND_TONE[r.integrity_band]}>{r.integrity_score} · {r.integrity_band}</Badge></td>
                <td className="px-3 py-2 text-xs">{r.submit_label}<div className="text-ink-500">{new Date(r.submitted_at).toLocaleString()}</div></td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    {r.report_status === 'READY' && <Link to={`${reportBase}/${r.session_id}${org ? `?org=${org}` : ''}`} className={buttonVariants({ size: 'sm' })} aria-label={`Open report of ${r.candidate_name}`}><FileText className="h-3.5 w-3.5" /> Report</Link>}
                    {!readOnly && <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Regenerate report of ${r.candidate_name}`}
                      onClick={async () => { try { await svc.regenerate(r.session_id); toast('✓ Regenerating the report'); void load() } catch (e) { toast(`✗ ${errorMessage(e)}`) } }}>
                      <RefreshCw className="h-4 w-4" /></Button>}
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
