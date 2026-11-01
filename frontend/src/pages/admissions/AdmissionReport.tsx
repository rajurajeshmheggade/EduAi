import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown, Image as ImageIcon, Loader2, Printer, RefreshCw, Sparkles } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Gauge, Radar, Ring, SectionBars, Timeline, TimeStrip, type Tone } from '@/components/admission-test/ReportCharts'
import { fmtOffset } from '@/lib/proctor/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/services/apiClient'
import { admissionTestService as svc, type ReportJson, type ReportResponse } from '@/services/admissionTestService'

const BAND: Record<string, Tone> = { High: 'ok', Moderate: 'warn', Low: 'bad' }
const recTone = (b: string): Tone => (b.startsWith('Strongly') || b === 'Recommended' ? 'ok' : b === 'Borderline' ? 'warn' : 'bad')
const hqTone = (b: string | null): Tone => (!b ? 'brand' : b === 'Strong' || b === 'Developing well' ? 'ok' : b === 'Emerging' ? 'warn' : 'bad')
const TONE_BADGE = { ok: 'ok', warn: 'warn', bad: 'bad', brand: 'brand' } as const
const SEV_BADGE: Record<string, 'bad' | 'warn' | 'brand' | 'neutral'> = { Crit: 'bad', High: 'warn', Med: 'brand', Low: 'neutral', Info: 'neutral' }
const REASON: Record<string, string> = { MANUAL: 'Submitted by the candidate', TIME_UP: 'Time up', AUTO_VIOLATION: 'Auto-submitted (proctoring rules)', ENDED_BY_TEACHER: 'Ended by the teacher' }
const DIMS = ['IQ', 'EQ', 'SQ', 'AQ', 'CQ']
const DIM_NAME: Record<string, string> = { IQ: 'Cognitive', EQ: 'Emotional', SQ: 'Social', AQ: 'Adversity', CQ: 'Creative' }
const when = (v: string | null | undefined) => (v ? new Date(v).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')
const n1 = (v: number | null | undefined) => (v === null || v === undefined ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(1))

/** Admission Assessment Report: screen + A4 print. Numbers are server-computed; AI text is narrative only. */
export default function AdmissionReport() {
  const { sessionId = '' } = useParams()
  const [params] = useSearchParams()
  const org = params.get('org') ?? undefined
  const { user } = useAuth()
  const [data, setData] = useState<ReportResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => svc.report(sessionId, org).then(setData).catch((e) => setError(errorMessage(e))), [sessionId, org])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!data || (data.status !== 'PENDING' && data.status !== 'RUNNING')) return
    const t = setTimeout(() => void load(), 3000)
    return () => clearTimeout(t)
  }, [data, load])

  const back = user?.role === 'teacher' ? '/teacher/admissions?tab=results' : '/admin-dashboard?tab=admission-tests'
  if (error) return <div className="mx-auto max-w-5xl p-8"><p role="alert" className="text-bad">{error}</p></div>
  if (!data) return <div className="mx-auto max-w-5xl p-8"><div className="skeleton h-96" /></div>
  if (!data.report || data.status !== 'READY') {
    return (
      <div className="mx-auto max-w-5xl p-8 text-center">
        {data.status === 'FAILED' ? <p role="alert" className="text-bad">The report could not be generated: {data.error}</p>
          : <p className="flex items-center justify-center gap-2 text-ink-300"><Loader2 className="h-4 w-4 animate-spin" /> Scoring and writing the report…</p>}
        {data.status === 'FAILED' && user?.role === 'teacher' && <Button className="mt-4" onClick={async () => { await svc.regenerate(sessionId); void load() }}><RefreshCw className="h-4 w-4" /> Try again</Button>}
      </div>
    )
  }
  return <Report r={data.report} data={data} back={back} canRegenerate={user?.role === 'teacher'} onRegenerate={async () => {
    try { await svc.regenerate(sessionId); toast('✓ Regenerating the report'); void load() } catch (e) { toast(`✗ ${errorMessage(e)}`) }
  }} />
}

function Report({ r, data, back, canRegenerate, onRegenerate }: { r: ReportJson; data: ReportResponse; back: string; canRegenerate: boolean; onRegenerate: () => void }) {
  const [lightbox, setLightbox] = useState<{ url: string; label: string; t: number } | null>(null)
  const sc = r.scores
  const integ = r.integrity
  const hq = r.hq
  const narrative = r.narrative
  const evidence = data.evidence ?? integ.evidence
  const sections: string[] = [...new Set<string>(r.questions.map((q: ReportJson) => q.section))]
  return (
    <article className="adm-report mx-auto max-w-5xl space-y-6 p-4 md:p-8" aria-label="Admission assessment report">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Link to={back} className="inline-flex items-center gap-1 text-sm text-ink-300 hover:text-fg"><ArrowLeft className="h-4 w-4" /> Results</Link>
        <div className="ml-auto flex gap-2">
          {canRegenerate && <Button variant="ghost" onClick={onRegenerate}><RefreshCw className="h-4 w-4" /> Regenerate</Button>}
          <Button onClick={() => window.print()} id="print-report"><Printer className="h-4 w-4" /> Print / Save as PDF</Button>
        </div>
      </div>

      {/* 1. Header + candidate */}
      <header className="glass rounded-3xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-widest text-ink-500">{r.school.name}</div>
            <h1 className="font-display text-2xl font-bold text-fg">Admission Assessment Report</h1>
          </div>
          <div className="text-right text-xs text-ink-500"><div>Report {r.report_id}</div><div>Generated {when(r.generated_at)}</div></div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-5">
          {data.photo_url ? <img src={data.photo_url} alt={`ID photo of ${r.candidate.name}`} className="h-24 w-24 rounded-2xl object-cover" />
            : <div className="grid h-24 w-24 place-items-center rounded-2xl bg-ink-800 text-xs text-ink-500">{r.candidate.has_photo ? 'Photo deleted (retention)' : 'No photo'}</div>}
          <dl className="grid flex-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div><dt className="inline text-ink-500">Candidate: </dt><dd className="inline font-semibold text-fg">{r.candidate.name}</dd></div>
            <div><dt className="inline text-ink-500">Age: </dt><dd className="inline text-fg">{r.candidate.age}</dd></div>
            <div><dt className="inline text-ink-500">Applying for: </dt><dd className="inline text-fg">{r.candidate.grade_applying}</dd></div>
            <div><dt className="inline text-ink-500">Test: </dt><dd className="inline text-fg">{r.test.title}</dd></div>
            <div><dt className="inline text-ink-500">Taken: </dt><dd className="inline text-fg">{when(r.session.started_at)}</dd></div>
            <div><dt className="inline text-ink-500">Time used: </dt><dd className="inline text-fg">{n1(r.session.time_used_min)} of {r.test.duration_min + r.test.extra_time_min} min</dd></div>
            <div className="sm:col-span-2"><dt className="inline text-ink-500">Ended: </dt><dd className="inline text-fg">{REASON[r.session.submit_reason] ?? r.session.submit_reason}</dd></div>
          </dl>
        </div>
      </header>

      {/* 2. Verdict strip */}
      <section aria-label="Summary scores" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile title="Composite">
          <Ring value={sc.composite} tone={sc.on_hold ? 'bad' : recTone(sc.band)} label="Composite score" />
          <Badge tone={TONE_BADGE[sc.on_hold ? 'bad' : recTone(sc.band)]} className="text-center">{sc.label}</Badge>
        </Tile>
        <Tile title="Academic">
          <div className="font-display text-3xl font-bold text-fg">{n1(sc.academic_pct)}<span className="text-base text-ink-500">%</span></div>
          <div className="text-xs text-ink-500">{n1(sc.academic_score)} / {n1(sc.academic_max)} marks</div>
          <div className="flex h-8 w-full items-end gap-1" aria-hidden>{r.sections.map((s: ReportJson) => <div key={s.section} className="flex-1 rounded-t bg-brand-500" style={{ height: `${Math.max(6, s.pct ?? 0)}%` }} />)}</div>
        </Tile>
        <Tile title="HQ composite">
          <div className="font-display text-3xl font-bold text-fg">{n1(sc.hq_composite)}</div>
          {sc.hq_band ? <Badge tone={TONE_BADGE[hqTone(sc.hq_band)]}>{sc.hq_band}</Badge> : <span className="text-xs text-ink-500">No HQ section</span>}
        </Tile>
        <Tile title="Integrity">
          <Gauge value={sc.integrity} tone={BAND[sc.integrity_band]} />
          <Badge tone={TONE_BADGE[BAND[sc.integrity_band]]}>{sc.integrity_band} · {sc.flag_count} flag{sc.flag_count === 1 ? '' : 's'}</Badge>
        </Tile>
      </section>

      {/* 3. Executive summary */}
      <Section title="Executive summary" ai>
        <p className="leading-relaxed text-ink-100">{narrative.executive_summary}</p>
        <p className="mt-3 rounded-xl border border-brand-400/30 bg-brand-500/5 px-3 py-2 text-sm"><b className="text-fg">Suggested next step:</b> {narrative.suggested_next_step}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 text-sm">
          <List title="Strengths" items={narrative.strengths} />
          <List title="Development areas" items={narrative.development_areas} />
        </div>
      </Section>

      {/* 4. Academic */}
      <Section title="Academic performance" page>
        <p className="mb-4 text-sm text-ink-300">{narrative.academic_commentary}</p>
        <div className="grid gap-6 md:grid-cols-2">
          <SectionBars rows={r.sections} />
          <div className="space-y-3">
            <SmallTable caption="Topic accuracy" head={['Topic', 'Correct', 'Score']} rows={r.topics.map((t: ReportJson) => [t.topic, `${t.correct}/${t.total}`, t.pct === null ? '—' : `${t.pct}%`])} />
            <SmallTable caption="By difficulty" head={['Difficulty', 'Correct', 'Score']} rows={r.difficulty.map((t: ReportJson) => [t.difficulty, `${t.correct}/${t.total}`, t.pct === null ? '—' : `${t.pct}%`])} />
          </div>
        </div>
        <h3 className="mb-2 mt-5 text-sm font-semibold text-fg">Time per question <span className="font-normal text-ink-500">(amber = implausibly fast)</span></h3>
        <TimeStrip items={r.time_strip} />
      </Section>

      {/* 5. HQ */}
      {hq && (
        <Section title="Human Quotient (HQ) profile" ai page>
          <p className="mb-4 text-sm text-ink-300">{narrative.hq_commentary}</p>
          <div className="grid items-start gap-6 md:grid-cols-[16rem_1fr]">
            <div className="mx-auto"><Radar dims={DIMS.map((k) => ({ key: k, score: hq.dimensions[k]?.score ?? null }))} typical={hq.age_typical} />
              <p className="text-center text-[11px] text-ink-500">Dashed ring: age-typical {hq.age_typical}</p></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">HQ dimensions</caption>
                <thead className="text-xs text-ink-500"><tr><th className="py-1 text-left font-medium">Dimension</th><th className="py-1 text-right font-medium">Score</th><th className="py-1 pl-3 text-left font-medium">Band</th><th className="py-1 pl-3 text-left font-medium">Observation and evidence</th></tr></thead>
                <tbody>{DIMS.map((k) => { const d = hq.dimensions[k]; return (
                  <tr key={k} className="border-t border-line align-top">
                    <td className="py-2 font-medium text-fg">{k} <span className="font-normal text-ink-500">{DIM_NAME[k]}</span></td>
                    <td className="py-2 text-right tabular-nums">{n1(d.score)}</td>
                    <td className="py-2 pl-3">{d.band ? <Badge tone={TONE_BADGE[hqTone(d.band)]}>{d.band}</Badge> : <span className="text-xs text-ink-500">Insufficient evidence</span>}</td>
                    <td className="py-2 pl-3 text-ink-300">{d.observation}{d.evidence?.map((e: string) => <q key={e} className="mt-1 block text-xs italic text-ink-500">{e}</q>)}</td>
                  </tr>) })}</tbody>
              </table>
            </div>
          </div>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><List title="Strengths" items={hq.strengths} /><List title="Growth areas" items={hq.growth_areas} /></div>
          <p className="mt-3 text-xs text-ink-500">{hq.disclaimer}</p>
        </Section>
      )}

      {/* 6. Proctoring */}
      <Section title="Proctoring and integrity" ai page>
        <div className="grid items-center gap-4 md:grid-cols-[10rem_1fr]">
          <div className="text-center"><Gauge value={integ.score} tone={BAND[integ.band]} size={150} /><Badge tone={TONE_BADGE[BAND[integ.band]]}>{integ.band} integrity</Badge></div>
          <div className="space-y-2 text-sm">
            <p className="text-ink-100">{integ.summary}</p>
            <p className="text-xs text-ink-500">{integ.warnings} warning(s) · {integ.critical} critical · preset “{integ.preset}”. Flags are indicators for review, not proof.</p>
          </div>
        </div>
        {integ.flags.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="mb-1 text-left text-sm font-semibold text-fg">Flags</caption>
              <thead className="text-xs text-ink-500"><tr><th className="py-1 text-left font-medium">Flag</th><th className="py-1 text-left font-medium">Severity</th><th className="py-1 text-right font-medium">Count</th><th className="py-1 text-right font-medium">Total time</th><th className="py-1 text-right font-medium">Max confidence</th><th className="py-1 text-right font-medium">Points</th></tr></thead>
              <tbody>{integ.flags.map((f: ReportJson) => (
                <tr key={f.code} className="border-t border-line">
                  <td className="py-1.5 text-fg">{f.label}{f.calibration_only && <span className="ml-1 text-xs text-ink-500">(calibration only)</span>}</td>
                  <td className="py-1.5"><Badge tone={SEV_BADGE[f.severity]}>{f.severity}</Badge></td>
                  <td className="py-1.5 text-right tabular-nums">{f.count}</td>
                  <td className="py-1.5 text-right tabular-nums">{f.total_duration_s ? `${f.total_duration_s}s` : '—'}</td>
                  <td className="py-1.5 text-right tabular-nums">{f.max_confidence ?? '—'}</td>
                  <td className="py-1.5 text-right tabular-nums">−{n1(f.points)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
        <h3 className="mb-1 mt-4 text-sm font-semibold text-fg">Timeline</h3>
        <Timeline events={integ.timeline} durationS={integ.duration_s} />
        {evidence.length > 0 && (
          <>
            <h3 className="mb-2 mt-4 text-sm font-semibold text-fg">Evidence <span className="font-normal text-ink-500">(links valid {data.url_minutes} min)</span></h3>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">{evidence.map((e: ReportJson) => {
              const url = data.evidence_urls[String(e.event_id)]
              return (
                <li key={e.event_id}>
                  {url ? <button onClick={() => setLightbox({ url, label: e.label, t: e.t_offset_s })} className="block w-full cursor-zoom-in" aria-label={`Evidence: ${e.label} at ${fmtOffset(e.t_offset_s)}`}>
                    <img src={url} alt="" className="aspect-[4/3] w-full rounded-lg object-cover" /></button>
                    : <div className="grid aspect-[4/3] place-items-center rounded-lg bg-ink-800 text-[10px] text-ink-500"><ImageIcon className="h-4 w-4" />deleted</div>}
                  <div className="mt-0.5 truncate text-[11px] text-ink-500">{fmtOffset(e.t_offset_s)} · {e.label}</div>
                </li>
              )
            })}</ul>
          </>
        )}
        <h3 className="mb-1 mt-4 text-sm font-semibold text-fg">System check and environment</h3>
        <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          {[['Screens', integ.system.screens_extended ? 'Extended (second screen)' : integ.system.screens_extended === false ? 'Single screen' : 'Not reported'],
            ['Camera', `${integ.system.camera_label ?? '—'}${integ.system.virtual_camera_suspected ? ' (virtual camera suspected)' : ''}`],
            ['Screen shared', integ.system.screen_surface ?? '—'], ['Screen size', integ.system.screen ?? '—'], ['Network', integ.system.network_ms ? `${integ.system.network_ms} ms` : '—'],
            ['Browser', integ.system.browser ?? '—'], ['Consent', `${when(r.session.consent_at)} (notice ${r.session.consent_version ?? '—'})`],
            ['Guardian consent', r.session.guardian_consent ? `${r.session.guardian_consent.guardian_name} (${r.session.guardian_consent.relationship}, ${String(r.session.guardian_consent.method).replace('_', ' ')}) confirmed by ${r.session.guardian_consent.confirmed_by} at ${when(r.session.guardian_consent.confirmed_at)}` : 'Not required (adult)'],
            ['Launched by', r.session.launched_by ?? '—']].map(([k, v]) => (
            <div key={k} className="min-w-0"><dt className="inline text-ink-500">{k}: </dt><dd className="inline break-words text-ink-100">{v}</dd></div>
          ))}
        </dl>
      </Section>

      {/* 7. Question review */}
      <Section title="Question-wise review" page>
        {sections.map((s) => (
          <details key={s} className="group border-t border-line py-2 first:border-t-0" open>
            <summary className="flex cursor-pointer list-none items-center gap-2 py-1 font-medium text-fg"><ChevronDown className="h-4 w-4 transition-transform group-open:rotate-0 -rotate-90 print:hidden" />{s}</summary>
            <ol className="space-y-2 pt-2">
              {r.questions.filter((q: ReportJson) => q.section === s).map((q: ReportJson) => (
                <li key={q.question_id} className="break-inside-avoid rounded-xl border border-line p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-fg"><span className="text-ink-500">Q{q.number}.</span> {q.prompt}</p>
                    {q.max !== null ? <Badge tone={q.marks >= q.max ? 'ok' : q.marks > 0 ? 'warn' : 'bad'}>{n1(q.marks)}/{n1(q.max)}</Badge>
                      : q.points !== undefined && q.points !== null ? <Badge tone={q.points === 2 ? 'ok' : q.points === 1 ? 'warn' : 'neutral'}>{q.points}/2</Badge> : null}
                  </div>
                  <p className="mt-1 text-ink-300"><b className="text-ink-100">Answer:</b> {q.answer || <span className="text-ink-500">Not answered</span>}</p>
                  {q.correct && <p className="text-ink-300"><b className="text-ink-100">{q.qtype === 'DESCRIPTIVE' || q.qtype === 'SHORT' ? 'Model answer' : 'Correct'}:</b> {q.correct}</p>}
                  {q.feedback && <p className="mt-1 flex gap-1.5 text-xs text-ink-300"><Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-brand-600" />{q.feedback}
                    {q.low_confidence && <Badge tone="warn" className="ml-1">low confidence</Badge>}</p>}
                  <p className="mt-1 text-[11px] text-ink-500">{q.time_s}s{q.time_anomaly ? ' · implausibly fast' : ''}{q.source ? ` · from ${q.source}` : ''}{q.ai_source && q.ai_source !== 'deterministic' && q.ai_source !== 'blank' ? ` · graded by ${q.ai_source}` : ''}</p>
                </li>
              ))}
            </ol>
          </details>
        ))}
      </Section>

      {/* 8. Methodology */}
      <Section title="Methodology and disclaimer" page>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-300">
          <li><b className="text-ink-100">Integrity:</b> {r.methodology.integrity_formula}.</li>
          <li><b className="text-ink-100">Composite:</b> {r.methodology.composite_formula}. Bands: ≥ {r.methodology.bands.strong} Strongly recommended · ≥ {r.methodology.bands.recommended} Recommended · ≥ {r.methodology.bands.borderline} Borderline · below: Not recommended at this time. A Low integrity band shows “On hold – see integrity section”.</li>
          <li><b className="text-ink-100">AI:</b> {r.methodology.ai} Sources: grading {r.ai_sources.grade.ai} AI / {r.ai_sources.grade.fallback} fallback / {r.ai_sources.grade.deterministic} exact; HQ {r.ai_sources.hq}; integrity {r.ai_sources.integrity}; narrative {r.ai_sources.report}.</li>
          <li><b className="text-ink-100">HQ:</b> {r.methodology.hq}</li>
          {r.methodology.limits.map((l: string) => <li key={l}>{l}</li>)}
          <li><b className="text-ink-100">Data:</b> evidence and detailed events are deleted on {when(r.methodology.retention_until)}. {r.methodology.deletion}</li>
        </ul>
      </Section>

      {lightbox && (
        <Dialog open onClose={() => setLightbox(null)} title={lightbox.label} description={`At ${fmtOffset(lightbox.t)} into the test`} className="w-[min(48rem,calc(100vw-2rem))]">
          <img src={lightbox.url} alt={`Evidence: ${lightbox.label}`} className="w-full rounded-xl" />
        </Dialog>
      )}
    </article>
  )
}

function Tile({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="glass flex flex-col items-center gap-2 rounded-2xl p-4 text-center"><div className="text-xs font-medium uppercase tracking-widest text-ink-500">{title}</div>{children}</div>
}

function Section({ title, ai, page, children }: { title: string; ai?: boolean; page?: boolean; children: React.ReactNode }) {
  return (
    <section className={cn('glass rounded-3xl p-6', page && 'print-break')} aria-label={title}>
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold text-fg">{title}
        {ai && <span className="inline-flex items-center gap-1 text-[11px] font-normal text-ink-500"><Sparkles className="h-3 w-3" /> AI-assisted text</span>}</h2>
      {children}
    </section>
  )
}

function List({ title, items }: { title: string; items: string[] }) {
  return <div><h3 className="mb-1 text-sm font-semibold text-fg">{title}</h3><ul className="list-disc space-y-0.5 pl-5 text-ink-300">{items.map((x) => <li key={x}>{x}</li>)}</ul></div>
}

function SmallTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-sm">
      <caption className="mb-1 text-left text-sm font-semibold text-fg">{caption}</caption>
      <thead className="text-xs text-ink-500"><tr>{head.map((h, i) => <th key={h} className={cn('py-1 font-medium', i ? 'text-right' : 'text-left')}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-line">{r.map((c, j) => <td key={j} className={cn('py-1', j ? 'text-right tabular-nums' : 'text-ink-100')}>{c}</td>)}</tr>)}</tbody>
    </table>
  )
}
