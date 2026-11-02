import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Copy, ExternalLink, FileSignature, Inbox, LifeBuoy, Loader2, Palette, Plus, Trash2, Upload } from 'lucide-react'
import { ApplicationView, ApplicationsQueue } from '@/components/admission-forms/Applications'
import { copyText } from '@/lib/clipboard'
import { RecoveryPanel } from '@/components/admission-forms/CredentialsPanel'
import { FormEditor } from '@/components/admission-forms/FormEditor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label } from '@/components/ui/field'
import { ErrorState, SkeletonPage } from '@/components/ui/loading'
import { Tabs } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toast'
import { GRADES, accentVars, fmtDateTime, gradeLabel } from '@/lib/admissionForm'
import { useAsync } from '@/lib/useAsync'
import { errorMessage } from '@/services/apiClient'
import { admissionFormService as svc, applicationUrl, type AdmissionForm } from '@/services/admissionFormService'

type View = 'forms' | 'applications' | 'recovery'
const VIEWS: View[] = ['forms', 'applications', 'recovery']
const FORM_STATUS = { draft: ['Draft', 'neutral'], published: ['Published', 'ok'], closed: ['Closed', 'warn'], archived: ['Archived', 'neutral'] } as const

/**
 * The Admission forms module (teacher page, counsellor page and the admin console tab): forms list → builder / preview /
 * publish / credentials, the review queue → application detail, credential recovery. State lives in the URL
 * (`view`, `form`, `application`) so notifications can deep-link and the back button works.
 */
export function AdmissionFormsWorkspace({ org, canBrand = false, reportBase }: { org?: string | null; canBrand?: boolean; reportBase?: string | null }) {
  const [params, setParams] = useSearchParams()
  const view = (VIEWS as string[]).includes(params.get('view') ?? '') ? (params.get('view') as View) : 'forms'
  const formId = params.get('form')
  const applicationId = params.get('application')
  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k) }
    setParams(next)
  }
  const [nonce, setNonce] = useState(0)
  const forms = useAsync((signal) => svc.list(org, signal), [org, nonce])
  const [creating, setCreating] = useState(false)

  if (formId) return <FormEditor formId={formId} org={org} onBack={() => { go({ form: null }); setNonce((n) => n + 1) }} />
  if (applicationId) return <ApplicationView applicationId={applicationId} org={org} reportBase={reportBase} onBack={() => go({ application: null, view: 'applications' })} />

  const list = forms.data ?? []
  const toReview = list.reduce((n, f) => n + f.counts.to_review, 0)
  const recovery = list.reduce((n, f) => n + f.counts.open_recovery, 0)
  return (
    <div className="space-y-5">
      <Tabs items={[{ id: 'forms', label: 'Forms', icon: FileSignature, count: forms.data?.length },
        { id: 'applications', label: 'Applications', icon: Inbox, count: forms.data ? toReview : undefined },
        { id: 'recovery', label: 'Recovery requests', icon: LifeBuoy, count: forms.data ? recovery : undefined }]}
        value={view} onChange={(v) => go({ view: v })} />
      {view === 'forms' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-sm text-ink-300">Build an admission form, preview it and publish it as a standalone application with its own login.
              Each applicant signs in with a one-time credential that stops working once they submit.</p>
            <Button onClick={() => setCreating(true)} id="new-admission-form"><Plus className="h-4 w-4" /> New admission form</Button>
          </div>
          {forms.error ? <ErrorState message={forms.error} onRetry={forms.retry} /> : forms.loading && !forms.data ? <SkeletonPage variant="cards" /> : (
            list.length === 0 ? (
              <Card><CardContent className="p-8 text-center text-sm text-ink-300">
                <FileSignature className="mx-auto mb-3 h-10 w-10 text-brand-600" />No admission forms yet. Create one from the standard template
                (student, parent / guardian, academic details, documents) and adapt it.</CardContent></Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {list.map((f) => <FormCard key={f.form_id} f={f} onOpen={() => go({ form: f.form_id })} onQueue={() => go({ view: 'applications', form_filter: f.form_id })} />)}
              </div>
            )
          )}
          {canBrand && <BrandingCard org={org} />}
        </>
      )}
      {view === 'applications' && <ApplicationsQueue forms={list} org={org} initialForm={params.get('form_filter')} onOpen={(id) => go({ application: id })} />}
      {view === 'recovery' && <RecoveryPanel org={org} />}
      <NewFormDialog open={creating} onClose={() => setCreating(false)} org={org} onCreated={(f) => { setCreating(false); go({ form: f.form_id }) }} />
    </div>
  )
}

function FormCard({ f, onOpen, onQueue }: { f: AdmissionForm; onOpen: () => void; onQueue: () => void }) {
  const [label, tone] = FORM_STATUS[f.status]
  const url = applicationUrl(f.application_path)
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="line-clamp-2">{f.title}</CardTitle>
          <Badge tone={tone}>{label}</Badge>
        </div>
        <p className="text-xs text-ink-500">{[f.academic_year, f.grade_labels.length ? `${f.grade_labels[0]}${f.grade_labels.length > 1 ? `–${f.grade_labels[f.grade_labels.length - 1]}` : ''}` : null,
          f.linked_test ? 'with admission test' : null].filter(Boolean).join(' · ')}</p>
      </CardHeader>
      <CardContent className="mt-auto space-y-3">
        <dl className="grid grid-cols-3 gap-2 text-center">
          {([['To review', f.counts.to_review], ['In progress', f.counts.drafts + f.counts.test_pending], ['Live credentials', f.counts.live_credentials]] as const).map(([k, v]) => (
            <div key={k} className="rounded-xl bg-ink-800 p-2"><dt className="text-[10px] uppercase tracking-wide text-ink-500">{k}</dt><dd className="font-display text-lg font-semibold text-fg">{v}</dd></div>
          ))}
        </dl>
        {f.has_unpublished_changes && <p className="text-xs text-warn">Unpublished changes</p>}
        {f.counts.open_recovery > 0 && <p className="text-xs text-warn">{f.counts.open_recovery} recovery request(s)</p>}
        <p className="text-xs text-ink-500">{f.owner_name ? `${f.owner_name} · ` : ''}updated {fmtDateTime(f.updated_at)}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onOpen}>Open</Button>
          {f.published_version && <Button size="sm" variant="secondary" onClick={onQueue}>Applications</Button>}
          {url && <Button size="sm" variant="ghost" aria-label={`Copy the link of ${f.title}`}
            onClick={() => void copyText(url).then((ok) => toast(ok ? 'Link copied' : 'Copy failed', ok ? 'success' : 'error'))}><Copy className="h-3.5 w-3.5" /></Button>}
          {url && <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${f.title}`}
            className="inline-flex h-8 items-center rounded-xl px-2 text-brand-600 hover:bg-brand-500/10"><ExternalLink className="h-3.5 w-3.5" /></a>}
        </div>
      </CardContent>
    </Card>
  )
}

function NewFormDialog({ open, onClose, org, onCreated }: { open: boolean; onClose: () => void; org?: string | null; onCreated: (f: AdmissionForm) => void }) {
  const [title, setTitle] = useState('')
  const [year, setYear] = useState('')
  const [grades, setGrades] = useState<number[]>([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try { onCreated(await svc.create({ title: title.trim(), academic_year: year.trim() || null, grades }, org)); setTitle(''); setYear('') }
    catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onClose={onClose} title="New admission form" description="Starts from the standard template; you can change everything before publishing.">
      <form onSubmit={submit} className="space-y-4">
        <div><Label htmlFor="nf-title">Application name</Label>
          <Input id="nf-title" required minLength={2} maxLength={200} placeholder="Admissions 2027–28" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div><Label htmlFor="nf-year">Academic year</Label>
          <Input id="nf-year" maxLength={20} placeholder="2027-28" value={year} onChange={(e) => setYear(e.target.value)} /></div>
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-300">Classes open for admission</legend>
          <div className="flex flex-wrap gap-1.5">
            {GRADES.map((g) => {
              const on = grades.includes(g)
              return (
                <label key={g} className={`cursor-pointer rounded-lg border px-2 py-1 text-xs ${on ? 'border-brand-400 bg-brand-500/10 text-brand-600' : 'border-line text-ink-300'}`}>
                  <input type="checkbox" className="sr-only" checked={on} onChange={() => setGrades(on ? grades.filter((x) => x !== g) : [...grades, g].sort((a, b) => a - b))} />
                  {gradeLabel(g)}</label>
              )
            })}
          </div>
        </fieldset>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || title.trim().length < 2}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Create</Button>
        </div>
      </form>
    </Dialog>
  )
}

/** Admins: the school's name, logo and accent colour on the standalone admission application. */
export function BrandingCard({ org }: { org?: string | null }) {
  const [nonce, setNonce] = useState(0)
  const { data, error, retry } = useAsync(() => svc.branding(org), [org, nonce])
  const [name, setName] = useState<string | null>(null)
  const [accent, setAccent] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  if (error) return <ErrorState message={error} onRetry={retry} />
  if (!data) return null
  const shownName = name ?? data.display_name ?? ''
  const shownAccent = accent ?? data.accent ?? '#4f46e5'
  async function run(k: string, fn: () => Promise<unknown>) {
    setBusy(k)
    try { await fn(); setName(null); setAccent(null); setNonce((n) => n + 1); toast('Branding saved', 'success') }
    catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(null) }
  }
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Palette className="h-5 w-5 text-brand-600" /> Admission application branding</CardTitle></CardHeader>
      <CardContent className="grid gap-5 md:grid-cols-[1fr_18rem]">
        <div className="space-y-3">
          <div><Label htmlFor="br-name">Display name</Label>
            <Input id="br-name" maxLength={200} placeholder={data.org_name} value={shownName} onChange={(e) => setName(e.target.value)} /></div>
          <div className="flex items-end gap-3">
            <div><Label htmlFor="br-accent">Accent colour</Label>
              <input id="br-accent" type="color" value={shownAccent} onChange={(e) => setAccent(e.target.value)} className="h-10 w-16 cursor-pointer rounded-lg border border-line bg-ink-900" /></div>
            <code className="pb-2 font-mono text-xs text-ink-300">{shownAccent}</code>
            {data.accent && <Button size="sm" variant="ghost" onClick={() => void run('accent', () => svc.saveBranding({ display_name: shownName || null, accent: null }, org))}>Reset</Button>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void run('save', () => svc.saveBranding({ display_name: shownName.trim() || null, accent: shownAccent }, org))} disabled={busy === 'save'}>
              {busy === 'save' && <Loader2 className="h-4 w-4 animate-spin" />} Save</Button>
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-line px-4 text-sm text-ink-100 hover:bg-ink-800">
              <Upload className="h-4 w-4" /> Upload logo
              <input type="file" accept="image/png,image/jpeg" className="sr-only"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void run('logo', () => svc.uploadLogo(f, org)) }} />
            </label>
            {data.logo_url && <Button variant="ghost" onClick={() => void run('rm', () => svc.deleteLogo(org))}><Trash2 className="h-4 w-4" /> Remove logo</Button>}
          </div>
          <p className="text-xs text-ink-500">PNG or JPEG up to 1 MB; it is re-encoded and resized to 512 px. Shown on every published admission application of the school.</p>
        </div>
        <div className="overflow-hidden rounded-2xl border border-line" style={accentVars(shownAccent)} aria-label="Branding preview">
          <div className="flex items-center gap-2 bg-brand-600 p-3 text-white">
            {data.logo_url ? <img src={data.logo_url} alt="" className="h-9 w-9 rounded-lg bg-white object-contain p-0.5" /> : <div className="h-9 w-9 rounded-lg bg-white/20" />}
            <span className="truncate font-display text-sm font-semibold">{shownName || data.org_name}</span>
          </div>
          <div className="space-y-2 bg-ink-950 p-3"><div className="h-2 w-2/3 rounded bg-ink-700" /><div className="h-2 w-1/2 rounded bg-ink-700" />
            <div className="inline-flex rounded-lg bg-brand-500 px-3 py-1 text-xs font-medium text-white">Sign in</div></div>
        </div>
      </CardContent>
    </Card>
  )
}
