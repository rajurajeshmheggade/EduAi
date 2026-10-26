import { useEffect, useState, type FormEvent } from 'react'
import { Loader2, Save } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label, Select, Textarea } from '@/components/ui/field'
import { adminService } from '@/services/adminService'
import { errorMessage } from '@/services/apiClient'
import type { Organization } from '@/types'
import { ModuleToggles } from './ModuleToggles'

export function SettingsPanel({ org }: { org?: string | null }) {
  const { user } = useAuth()
  const isSuper = user?.role === 'superadmin'
  const [s, setS] = useState<Organization | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => { adminService.settings(org).then(setS).catch((e) => setMsg({ ok: false, text: errorMessage(e) })) }, [org])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!s) return
    setBusy(true); setMsg(null)
    try {
      setS(await adminService.updateSettings({
        org_name: s.org_name, institution_level: s.institution_level, attendance_threshold: Number(s.attendance_threshold),
        current_year_code: s.current_year_code, current_cycle_code: s.current_cycle_code,
        board_or_affiliation: s.board_or_affiliation ?? undefined, address: s.address ?? undefined,
        // plan fields are accepted from the platform owner only
        ...(isSuper ? { max_students: s.max_students || undefined, ai_modules: s.ai_modules, is_active: s.is_active } : {}),
      }, org))
      setMsg({ ok: true, text: 'Settings saved.' })
    } catch (err) { setMsg({ ok: false, text: errorMessage(err) }) } finally { setBusy(false) }
  }

  if (!s) return msg ? <p className="text-sm text-bad">{msg.text}</p> : <div className="skeleton h-64" />
  return (
    <Card className="max-w-3xl">
      <CardHeader><CardTitle>Institution settings</CardTitle><CardDescription>{s.org_code}</CardDescription></CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label htmlFor="s-name">Institution name</Label><Input id="s-name" required value={s.org_name} onChange={(e) => setS({ ...s, org_name: e.target.value })} /></div>
          <div><Label htmlFor="s-level">Institution type</Label>
            <Select id="s-level" value={s.institution_level} onChange={(e) => setS({ ...s, institution_level: e.target.value as Organization['institution_level'] })}>
              <option value="school">School (K–12)</option><option value="college">College / University</option><option value="coaching">Coaching centre</option>
            </Select>
          </div>
          <div><Label htmlFor="s-board">Board / affiliation</Label><Input id="s-board" value={s.board_or_affiliation ?? ''} onChange={(e) => setS({ ...s, board_or_affiliation: e.target.value })} maxLength={120} /></div>
          <div className="sm:col-span-2"><Label htmlFor="s-addr">Address</Label><Textarea id="s-addr" rows={2} value={s.address ?? ''} onChange={(e) => setS({ ...s, address: e.target.value })} maxLength={500} /></div>
          <div><Label htmlFor="s-year">Academic year</Label><Input id="s-year" value={s.current_year_code ?? ''} onChange={(e) => setS({ ...s, current_year_code: e.target.value })} placeholder="2026-27" /></div>
          <div><Label htmlFor="s-cycle">Term / semester / batch</Label><Input id="s-cycle" value={s.current_cycle_code ?? ''} onChange={(e) => setS({ ...s, current_cycle_code: e.target.value })} placeholder="Term-1" /></div>
          <div><Label htmlFor="s-th">Attendance threshold (%)</Label><Input id="s-th" type="number" min={0} max={100} step={1} value={s.attendance_threshold ?? 75} onChange={(e) => setS({ ...s, attendance_threshold: Number(e.target.value) })} /></div>

          <div className="space-y-3 rounded-xl border border-line bg-ink-800 p-4 sm:col-span-2">
            <div className="text-xs font-medium uppercase tracking-wide text-ink-500">Plan {isSuper ? '' : '(managed by the platform owner)'}</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label htmlFor="s-max">Max students</Label><Input id="s-max" type="number" min={1} disabled={!isSuper} placeholder="Unlimited" value={s.max_students ?? ''} onChange={(e) => setS({ ...s, max_students: e.target.value ? Number(e.target.value) : null })} /></div>
              {isSuper && (
                <div><Label htmlFor="s-active">Status</Label>
                  <Select id="s-active" value={s.is_active ? 'active' : 'suspended'} onChange={(e) => setS({ ...s, is_active: e.target.value === 'active' })}>
                    <option value="active">Active</option><option value="suspended">Suspended (nobody can sign in)</option>
                  </Select>
                </div>
              )}
            </div>
            <div><Label>AI modules</Label><ModuleToggles value={s.ai_modules ?? []} disabled={!isSuper} onChange={(ai_modules) => setS({ ...s, ai_modules })} /></div>
          </div>

          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save settings</Button>
            {msg && <span role="status" className={`text-sm ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
