import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Building2, CalendarCheck, CalendarClock, GraduationCap, Inbox, LayoutDashboard, ScanText, School, Settings, Users } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { AttendanceSummaryPanel } from '@/components/admin/AttendanceSummaryPanel'
import { ClassesPanel } from '@/components/admin/ClassesPanel'
import { DemoRequestsPanel } from '@/components/admin/DemoRequestsPanel'
import { EvaluationScoresPanel } from '@/components/admin/EvaluationScoresPanel'
import { InstitutionsPanel } from '@/components/admin/InstitutionsPanel'
import { OverviewPanel } from '@/components/admin/OverviewPanel'
import { HeroBanner } from '@/components/dashboard/Widgets'
import { longDate } from '@/lib/datetime'
import { SettingsPanel } from '@/components/admin/SettingsPanel'
import { StudentsPanel } from '@/components/admin/StudentsPanel'
import { TeachersPanel } from '@/components/admin/TeachersPanel'
import { TimetablePanel } from '@/components/admin/TimetablePanel'
import { Select } from '@/components/ui/field'
import { Tabs, type TabItem } from '@/components/ui/tabs'
import { adminService } from '@/services/adminService'
import type { Organization } from '@/types'

type Tab = 'overview' | 'teachers' | 'classes' | 'timetable' | 'students' | 'attendance' | 'evaluation' | 'settings' | 'institutions' | 'leads'

const TABS: TabItem<Tab>[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'teachers', label: 'Teachers', icon: Users },
  { id: 'classes', label: 'Classes & subjects', icon: School },
  { id: 'timetable', label: 'Timetable', icon: CalendarClock },
  { id: 'students', label: 'Students', icon: GraduationCap },
  { id: 'attendance', label: 'Attendance', icon: CalendarCheck },
  { id: 'evaluation', label: 'Assessment scores', icon: ScanText },
  { id: 'settings', label: 'Settings', icon: Settings },
]
const PLATFORM_ORG = 'PLATFORM'

/**
 * One admin console for both the institution admin and the platform super-admin. The super-admin sees the
 * same tabs for the institution chosen in the switcher, plus an Institutions tab to onboard new customers.
 */
export default function AdminDashboard() {
  const { user } = useAuth()
  const [params] = useSearchParams()
  const [tab, setTab] = useState<Tab>(() => (TABS.some((t) => t.id === params.get('tab')) ? (params.get('tab') as Tab) : 'overview'))
  const isSuper = user?.role === 'superadmin'
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [org, setOrg] = useState<string | null>(null)
  const onInstitutionsTab = tab === 'institutions'

  useEffect(() => {
    if (!isSuper) return
    adminService.organizations().then((list) => {
      const real = list.filter((o) => o.org_code !== PLATFORM_ORG)
      setOrgs(real)
      setOrg((cur) => cur ?? real[0]?.org_code ?? null)
      if (!real.length) setTab('institutions')
    }).catch(() => setOrgs([]))
    // Re-read the list when leaving the Institutions tab, so a newly onboarded institution appears in the switcher.
  }, [isSuper, onInstitutionsTab])

  if (!user) return null
  // orgadmins are always scoped to their own tenant server-side; only the super-admin passes ?org_code=
  const scope = isSuper ? org : null
  const current = isSuper ? orgs.find((o) => o.org_code === org) : null
  const tabs = isSuper
    ? [...TABS, { id: 'institutions' as const, label: 'Institutions', icon: Building2, count: orgs.length }, { id: 'leads' as const, label: 'Demo requests', icon: Inbox }]
    : TABS

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <HeroBanner
        eyebrow={`${longDate()} · ${isSuper ? (current ? `${current.org_name} · ${current.org_code}` : 'No institution yet') : `${user.org_name} · ${user.org_code}`}`}
        title={<>{isSuper ? 'Platform console' : 'Admin console'}</>}
        subtitle={isSuper ? 'Onboard institutions, switch between them and manage everything from one place.' : 'Teachers, classes, timetable, attendance and assessment results for your institution.'}
        aside={isSuper && orgs.length > 0 ? (
          <label className="block rounded-2xl bg-white/95 p-3 shadow-lg">
            <span className="mb-1 block text-xs font-medium text-ink-500">Institution</span>
            <Select aria-label="Institution" id="institution-switcher" className="w-64" value={org ?? ''}
              onChange={(e) => { setOrg(e.target.value); if (tab === 'institutions') setTab('overview') }}>
              {orgs.map((o) => <option key={o.org_code} value={o.org_code}>{o.org_name}</option>)}
            </Select>
          </label>
        ) : undefined}
      />

      <Tabs items={tabs} value={tab} onChange={setTab} />
      <div role="tabpanel" aria-labelledby={`tab-${tab}`} className="animate-fade-up" key={`${tab}-${scope ?? ''}`}>
        {tab === 'leads' && isSuper && <DemoRequestsPanel />}
        {tab === 'institutions' && <InstitutionsPanel selected={org} onSelect={(o) => { if (o) { setOrg(o); setTab('overview') } }} />}
        {(!isSuper || org) && tab !== 'leads' && <>
          {tab === 'overview' && <OverviewPanel org={scope} onGo={setTab} />}
          {tab === 'teachers' && <TeachersPanel org={scope} />}
          {tab === 'classes' && <ClassesPanel org={scope} />}
          {tab === 'timetable' && <TimetablePanel org={scope} />}
          {tab === 'students' && <StudentsPanel org={scope} />}
          {tab === 'attendance' && <AttendanceSummaryPanel org={scope} />}
          {tab === 'evaluation' && <EvaluationScoresPanel org={scope} />}
          {tab === 'settings' && <SettingsPanel org={scope} />}
        </>}
      </div>
    </div>
  )
}
