import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Building2, Loader2, Plus, UserPlus } from 'lucide-react'
import { CredentialNotice } from '@/components/admin/CredentialNotice'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label, Select, Textarea } from '@/components/ui/field'
import { adminService, type OrgCreateBody } from '@/services/adminService'
import { errorMessage } from '@/services/apiClient'
import type { AIModule, CreatedMember, Member, Organization } from '@/types'
import { AI_MODULES } from '@/lib/modules'
import { ModuleToggles } from './ModuleToggles'

const EMPTY: OrgCreateBody = {
  org_code: '', org_name: '', institution_level: 'school', city: '', contact_email: '', contact_phone: '',
  board_or_affiliation: '', address: '', ai_modules: AI_MODULES.map((m) => m.id),
  admin: { full_name: '', email: '', user_code: '' },
}

/** Platform super-admin: onboard each school / college / coaching centre (FR-SA-02) and its admins (FR-SA-03). */
export function InstitutionsPanel({ selected, onSelect }: { selected: string | null; onSelect: (org: string | null) => void }) {
  const [orgs, setOrgs] = useState<Organization[] | null>(null)
  const [form, setForm] = useState<OrgCreateBody>(EMPTY)
  const [maxStudents, setMaxStudents] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedMember | null>(null)
  const [adminsFor, setAdminsFor] = useState<Organization | null>(null)

  const load = useCallback(() => adminService.organizations().then(setOrgs).catch((e) => setError(errorMessage(e))), [])
  useEffect(() => { void load() }, [load])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const opt = (v?: string) => (v && v.trim() ? v.trim() : undefined)
      const r = await adminService.createOrganization({
        ...form, city: opt(form.city), contact_email: opt(form.contact_email), contact_phone: opt(form.contact_phone),
        board_or_affiliation: opt(form.board_or_affiliation), address: opt(form.address),
        max_students: maxStudents ? Number(maxStudents) : undefined,
      })
      setCreated(r.admin); setForm(EMPTY); setMaxStudents(''); await load()
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[26rem_1fr]">
      <Card>
        <CardHeader><CardTitle>Onboard an institution</CardTitle><CardDescription>Creates the tenant and its first administrator.</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="o-code">Institution code</Label><Input id="o-code" required placeholder="NATIONAL_SCH_BLR" value={form.org_code} onChange={(e) => setForm({ ...form, org_code: e.target.value.toUpperCase() })} pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,63}" /></div>
              <div><Label htmlFor="o-level">Type</Label>
                <Select id="o-level" value={form.institution_level} onChange={(e) => setForm({ ...form, institution_level: e.target.value as OrgCreateBody['institution_level'] })}>
                  <option value="school">School</option><option value="college">College</option><option value="coaching">Coaching centre</option>
                </Select>
              </div>
            </div>
            <div><Label htmlFor="o-name">Institution name</Label><Input id="o-name" required minLength={2} value={form.org_name} onChange={(e) => setForm({ ...form, org_name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="o-board">Board / affiliation</Label><Input id="o-board" placeholder="CBSE, VTU…" value={form.board_or_affiliation} onChange={(e) => setForm({ ...form, board_or_affiliation: e.target.value })} maxLength={120} /></div>
              <div><Label htmlFor="o-city">City</Label><Input id="o-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
            </div>
            <div><Label htmlFor="o-addr">Address</Label><Textarea id="o-addr" rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} maxLength={500} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="o-mail">Contact email</Label><Input id="o-mail" type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} /></div>
              <div><Label htmlFor="o-phone">Contact phone</Label><Input id="o-phone" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} maxLength={32} /></div>
            </div>
            <div><Label htmlFor="o-max">Max students (plan limit, empty = unlimited)</Label><Input id="o-max" type="number" min={1} value={maxStudents} onChange={(e) => setMaxStudents(e.target.value)} /></div>
            <div><Label>AI modules</Label><ModuleToggles value={form.ai_modules ?? []} onChange={(ai_modules: AIModule[]) => setForm({ ...form, ai_modules })} /></div>

            <div className="border-t border-line pt-3 text-xs font-medium uppercase tracking-wide text-ink-500">First administrator</div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="a-name">Full name</Label><Input id="a-name" required minLength={2} value={form.admin.full_name} onChange={(e) => setForm({ ...form, admin: { ...form.admin, full_name: e.target.value } })} /></div>
              <div><Label htmlFor="a-code">Username / code</Label><Input id="a-code" required value={form.admin.user_code} onChange={(e) => setForm({ ...form, admin: { ...form.admin, user_code: e.target.value } })} pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,63}" /></div>
            </div>
            <div><Label htmlFor="a-mail">Admin email</Label><Input id="a-mail" type="email" required value={form.admin.email} onChange={(e) => setForm({ ...form, admin: { ...form.admin, email: e.target.value } })} /></div>
            {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create institution</Button>
          </form>
          {created && <div className="mt-4"><CredentialNotice member={created} onDismiss={() => setCreated(null)} /></div>}
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader><CardTitle>Institutions {orgs && <span className="text-ink-500">({orgs.length})</span>}</CardTitle><CardDescription>Select one to manage it with the tabs above.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          {!orgs ? <div className="skeleton h-40" /> : orgs.length === 0 ? <p className="py-8 text-center text-sm text-ink-300">No institutions yet.</p> : orgs.map((o) => (
            <div key={o.org_code} className={`rounded-xl border p-3 transition-all ${selected === o.org_code ? 'border-brand-400 bg-brand-500/8 ring-1 ring-brand-400/40' : 'border-line'}`}>
              <div className="flex items-center gap-3">
                <button onClick={() => onSelect(o.org_code)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left">
                  <Building2 className="h-5 w-5 shrink-0 text-brand-600" />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-fg">{o.org_name}</div>
                    <div className="text-xs text-ink-500"><span className="font-mono">{o.org_code}</span>{o.board_or_affiliation ? ` · ${o.board_or_affiliation}` : ''}{o.city ? ` · ${o.city}` : ''}</div>
                  </div>
                </button>
                <Button size="sm" variant="secondary" onClick={() => setAdminsFor(o)}><UserPlus className="h-3.5 w-3.5" /> Admins ({o.admins ?? 0})</Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 pl-8">
                <Badge className="capitalize">{o.institution_level}</Badge>
                <Badge tone="brand">{o.teachers} teachers</Badge>
                <Badge tone="aqua">{o.students}{o.max_students ? ` / ${o.max_students}` : ''} students</Badge>
                {(o.ai_modules ?? []).length < AI_MODULES.length && <Badge tone="warn">{(o.ai_modules ?? []).length}/{AI_MODULES.length} AI modules</Badge>}
                {!o.is_active && <Badge tone="bad">Suspended</Badge>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {adminsFor && <AdminsDialog org={adminsFor} onClose={() => { setAdminsFor(null); void load() }} />}
    </div>
  )
}

function AdminsDialog({ org, onClose }: { org: Organization; onClose: () => void }) {
  const [admins, setAdmins] = useState<Member[] | null>(null)
  const [form, setForm] = useState({ full_name: '', email: '', user_code: '' })
  const [created, setCreated] = useState<CreatedMember | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => adminService.orgAdmins(org.org_code).then(setAdmins).catch((e) => setError(errorMessage(e))), [org.org_code])
  useEffect(() => { void load() }, [load])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try { setCreated(await adminService.createOrgAdmin(org.org_code, form)); setForm({ full_name: '', email: '', user_code: '' }); await load() }
    catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  return (
    <Dialog open onClose={onClose} title={`Admins · ${org.org_name}`} description="Institution admins manage teachers, classes, timetable and settings.">
      <div className="space-y-4">
        <ul className="divide-y divide-line rounded-xl border border-line">
          {!admins ? <li className="p-3"><div className="skeleton h-8" /></li> : admins.map((a) => (
            <li key={a.user_code} className="flex items-center justify-between p-2.5 text-sm">
              <div><div className="font-medium text-fg">{a.full_name}</div><div className="text-xs text-ink-500">{a.user_code} · {a.email}</div></div>
              <Badge tone={a.is_active ? 'ok' : 'neutral'}>{a.is_active ? 'Active' : 'Inactive'}</Badge>
            </li>
          ))}
        </ul>
        <form onSubmit={submit} className="grid gap-2 sm:grid-cols-2">
          <Input aria-label="Full name" required minLength={2} placeholder="Full name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          <Input aria-label="Username / code" required placeholder="Username / code" value={form.user_code} onChange={(e) => setForm({ ...form, user_code: e.target.value })} pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,63}" />
          <Input aria-label="Email" type="email" required placeholder="Email" className="sm:col-span-2" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          {error && <p role="alert" className="text-sm text-bad sm:col-span-2">{error}</p>}
          <Button type="submit" disabled={busy} className="sm:col-span-2">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Add admin</Button>
        </form>
        {created && <CredentialNotice member={created} onDismiss={() => setCreated(null)} />}
      </div>
    </Dialog>
  )
}
