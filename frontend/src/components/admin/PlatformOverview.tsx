import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2, GraduationCap, Inbox, Mail, MapPin, Phone, Sparkles, Users } from 'lucide-react'
import { Empty, Kpi, Panel } from '@/components/dashboard/Widgets'
import { Badge } from '@/components/ui/badge'
import { shortDate } from '@/lib/datetime'
import { adminTabLink } from '@/lib/adminTabs'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/services/apiClient'
import { LEAD_STATUS, leadsService, type Lead, type LeadStatus } from '@/services/leadsService'
import type { Organization } from '@/types'

/** Super-admin only: platform-wide totals, the latest demo requests and every institution at a glance. */
export function PlatformOverview({ orgs, selected, onSelect }: { orgs: Organization[]; selected: string | null; onSelect: (org: string) => void }) {
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [counts, setCounts] = useState<Partial<Record<LeadStatus, number>>>({})
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    leadsService.list().then((d) => { setLeads(d.requests); setCounts(d.counts) }).catch((e) => setError(errorMessage(e)))
  }, [])

  const teachers = orgs.reduce((n, o) => n + (o.teachers ?? 0), 0)
  const students = orgs.reduce((n, o) => n + (o.students ?? 0), 0)
  const fresh = counts.NEW ?? 0
  const won = counts.WON ?? 0
  const totalLeads = Object.values(counts).reduce((n, v) => n + (v ?? 0), 0)

  return (
    <section aria-labelledby="platform-h" className="space-y-4">
      <h2 id="platform-h" className="flex items-center gap-2 font-display text-lg font-semibold text-fg"><Sparkles className="h-5 w-5 text-brand-600" /> Platform</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={Building2} label="Institutions" value={orgs.length} tone="brand" to={adminTabLink('institutions')} hint={`${orgs.filter((o) => o.is_active).length} active`} />
        <Kpi icon={Users} label="Teachers (all institutions)" value={teachers} tone="aqua" />
        <Kpi icon={GraduationCap} label="Students (all institutions)" value={students} tone="neutral" />
        <Kpi icon={Inbox} label="New demo requests" value={fresh} tone={fresh ? 'warn' : 'ok'} to={adminTabLink('leads')} hint={`${totalLeads} total · ${won} won`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Panel icon={Inbox} title="Latest demo requests" action={{ to: adminTabLink('leads'), label: 'All requests' }}>
          {error ? <p role="alert" className="text-sm text-bad">{error}</p> : !leads ? <div className="skeleton h-40" /> : leads.length === 0 ? (
            <Empty icon={Inbox}>No demo requests yet. They arrive from the “Book a free demo” form on the website.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {leads.slice(0, 6).map((l) => (
                <li key={l.request_id} className="flex flex-wrap items-start gap-3 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-xs font-bold text-brand-600">{l.institution_name.slice(0, 2).toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-fg">{l.institution_name}</div>
                    <div className="flex flex-wrap items-center gap-x-3 text-xs text-ink-500">
                      <span>{l.full_name}{l.role ? ` · ${l.role}` : ''}</span>
                      {l.city && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{l.city}</span>}
                      <a href={`mailto:${l.email}`} className="inline-flex items-center gap-1 text-brand-600 hover:underline"><Mail className="h-3 w-3" />{l.email}</a>
                      {l.phone && <a href={`tel:${l.phone}`} className="inline-flex items-center gap-1 text-brand-600 hover:underline"><Phone className="h-3 w-3" />{l.phone}</a>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge tone={LEAD_STATUS[l.status].tone}>{LEAD_STATUS[l.status].label}</Badge>
                    <span className="text-[11px] text-ink-500">{shortDate(l.created_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel icon={Building2} title="Institutions" action={{ to: adminTabLink('institutions'), label: 'Manage' }}>
          {orgs.length === 0 ? <Empty icon={Building2}>No institutions yet. <Link to={adminTabLink('institutions')} className="text-brand-600 hover:underline">Onboard one</Link></Empty> : (
            <ul className="space-y-2">
              {orgs.map((o) => (
                <li key={o.org_code}>
                  <button onClick={() => onSelect(o.org_code)} aria-pressed={o.org_code === selected}
                    className={cn('flex w-full cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition-colors',
                      o.org_code === selected ? 'border-brand-400 bg-brand-500/6' : 'border-line hover:border-line-strong')}>
                    <Building2 className={cn('h-5 w-5 shrink-0', o.org_code === selected ? 'text-brand-600' : 'text-ink-500')} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-fg">{o.org_name}</div>
                      <div className="text-xs text-ink-500">{o.org_code} · <span className="capitalize">{o.institution_level}</span>{o.city ? ` · ${o.city}` : ''}</div>
                    </div>
                    <div className="text-right text-xs tabular-nums text-ink-300">
                      <div>{o.teachers ?? 0} teachers</div>
                      <div>{o.students ?? 0}{o.max_students ? ` / ${o.max_students}` : ''} students</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </section>
  )
}
