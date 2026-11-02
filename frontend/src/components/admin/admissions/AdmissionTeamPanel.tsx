import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { KeyRound, Loader2, UserPlus } from 'lucide-react'
import { CredentialNotice } from '@/components/admin/CredentialNotice'
import { Empty, Panel } from '@/components/dashboard/Widgets'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Label, Select } from '@/components/ui/field'
import { errorMessage } from '@/services/apiClient'
import { admissionService, type TeamMember } from '@/services/admissionService'

const ROLE = { counsellor: 'Counsellor / front office', reviewer: 'Integrity reviewer' } as const

/** Principal: admissions team accounts (counsellors and integrity reviewers). */
export function AdmissionTeamPanel({ org }: { org?: string | null }) {
  const [rows, setRows] = useState<TeamMember[] | null>(null)
  const [form, setForm] = useState({ role: 'counsellor' as 'counsellor' | 'reviewer', full_name: '', email: '', phone: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ full_name: string; user_code: string; email: string; temporary_password: string | null } | null>(null)
  const load = useCallback(() => { admissionService.team(org).then(setRows).catch((e) => setError(errorMessage(e))) }, [org])
  useEffect(() => { load() }, [load])

  async function add(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const r = await admissionService.addMember({ role: form.role, full_name: form.full_name.trim(), email: form.email.trim(), ...(form.phone.trim() ? { phone: form.phone.trim() } : {}) }, org)
      setCreated({ full_name: form.full_name.trim(), user_code: r.user_code, email: r.email, temporary_password: r.temporary_password })
      setForm({ ...form, full_name: '', email: '', phone: '' }); load()
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  async function patch(m: TeamMember, body: { is_active?: boolean; reset_password?: boolean }) {
    setError(null)
    try {
      const r = await admissionService.updateMember(m.user_code, body, org)
      if (r.temporary_password) setCreated({ full_name: m.full_name, user_code: m.user_code, email: m.email, temporary_password: r.temporary_password })
      load()
    } catch (err) { setError(errorMessage(err)) }
  }

  return (
    <div className="space-y-6">
      <Panel icon={UserPlus} title="Add a team member">
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1.2fr_1.3fr_1fr_auto] lg:items-end">
          <div><Label htmlFor="t-role">Role</Label>
            <Select id="t-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'counsellor' | 'reviewer' })}>
              {Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </div>
          <div><Label htmlFor="t-name">Full name</Label><Input id="t-name" required minLength={2} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
          <div><Label htmlFor="t-email">Email</Label><Input id="t-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><Label htmlFor="t-phone">Mobile (optional)</Label><Input id="t-phone" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <Button type="submit" disabled={busy} id="add-team-member">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Add</Button>
        </form>
        <p className="mt-3 text-xs text-ink-500">Counsellors run enquiries and applications; integrity reviewers decide on proctoring flags. The principal role is the school admin account.</p>
      </Panel>
      {created && <CredentialNotice member={created} onDismiss={() => setCreated(null)} />}
      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      <Panel title="Admissions team">
        {!rows ? <div className="skeleton h-32" /> : rows.length === 0 ? <Empty icon={UserPlus}>No counsellors or reviewers yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-500">
                <th scope="col" className="py-2 pr-3 font-medium">Name</th><th scope="col" className="py-2 pr-3 font-medium">Role</th>
                <th scope="col" className="py-2 pr-3 font-medium">Login</th><th scope="col" className="py-2 pr-3 font-medium">Status</th><th />
              </tr></thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.user_code} className="border-b border-line last:border-0">
                    <td className="py-2.5 pr-3 font-medium text-fg">{m.full_name}</td>
                    <td className="py-2.5 pr-3">{ROLE[m.role]}</td>
                    <td className="py-2.5 pr-3 text-ink-300">{m.email}</td>
                    <td className="py-2.5 pr-3"><Badge tone={m.is_active ? 'ok' : 'neutral'}>{m.is_active ? 'Active' : 'Inactive'}</Badge></td>
                    <td className="py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => patch(m, { reset_password: true })}><KeyRound className="h-3.5 w-3.5" /> Reset password</Button>
                        <Button size="sm" variant="secondary" onClick={() => patch(m, { is_active: !m.is_active })}>{m.is_active ? 'Deactivate' : 'Activate'}</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
