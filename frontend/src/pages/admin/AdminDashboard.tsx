import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Building2, ChevronRight } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { AttendanceSummaryPanel } from '@/components/admin/AttendanceSummaryPanel'
import { ClassesPanel } from '@/components/admin/ClassesPanel'
import { DemoRequestsPanel } from '@/components/admin/DemoRequestsPanel'
import { EvaluationScoresPanel } from '@/components/admin/EvaluationScoresPanel'
import { InstitutionsPanel } from '@/components/admin/InstitutionsPanel'
import { LibraryCatalogPanel } from '@/components/admin/LibraryCatalogPanel'
import { OverviewPanel } from '@/components/admin/OverviewPanel'
import { PlatformOverview } from '@/components/admin/PlatformOverview'
import { SettingsPanel } from '@/components/admin/SettingsPanel'
import { StudentsPanel } from '@/components/admin/StudentsPanel'
import { TeachersPanel } from '@/components/admin/TeachersPanel'
import { TimetablePanel } from '@/components/admin/TimetablePanel'
import { HeroBanner } from '@/components/dashboard/Widgets'
import { Select } from '@/components/ui/field'
import { ADMIN_TABS, isAdminTab, type AdminTab } from '@/lib/adminTabs'
import { longDate } from '@/lib/datetime'
import { adminService } from '@/services/adminService'
import type { Organization } from '@/types'

const PLATFORM_ORG = 'PLATFORM'
/** Pages that act on one institution (the super-admin picks it in the switcher). */
const PLATFORM_PAGES: AdminTab[] = ['institutions', 'leads']

/**
 * One admin console for both the institution admin and the platform super-admin. Pages are chosen from the
 * sidebar (`?tab=`); the super-admin also gets Institutions, Demo requests and a platform-wide dashboard.
 */
export default function AdminDashboard() {
  const { user } = useAuth()
  const isSuper = user?.role === 'superadmin'
  const [params, setParams] = useSearchParams()
  const [orgs, setOrgs] = useState<Organization[] | null>(isSuper ? null : [])
  const [org, setOrg] = useState<string | null>(null)
  const raw = params.get('tab')
  const tab: AdminTab = isAdminTab(raw, isSuper) ? raw : isSuper && orgs?.length === 0 ? 'institutions' : 'overview'
  const setTab = (t: AdminTab) => setParams(t === 'overview' ? {} : { tab: t })
  const onInstitutionsTab = tab === 'institutions'

  useEffect(() => {
    if (!isSuper) return
    adminService.organizations().then((list) => {
      const real = list.filter((o) => o.org_code !== PLATFORM_ORG)
      setOrgs(real)
      setOrg((cur) => cur ?? real[0]?.org_code ?? null)
    }).catch(() => setOrgs([]))
    // Re-read the list when leaving the Institutions page, so a newly onboarded institution appears in the switcher.
  }, [isSuper, onInstitutionsTab])

  if (!user) return null
  // orgadmins are always scoped to their own tenant server-side; only the super-admin passes ?org_code=
  const scope = isSuper ? org : null
  const current = isSuper ? orgs?.find((o) => o.org_code === org) : null
  const page = ADMIN_TABS.find((t) => t.id === tab)!
  const platformPage = PLATFORM_PAGES.includes(tab)
  const orgName = isSuper ? current?.org_name : user.org_name

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <HeroBanner
        eyebrow={`${longDate()} · ${isSuper ? 'Super Admin' : `${user.org_name} · ${user.org_code}`}`}
        title={<>{isSuper ? 'Platform console' : 'Admin console'}</>}
        subtitle={isSuper ? 'Onboard institutions, follow up demo requests and manage every institution from one place.' : 'Teachers, classes, timetable, attendance and assessment results for your institution.'}
        aside={isSuper && orgs && orgs.length > 0 ? (
          <label className="block rounded-2xl bg-white/95 p-3 shadow-lg">
            <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ink-500"><Building2 className="h-3.5 w-3.5" /> Managing institution</span>
            <Select aria-label="Institution" id="institution-switcher" className="w-64" value={org ?? ''} onChange={(e) => setOrg(e.target.value)}>
              {orgs.map((o) => <option key={o.org_code} value={o.org_code}>{o.org_name} ({o.org_code})</option>)}
            </Select>
          </label>
        ) : undefined}
      />

      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-ink-500">
        <span>{isSuper ? 'Platform' : 'Institution'}</span>
        {!platformPage && orgName && <><ChevronRight className="h-3.5 w-3.5" /><span className="font-medium text-ink-300">{orgName}</span></>}
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="flex items-center gap-1.5 font-semibold text-fg"><page.icon className="h-4 w-4 text-brand-600" />{page.label}</span>
      </nav>

      <div role="region" aria-label={page.label} className="animate-fade-up" key={`${tab}-${scope ?? ''}`}>
        {tab === 'leads' && isSuper && <DemoRequestsPanel />}
        {tab === 'institutions' && <InstitutionsPanel selected={org} onSelect={(o) => { if (o) { setOrg(o); setTab('overview') } }} />}
        {tab === 'overview' && isSuper && orgs && (
          <div className="space-y-8">
            <PlatformOverview orgs={orgs} selected={org} onSelect={setOrg} />
            {org && <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-fg"><Building2 className="h-5 w-5 text-brand-600" /> {current?.org_name ?? org}</h2>}
          </div>
        )}
        {!platformPage && (!isSuper || org) && <div className={isSuper && tab === 'overview' ? 'mt-4' : undefined}>
          {tab === 'overview' && <OverviewPanel org={scope} onGo={setTab} />}
          {tab === 'teachers' && <TeachersPanel org={scope} />}
          {tab === 'classes' && <ClassesPanel org={scope} />}
          {tab === 'timetable' && <TimetablePanel org={scope} />}
          {tab === 'students' && <StudentsPanel org={scope} />}
          {tab === 'attendance' && <AttendanceSummaryPanel org={scope} />}
          {tab === 'evaluation' && <EvaluationScoresPanel org={scope} />}
          {tab === 'library' && <LibraryCatalogPanel org={scope} />}
          {tab === 'settings' && <SettingsPanel org={scope} />}
        </div>}
        {!platformPage && isSuper && orgs?.length === 0 && (
          <p className="rounded-xl border border-line bg-ink-900 p-6 text-center text-sm text-ink-300">Onboard an institution first from <b>Institutions</b> in the sidebar.</p>
        )}
      </div>
    </div>
  )
}
