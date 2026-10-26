import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { KeyRound, Loader2, Search, UserPlus } from 'lucide-react'
import { CredentialNotice } from '@/components/admin/CredentialNotice'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label } from '@/components/ui/field'
import { adminService } from '@/services/adminService'
import { errorMessage } from '@/services/apiClient'
import type { CreatedMember, Member } from '@/types'

const EMPTY = { user_code: '', full_name: '', email: '', phone: '', qualification: '', password: '' }

export function TeachersPanel({ org }: { org?: string | null }) {
  const [rows, setRows] = useState<Member[] | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Pick<CreatedMember, 'full_name' | 'user_code' | 'email' | 'temporary_password'> | null>(null)
  const [filter, setFilter] = useState('')

  const load = useCallback(() => adminService.teachers(org).then(setRows).catch((e) => setError(errorMessage(e))), [org])
  useEffect(() => { setRows(null); void load() }, [load])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const body = { ...form, phone: form.phone || undefined, qualification: form.qualification || undefined, password: form.password || undefined }
      setCreated(await adminService.createTeacher(body, org))
      setForm(EMPTY)
      await load()
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  async function patch(t: Member, p: { is_active?: boolean; reset_password?: boolean }) {
    setError(null)
    try {
      const r = await adminService.updateTeacher(t.user_code, p, org)
      if (r.temporary_password) setCreated({ ...t, temporary_password: r.temporary_password })
      await load()
    } catch (err) { setError(errorMessage(err)) }
  }

  const f = filter.toLowerCase()
  const shown = rows?.filter((r) => !f || `${r.full_name} ${r.user_code} ${r.email}`.toLowerCase().includes(f))

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
      <Card>
        <CardHeader><CardTitle>Add teacher</CardTitle><CardDescription>Leave the password empty to generate a one-time password.</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div><Label htmlFor="t-code">Employee code</Label><Input id="t-code" required value={form.user_code} onChange={(e) => setForm({ ...form, user_code: e.target.value })} placeholder="EMP1003" pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,63}" /></div>
            <div><Label htmlFor="t-name">Full name</Label><Input id="t-name" required minLength={2} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
            <div><Label htmlFor="t-email">Email</Label><Input id="t-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label htmlFor="t-qual">Qualification (optional)</Label><Input id="t-qual" placeholder="M.Sc Physics, B.Ed" value={form.qualification} onChange={(e) => setForm({ ...form, qualification: e.target.value })} maxLength={200} /></div>
            <div><Label htmlFor="t-phone">Phone (optional)</Label><Input id="t-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><Label htmlFor="t-pw">Password (optional)</Label><Input id="t-pw" type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
            <Button type="submit" className="w-full" disabled={busy} id="create-teacher">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Create teacher</Button>
          </form>
          {created && <div className="mt-4"><CredentialNotice member={created} onDismiss={() => setCreated(null)} /></div>}
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle>Teachers {rows && <span className="text-ink-500">({rows.length})</span>}</CardTitle>
          <div className="relative w-56"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-500" /><Input aria-label="Search teachers" className="pl-9" placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        </CardHeader>
        <CardContent>
          {error && <p role="alert" className="mb-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
          {!rows ? <div className="skeleton h-40" /> : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-300">No teachers yet. Add your first teacher on the left.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="py-2 pr-3 font-medium">Teacher</th><th className="py-2 pr-3 font-medium">Code</th><th className="py-2 pr-3 font-medium">Subjects</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 text-right font-medium">Actions</th>
                </tr></thead>
                <tbody>
                  {shown!.map((t) => (
                    <tr key={t.user_code} className="border-b border-line last:border-0">
                      <td className="py-2.5 pr-3"><div className="font-medium text-fg">{t.full_name}</div><div className="text-xs text-ink-500">{t.email}{t.qualification ? ` · ${t.qualification}` : ''}</div></td>
                      <td className="py-2.5 pr-3 font-mono text-xs">{t.user_code}</td>
                      <td className="py-2.5 pr-3"><div className="flex flex-wrap gap-1">{t.allowed_subjects.length ? t.allowed_subjects.map((s) => <Badge key={s} tone="brand">{s}</Badge>) : <span className="text-xs text-ink-500">Not assigned</span>}</div></td>
                      <td className="py-2.5 pr-3"><Badge tone={t.is_active ? 'ok' : 'neutral'}>{t.is_active ? 'Active' : 'Inactive'}</Badge></td>
                      <td className="py-2.5 text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" title="Reset password" onClick={() => patch(t, { reset_password: true })}><KeyRound className="h-3.5 w-3.5" /></Button>
                          <Button size="sm" variant="secondary" onClick={() => patch(t, { is_active: !t.is_active })}>{t.is_active ? 'Deactivate' : 'Activate'}</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
