import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Copy, ExternalLink, Eye, KeyRound, LifeBuoy, Loader2, Lock, PencilRuler, Rocket, Save, Settings2, Trash2, Unlock } from 'lucide-react'
import { CredentialsPanel, RecoveryPanel } from '@/components/admission-forms/CredentialsPanel'
import { useCredentialPopup } from '@/components/admission-forms/useCredentialPopup'
import { copyText } from '@/lib/clipboard'
import { FormBuilder } from '@/components/admission-forms/FormBuilder'
import { FormPreview } from '@/components/admission-forms/FormPreview'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label, Select, Textarea } from '@/components/ui/field'
import { ErrorState, SkeletonPage } from '@/components/ui/loading'
import { Tabs } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toast'
import { GRADES, definitionProblems, fmtDateTime, gradeLabel, type FormDefinition } from '@/lib/admissionForm'
import { fromLocalInput, toLocalInput } from '@/lib/datetime'
import { useAsync } from '@/lib/useAsync'
import { errorMessage } from '@/services/apiClient'
import { admissionFormService as svc, applicationUrl, type AdmissionForm, type FormBody, type FormMeta } from '@/services/admissionFormService'

type Tab = 'build' | 'preview' | 'settings' | 'credentials' | 'recovery'
const STATUS_TONE = { draft: 'neutral', published: 'ok', closed: 'warn', archived: 'neutral' } as const

const bodyOf = (f: AdmissionForm): FormBody => ({
  title: f.title, description: f.description, academic_year: f.academic_year, grades: f.grades, opens_at: f.opens_at, closes_at: f.closes_at,
  credential_valid_days: f.credential_valid_days, linked_test_id: f.linked_test_id, definition: f.definition!,
})

/** Trim choice options and drop empty lines before saving (the builder keeps them while typing). */
const tidy = (d: FormDefinition): FormDefinition => ({
  ...d, sections: d.sections.map((s) => ({ ...s, fields: s.fields.map((f) => (f.type === 'select'
    ? { ...f, options: (f.options ?? []).map((o) => o.trim()).filter(Boolean) } : f)) })),
})

/** Build → preview → settings → publish; then credentials and recovery for the published application. */
export function FormEditor({ formId, org, onBack }: { formId: string; org?: string | null; onBack: () => void }) {
  const loaded = useAsync(async () => {
    const [form, meta, branding] = await Promise.all([svc.get(formId, org), svc.meta(org), svc.branding(org).catch(() => null)])
    return { form, meta, branding }
  }, [formId, org])
  if (loaded.error) return <ErrorState message={loaded.error} onRetry={loaded.retry} />
  if (!loaded.data) return <SkeletonPage variant="detail" />
  return <Editor key={loaded.data.form.updated_at} initial={loaded.data.form} meta={loaded.data.meta} org={org} onBack={onBack}
    school={loaded.data.branding?.display_name ?? loaded.data.branding?.org_name} accent={loaded.data.branding?.accent} />
}

function Editor({ initial, meta, org, onBack, school, accent }: {
  initial: AdmissionForm; meta: FormMeta; org?: string | null; onBack: () => void; school?: string; accent?: string | null
}) {
  const [form, setForm] = useState(initial)
  const [body, setBody] = useState<FormBody>(bodyOf(initial))
  const [dirty, setDirty] = useState(false)
  const [tab, setTab] = useState<Tab>('build')
  const [busy, setBusy] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const { popup, show } = useCredentialPopup(org)
  const edit = (patch: Partial<FormBody>) => { setBody((b) => ({ ...b, ...patch })); setDirty(true) }
  const url = applicationUrl(form.application_path)
  const published = form.status !== 'draft'

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return
    const on = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', on)
    return () => window.removeEventListener('beforeunload', on)
  }, [dirty])

  const tests = useMemo(() => {
    const xs = [...meta.linkable_tests]
    if (form.linked_test && !xs.some((t) => t.test_id === form.linked_test!.test_id)) xs.push(form.linked_test)
    return xs
  }, [meta.linkable_tests, form.linked_test])

  async function save(quiet = false): Promise<AdmissionForm | null> {
    const b = { ...body, definition: tidy(body.definition) }
    const structural = definitionProblems(b.definition)
    if (structural.length) { setProblems(structural); setTab('build'); return null }
    setBusy('save')
    try {
      const f = await svc.update(form.form_id, b, org)
      setForm(f); setBody(bodyOf(f)); setDirty(false); setProblems([])
      if (!quiet) toast('Form saved', 'success')
      return f
    } catch (e) { toast(errorMessage(e), 'error'); return null } finally { setBusy(null) }
  }

  async function publish() {
    const p = [...definitionProblems(tidy(body.definition), { publishing: true }), ...(body.grades.length ? [] : ['Choose at least one class'])]
    if (p.length) { setProblems(p); return }
    if (dirty && !(await save(true))) return
    setBusy('publish')
    try {
      const r = await svc.publish(form.form_id, org)
      setForm(r.form); setBody(bodyOf(r.form)); setDirty(false); setProblems([])
      toast(r.credential ? 'Published — the admission application is live' : `Version ${r.form.published_version} published`, 'success')
      if (r.credential) show(r.credential)
    } catch (e) { setProblems([errorMessage(e)]) } finally { setBusy(null) }
  }

  async function lifecycle(kind: 'close' | 'reopen' | 'delete') {
    if (kind === 'delete' && !window.confirm('Delete this draft form?')) return
    if (kind === 'close' && !window.confirm('Close the application? New sign-ins and new credentials stop; corrections still work.')) return
    setBusy(kind)
    try {
      if (kind === 'delete') { await svc.remove(form.form_id, org); toast('Form deleted', 'success'); onBack(); return }
      const f = kind === 'close' ? await svc.close(form.form_id, org) : await svc.reopen(form.form_id, org)
      setForm(f)
    } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(null) }
  }

  const tabs = [{ id: 'build' as const, label: 'Build', icon: PencilRuler }, { id: 'preview' as const, label: 'Preview', icon: Eye },
    { id: 'settings' as const, label: 'Settings', icon: Settings2 },
    ...(published ? [{ id: 'credentials' as const, label: 'Credentials', icon: KeyRound, count: form.counts.live_credentials },
      { id: 'recovery' as const, label: 'Recovery', icon: LifeBuoy, count: form.counts.open_recovery }] : [])]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="sm" onClick={() => { if (!dirty || window.confirm('Leave without saving your changes?')) onBack() }}>
          <ArrowLeft className="h-4 w-4" /> All forms</Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-2xl font-bold">{body.title || 'Untitled form'}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-500">
            <Badge tone={STATUS_TONE[form.status]}>{form.status === 'published' ? 'Published' : form.status === 'closed' ? 'Closed' : form.status === 'draft' ? 'Draft' : 'Archived'}</Badge>
            {form.published_version && <span>Version {form.published_version} · {fmtDateTime(form.published_at)}</span>}
            {form.has_unpublished_changes && <Badge tone="warn">Unpublished changes</Badge>}
            {dirty && <Badge tone="warn">Not saved</Badge>}
            {form.owner_name && <span>Owner: {form.owner_name}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void save()} disabled={!dirty || !!busy} id="form-save">
            {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save</Button>
          {(form.status === 'draft' || form.has_unpublished_changes || dirty) && form.status !== 'archived' && (
            <Button onClick={() => void publish()} disabled={!!busy} id="form-publish">
              {busy === 'publish' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} {published ? 'Publish changes' : 'Publish'}</Button>
          )}
          {form.status === 'published' && <Button variant="ghost" onClick={() => void lifecycle('close')} disabled={!!busy}><Lock className="h-4 w-4" /> Close</Button>}
          {form.status === 'closed' && <Button variant="ghost" onClick={() => void lifecycle('reopen')} disabled={!!busy}><Unlock className="h-4 w-4" /> Reopen</Button>}
          {!form.published_version && <Button variant="danger" onClick={() => void lifecycle('delete')} disabled={!!busy}><Trash2 className="h-4 w-4" /> Delete</Button>}
        </div>
      </div>

      {url && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-brand-400/30 bg-brand-500/5 p-3 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">Application URL</span>
          <code className="min-w-0 flex-1 break-all font-mono text-xs text-fg">{url}</code>
          <Button size="sm" variant="secondary" onClick={() => void copyText(url).then((ok) => toast(ok ? 'Link copied' : 'Copy failed', ok ? 'success' : 'error'))}>
            <Copy className="h-3.5 w-3.5" /> Copy link</Button>
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-medium text-brand-600 hover:bg-brand-500/10">
            <ExternalLink className="h-3.5 w-3.5" /> Open</a>
        </div>
      )}
      {problems.length > 0 && (
        <div role="alert" className="rounded-2xl border border-bad/30 bg-bad/5 p-3 text-sm text-bad">
          <p className="font-medium">Before publishing:</p>
          <ul className="ml-5 list-disc">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      <Tabs items={tabs} value={tab} onChange={setTab} />
      {tab === 'build' && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
          <FormBuilder value={body.definition} onChange={(d) => edit({ definition: d })} disabled={form.status === 'archived'} />
          <div className="hidden xl:block"><div className="sticky top-4 max-h-[calc(100vh-6rem)] overflow-y-auto">
            <FormPreview definition={body.definition} title={body.title} grades={body.grades} schoolName={school} accent={accent} /></div></div>
        </div>
      )}
      {tab === 'preview' && <div className="mx-auto max-w-3xl"><FormPreview definition={body.definition} title={body.title} grades={body.grades} schoolName={school} accent={accent} /></div>}
      {tab === 'settings' && (
        <Card>
          <CardHeader><CardTitle>Settings</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2"><Label htmlFor="fs-title">Application name</Label>
              <Input id="fs-title" maxLength={200} value={body.title} onChange={(e) => edit({ title: e.target.value })} /></div>
            <div className="md:col-span-2"><Label htmlFor="fs-desc">Short description</Label>
              <Textarea id="fs-desc" rows={2} maxLength={2000} value={body.description ?? ''} onChange={(e) => edit({ description: e.target.value || null })} /></div>
            <div><Label htmlFor="fs-year">Academic year</Label>
              <Input id="fs-year" maxLength={20} placeholder="2027-28" value={body.academic_year ?? ''} onChange={(e) => edit({ academic_year: e.target.value || null })} /></div>
            <div><Label htmlFor="fs-days">Credentials valid for (days)</Label>
              <Input id="fs-days" type="number" min={1} max={365} value={body.credential_valid_days}
                onChange={(e) => edit({ credential_valid_days: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })} />
              <p className="mt-1 text-xs text-ink-500">New applicants' credentials also end at the closing date.</p></div>
            <div><Label htmlFor="fs-open">Opens</Label>
              <Input id="fs-open" type="datetime-local" value={toLocalInput(body.opens_at)} onChange={(e) => edit({ opens_at: fromLocalInput(e.target.value) })} /></div>
            <div><Label htmlFor="fs-close">Closes</Label>
              <Input id="fs-close" type="datetime-local" value={toLocalInput(body.closes_at)} onChange={(e) => edit({ closes_at: fromLocalInput(e.target.value) })} /></div>
            <fieldset className="md:col-span-2">
              <legend className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-300">Classes open for admission</legend>
              <div className="flex flex-wrap gap-2">
                {GRADES.map((g) => {
                  const on = body.grades.includes(g)
                  return (
                    <label key={g} className={`cursor-pointer rounded-xl border px-3 py-1.5 text-sm ${on ? 'border-brand-400 bg-brand-500/10 text-brand-600' : 'border-line text-ink-300'}`}>
                      <input type="checkbox" className="sr-only" checked={on}
                        onChange={() => edit({ grades: on ? body.grades.filter((x) => x !== g) : [...body.grades, g].sort((a, b) => a - b) })} />{gradeLabel(g)}
                    </label>
                  )
                })}
              </div>
            </fieldset>
            <div className="md:col-span-2"><Label htmlFor="fs-test">Admission test after submission (optional)</Label>
              <Select id="fs-test" value={body.linked_test_id ?? ''} onChange={(e) => edit({ linked_test_id: e.target.value || null })}>
                <option value="">No admission test</option>
                {tests.map((t) => <option key={t.test_id} value={t.test_id}>{t.title} · {t.grade_applying} · {t.duration_minutes} min{t.status !== 'PUBLISHED' ? ` (${t.status.toLowerCase()})` : ''}</option>)}
              </Select>
              <p className="mt-1 text-xs text-ink-500">With a test, applicants take your published proctored admission test from the application after submitting
                (desktop Chrome or Edge). Their credential is removed when the test is submitted, and you see the result with the application.</p></div>
          </CardContent>
        </Card>
      )}
      {tab === 'credentials' && <CredentialsPanel formId={form.form_id} org={org} canIssue={form.status === 'published'} />}
      {tab === 'recovery' && <RecoveryPanel formId={form.form_id} org={org} />}
      {popup}
    </div>
  )
}
