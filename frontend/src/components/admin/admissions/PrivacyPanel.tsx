import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardList, Clock, FileCheck2, History, Languages, Loader2, ScrollText, ShieldAlert, Timer } from 'lucide-react'
import { Empty, Panel } from '@/components/dashboard/Widgets'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Label, Select, Textarea } from '@/components/ui/field'
import { Tabs } from '@/components/ui/tabs'
import { shortDate, shortDateTime } from '@/lib/datetime'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/services/apiClient'
import {
  admissionService, type AuditEntry, type Breach, type ConsentVersion, type DataClass, type DataRequest, type RequestStatus, type RetentionPolicy,
} from '@/services/admissionService'
import type { LangCode } from '@/i18n/locales'

type Tab = 'consent' | 'retention' | 'requests' | 'breaches' | 'audit'
const LANG_NAME: Record<LangCode, string> = { en: 'English', hi: 'Hindi', kn: 'Kannada', ta: 'Tamil' }
const KIND: Record<DataRequest['kind'], string> = { access: 'See data', correction: 'Correction', erasure: 'Erasure', consent_withdrawal: 'Consent withdrawal', grievance: 'Grievance' }
const CLASS_INFO: Record<DataClass, { label: string; hint: string }> = {
  proctor_snapshots: { label: 'Proctoring snapshots', hint: 'Still images taken only when a serious test rule fires; deleted after the review window.' },
  proctor_events: { label: 'Proctoring event records', hint: 'Flag timeline metadata (no images).' },
  unsuccessful_applicants: { label: 'Applicants not admitted', hint: 'Application data is deleted this many days after the final decision.' },
  withdrawn_enquiries: { label: 'Withdrawn enquiries', hint: 'Enquiries that never became applications.' },
  audit_log: { label: 'Audit log', hint: 'Processing logs — kept for at least one year.' },
}

/** Principal: DPDP controls — consent notice, retention timers, data-principal requests, breach log, audit log. */
export function PrivacyPanel({ org }: { org?: string | null }) {
  const [tab, setTab] = useState<Tab>('consent')
  return (
    <div className="space-y-4">
      <Tabs items={[{ id: 'consent', label: 'Consent notice', icon: FileCheck2 }, { id: 'retention', label: 'Retention', icon: Timer },
        { id: 'requests', label: 'Requests', icon: ClipboardList }, { id: 'breaches', label: 'Breach log', icon: ShieldAlert },
        { id: 'audit', label: 'Audit log', icon: History }]} value={tab} onChange={setTab} />
      {tab === 'consent' && <ConsentTab org={org} />}
      {tab === 'retention' && <RetentionTab org={org} />}
      {tab === 'requests' && <RequestsTab org={org} />}
      {tab === 'breaches' && <BreachesTab org={org} />}
      {tab === 'audit' && <AuditTab org={org} />}
    </div>
  )
}

function Err({ text }: { text: string | null }) {
  return text ? <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{text}</p> : null
}

// ---------------------------------------------------------------- consent notice
function ConsentTab({ org }: { org?: string | null }) {
  const [versions, setVersions] = useState<ConsentVersion[] | null>(null)
  const [draft, setDraft] = useState<Partial<Record<LangCode, { title: string; body: string; on: boolean }>> | null>(null)
  const [draftLangs, setDraftLangs] = useState<LangCode[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const load = useCallback(() => { admissionService.consentVersions(org).then(setVersions).catch((e) => setError(errorMessage(e))) }, [org])
  useEffect(() => { load() }, [load])

  async function startDraft() {
    setError(null); setMsg(null)
    try {
      const tpl = await admissionService.consentTemplates(org)
      setDraftLangs(tpl.draft_languages)
      const active = versions?.find((v) => v.is_active)
      const base = (l: LangCode) => active?.texts.find((t) => t.language === l) ?? tpl.texts[l]
      setDraft(Object.fromEntries((['en', 'hi', 'kn', 'ta'] as LangCode[]).map((l) => [l, { title: base(l).title, body: base(l).body, on: true }])))
    } catch (e) { setError(errorMessage(e)) }
  }
  async function publish() {
    if (!draft) return
    setBusy(true); setError(null)
    try {
      const texts = Object.fromEntries(Object.entries(draft).filter(([, v]) => v?.on).map(([l, v]) => [l, { title: v!.title, body: v!.body }]))
      const r = await admissionService.publishConsent(texts, org)
      setMsg(`Version ${r.version} published in ${r.languages.map((l) => LANG_NAME[l]).join(', ')}. Families will be asked to consent again.`)
      setDraft(null); load()
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <Err text={error} />
      {msg && <p role="status" className="flex items-center gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok"><CheckCircle2 className="h-4 w-4" />{msg}</p>}
      {draft ? (
        <Panel icon={FileCheck2} title="New consent notice version">
          <div className="space-y-4">
            <p className="flex items-start gap-2 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Publishing a new version retires the current one: every family must read and consent again before a test. English is required.</p>
            {(Object.keys(draft) as LangCode[]).map((l) => {
              const v = draft[l]!
              return (
                <fieldset key={l} className={cn('space-y-2 rounded-xl border p-3', v.on ? 'border-line' : 'border-dashed border-line opacity-60')}>
                  <legend className="flex items-center gap-2 px-1 text-sm font-medium text-fg">
                    <input type="checkbox" checked={v.on} disabled={l === 'en'} onChange={(e) => setDraft({ ...draft, [l]: { ...v, on: e.target.checked } })} />
                    {LANG_NAME[l]} {draftLangs.includes(l) && <Badge tone="warn">Draft translation — needs native review</Badge>}
                  </legend>
                  <Input aria-label={`${LANG_NAME[l]} title`} lang={l} value={v.title} disabled={!v.on} onChange={(e) => setDraft({ ...draft, [l]: { ...v, title: e.target.value } })} />
                  <Textarea aria-label={`${LANG_NAME[l]} notice text`} lang={l} rows={8} value={v.body} disabled={!v.on} className="text-sm leading-relaxed"
                    onChange={(e) => setDraft({ ...draft, [l]: { ...v, body: e.target.value } })} />
                </fieldset>
              )
            })}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
              <Button onClick={publish} disabled={busy} id="publish-consent">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Publish version</Button>
            </div>
          </div>
        </Panel>
      ) : (
        <Panel icon={FileCheck2} title="Consent notice" action={undefined}>
          {!versions ? <div className="skeleton h-40" /> : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-2xl text-sm text-ink-300">Parents read this plain-language notice in their language and tick to consent before any admission test.
                  Each consent records the version, language, time and IP address; withdrawal is recorded the same way.</p>
                <Button onClick={startDraft} id="new-consent-version"><Languages className="h-4 w-4" /> New version</Button>
              </div>
              {versions.length === 0 ? <Empty icon={FileCheck2}>No notice published yet.</Empty> : (
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {versions.map((v) => (
                    <li key={v.version} className="p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-fg">Version {v.version}</span>
                        {v.is_active ? <Badge tone="ok">Active</Badge> : <Badge tone="neutral">Retired</Badge>}
                        {v.texts.map((t) => <Badge key={t.language} tone="neutral">{LANG_NAME[t.language]}</Badge>)}
                        <span className="ml-auto text-xs text-ink-500">{v.granted_count} consent(s) · {shortDate(v.created_at)} by {v.created_by ?? '—'}</span>
                      </div>
                      {v.is_active && (
                        <details className="mt-2 text-sm">
                          <summary className="cursor-pointer text-brand-600">Read the English text</summary>
                          <div className="mt-2 whitespace-pre-line rounded-lg bg-ink-800/40 p-3 text-ink-100">{v.texts.find((t) => t.language === 'en')?.body}</div>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Panel>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- retention
function RetentionTab({ org }: { org?: string | null }) {
  const [rows, setRows] = useState<RetentionPolicy[] | null>(null)
  const [edit, setEdit] = useState<Partial<Record<DataClass, number>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => { admissionService.retention(org).then(setRows).catch((e) => setError(errorMessage(e))) }, [org])

  async function save() {
    setBusy(true); setError(null); setSaved(false)
    try { setRows(await admissionService.setRetention(edit, org)); setEdit({}); setSaved(true) } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <Panel icon={Timer} title="Retention timers">
      <div className="space-y-4">
        <Err text={error} />
        {!rows ? <div className="skeleton h-40" /> : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.data_class} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1"><div className="font-medium text-fg">{CLASS_INFO[r.data_class].label}</div>
                  <div className="text-xs text-ink-500">{CLASS_INFO[r.data_class].hint} Default {r.default_days} days{r.minimum_days > 1 ? `, minimum ${r.minimum_days}` : ''}.</div></div>
                <div className="flex items-center gap-2">
                  <Input aria-label={`${CLASS_INFO[r.data_class].label} days`} type="number" min={r.minimum_days} max={3650} className="h-9 w-24 text-right"
                    value={edit[r.data_class] ?? r.retain_days} onChange={(e) => setEdit({ ...edit, [r.data_class]: Number(e.target.value) })} />
                  <span className="text-sm text-ink-500">days</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-end gap-3">
          {saved && <span role="status" className="text-sm text-ok">Saved.</span>}
          <Button onClick={save} disabled={busy || !Object.keys(edit).length}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save</Button>
        </div>
        <p className="text-xs text-ink-500">The retention job (<code>python -m scripts.admission_retention</code>) applies these timers; schedule it nightly.</p>
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------- data-principal requests
function RequestsTab({ org }: { org?: string | null }) {
  const [rows, setRows] = useState<DataRequest[] | null>(null)
  const [status, setStatus] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [now] = useState(() => Date.now())
  const load = useCallback(() => { admissionService.requests(org, status).then(setRows).catch((e) => setError(errorMessage(e))) }, [org, status])
  useEffect(() => { load() }, [load])
  async function update(r: DataRequest, s: RequestStatus) {
    setError(null)
    try { await admissionService.updateRequest(r.request_id, { status: s, ...(notes[r.request_id] ? { resolution_note: notes[r.request_id] } : {}) }, org); load() } catch (e) { setError(errorMessage(e)) }
  }
  return (
    <Panel icon={ClipboardList} title="Parent privacy requests">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-300">Access, correction, erasure, consent withdrawal and grievances. Due 30 days after receipt.</p>
          <Select aria-label="Status" className="h-9 w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="rejected">Rejected</option>
          </Select>
        </div>
        <Err text={error} />
        {!rows ? <div className="skeleton h-32" /> : rows.length === 0 ? <Empty icon={ClipboardList}>No requests.</Empty> : (
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const overdue = (r.status === 'open' || r.status === 'in_progress') && new Date(r.due_at).getTime() < now
              return (
                <li key={r.request_id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={r.kind === 'erasure' ? 'bad' : 'brand'}>{KIND[r.kind]}</Badge>
                    <span className="font-medium text-fg">{r.applicant_name ?? 'All children'}</span>
                    <span className="text-xs text-ink-500">from {r.guardian_name ?? r.created_by} · {shortDate(r.created_at)}</span>
                    <span className={cn('ml-auto inline-flex items-center gap-1 text-xs', overdue ? 'font-medium text-bad' : 'text-ink-500')}><Clock className="h-3 w-3" />due {shortDate(r.due_at)}</span>
                    <Badge tone={r.status === 'completed' ? 'ok' : r.status === 'rejected' ? 'neutral' : 'warn'}>{r.status.replace('_', ' ')}</Badge>
                  </div>
                  {r.details && <p className="text-sm text-ink-300">“{r.details}”</p>}
                  {r.resolution_note && <p className="text-xs text-ink-500">Resolution: {r.resolution_note}</p>}
                  {(r.status === 'open' || r.status === 'in_progress') && (
                    <div className="flex flex-wrap gap-2">
                      <Input aria-label="Resolution note" className="h-9 min-w-56 flex-1" placeholder="Resolution note (sent to the record)" value={notes[r.request_id] ?? ''}
                        onChange={(e) => setNotes({ ...notes, [r.request_id]: e.target.value })} />
                      {r.status === 'open' && <Button size="sm" variant="secondary" onClick={() => update(r, 'in_progress')}>Start</Button>}
                      <Button size="sm" onClick={() => update(r, 'completed')}>Complete</Button>
                      <Button size="sm" variant="ghost" onClick={() => update(r, 'rejected')}>Reject</Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------- breach log
function BreachesTab({ org }: { org?: string | null }) {
  const [rows, setRows] = useState<Breach[] | null>(null)
  const [form, setForm] = useState({ detected_at: '', nature: '', data_affected: '', affected_count: '', actions_taken: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now] = useState(() => Date.now())
  const load = useCallback(() => { admissionService.breaches(org).then(setRows).catch((e) => setError(errorMessage(e))) }, [org])
  useEffect(() => { load() }, [load])

  async function log() {
    setBusy(true); setError(null)
    try {
      await admissionService.logBreach({
        detected_at: new Date(form.detected_at).toISOString(), nature: form.nature.trim(),
        ...(form.data_affected.trim() ? { data_affected: form.data_affected.trim() } : {}),
        ...(form.affected_count ? { affected_count: Number(form.affected_count) } : {}),
        ...(form.actions_taken.trim() ? { actions_taken: form.actions_taken.trim() } : {}),
      }, org)
      setForm({ detected_at: '', nature: '', data_affected: '', affected_count: '', actions_taken: '' }); load()
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  async function patch(b: Breach, body: Parameters<typeof admissionService.updateBreach>[1]) {
    setError(null)
    try { await admissionService.updateBreach(b.breach_id, body, org); load() } catch (e) { setError(errorMessage(e)) }
  }
  return (
    <div className="space-y-4">
      <Err text={error} />
      <Panel icon={ShieldAlert} title="Log a personal-data breach">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="b-when">Became aware at</Label><Input id="b-when" type="datetime-local" value={form.detected_at} onChange={(e) => setForm({ ...form, detected_at: e.target.value })} /></div>
          <div><Label htmlFor="b-count">People affected (estimate)</Label><Input id="b-count" type="number" min={0} value={form.affected_count} onChange={(e) => setForm({ ...form, affected_count: e.target.value })} /></div>
          <div className="sm:col-span-2"><Label htmlFor="b-nature">What happened</Label><Textarea id="b-nature" rows={2} value={form.nature} onChange={(e) => setForm({ ...form, nature: e.target.value })} /></div>
          <div><Label htmlFor="b-data">Data affected</Label><Input id="b-data" value={form.data_affected} onChange={(e) => setForm({ ...form, data_affected: e.target.value })} /></div>
          <div><Label htmlFor="b-actions">Actions taken</Label><Input id="b-actions" value={form.actions_taken} onChange={(e) => setForm({ ...form, actions_taken: e.target.value })} /></div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-ink-500">DPDP Rules 2025: inform affected parents without delay and send the Data Protection Board a detailed report within 72 hours.</p>
          <Button onClick={log} disabled={busy || !form.detected_at || form.nature.trim().length < 5}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Log breach</Button>
        </div>
      </Panel>
      <Panel icon={ScrollText} title="Breach records">
        {!rows ? <div className="skeleton h-32" /> : rows.length === 0 ? <Empty icon={ShieldAlert}>No breaches recorded.</Empty> : (
          <ul className="divide-y divide-line">
            {rows.map((b) => {
              const late = !b.board_notified_at && new Date(b.board_report_due_at).getTime() < now
              return (
                <li key={b.breach_id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={b.status === 'closed' ? 'neutral' : b.status === 'reported' ? 'aqua' : 'bad'}>{b.status}</Badge>
                    <span className="font-medium text-fg">{b.nature}</span>
                    <span className="ml-auto text-xs text-ink-500">aware {shortDateTime(b.detected_at)}{b.affected_count != null ? ` · ${b.affected_count} affected` : ''}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={late ? 'font-medium text-bad' : 'text-ink-500'}>Board report due {shortDateTime(b.board_report_due_at)}</span>
                    <span className="text-ink-500">· Board: {b.board_notified_at ? shortDateTime(b.board_notified_at) : 'not yet'} · Parents: {b.principals_notified_at ? shortDateTime(b.principals_notified_at) : 'not yet'}</span>
                  </div>
                  {b.status !== 'closed' && (
                    <div className="flex flex-wrap gap-2">
                      {!b.principals_notified_at && <Button size="sm" variant="secondary" onClick={() => patch(b, { principals_notified_at: new Date().toISOString() })}>Parents informed now</Button>}
                      {!b.board_notified_at && <Button size="sm" variant="secondary" onClick={() => patch(b, { board_notified_at: new Date().toISOString(), status: 'reported' })}>Board report sent now</Button>}
                      <Button size="sm" variant="ghost" onClick={() => patch(b, { status: 'closed' })}>Close</Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
    </div>
  )
}

// ---------------------------------------------------------------- audit log
function AuditTab({ org }: { org?: string | null }) {
  const [rows, setRows] = useState<AuditEntry[] | null>(null)
  const [entity, setEntity] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { admissionService.audit(org, { entity: entity || undefined }).then(setRows).catch((e) => setError(errorMessage(e))) }, [org, entity])
  return (
    <Panel icon={History} title="Audit log">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-300">Append-only record of who did what and when. It holds ids and field names, never personal details.</p>
          <Select aria-label="Entity" className="h-9 w-44" value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">All entries</option><option value="applicant">Consent decisions</option><option value="consent_version">Consent notice</option>
            <option value="data_request">Requests</option><option value="breach">Breaches</option><option value="retention_policy">Retention</option><option value="app_user">Team</option>
          </Select>
        </div>
        <Err text={error} />
        {!rows ? <div className="skeleton h-32" /> : rows.length === 0 ? <Empty icon={History}>No entries yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-500">
                <th scope="col" className="py-2 pr-3 font-medium">When</th><th scope="col" className="py-2 pr-3 font-medium">Who</th>
                <th scope="col" className="py-2 pr-3 font-medium">Action</th><th scope="col" className="py-2 pr-3 font-medium">Record</th><th scope="col" className="py-2 font-medium">IP</th>
              </tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.log_id} className="border-b border-line align-top last:border-0">
                    <td className="py-2 pr-3 tabular-nums text-ink-300">{shortDateTime(e.created_at)}</td>
                    <td className="py-2 pr-3">{e.actor_code} <span className="text-xs text-ink-500">({e.actor_role})</span></td>
                    <td className="py-2 pr-3 font-medium text-fg">{e.action}</td>
                    <td className="py-2 pr-3 text-xs text-ink-500">{e.entity}{e.entity_id ? ` · ${e.entity_id.slice(0, 8)}` : ''}{Object.keys(e.details).length ? ` · ${JSON.stringify(e.details)}` : ''}</td>
                    <td className="py-2 text-xs text-ink-500">{e.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Panel>
  )
}
