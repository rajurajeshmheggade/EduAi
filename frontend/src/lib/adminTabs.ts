import { Building2, CalendarCheck, CalendarClock, GraduationCap, Inbox, LayoutDashboard, Library, ScanText, School, Settings, Users, type LucideIcon } from 'lucide-react'

/** Admin console pages. They live in the sidebar (AppShell) and are selected with `/admin-dashboard?tab=<id>`. */
export type AdminTab = 'overview' | 'teachers' | 'classes' | 'timetable' | 'students' | 'attendance' | 'evaluation' | 'settings' | 'institutions' | 'leads' | 'library'

export interface AdminTabDef { id: AdminTab; label: string; icon: LucideIcon; section: string; superOnly?: boolean }

export const ADMIN_TABS: AdminTabDef[] = [
  { id: 'overview', label: 'Dashboard', icon: LayoutDashboard, section: 'Overview' },
  { id: 'institutions', label: 'Institutions', icon: Building2, section: 'Platform', superOnly: true },
  { id: 'leads', label: 'Demo requests', icon: Inbox, section: 'Platform', superOnly: true },
  { id: 'teachers', label: 'Teachers', icon: Users, section: 'People' },
  { id: 'students', label: 'Students', icon: GraduationCap, section: 'People' },
  { id: 'classes', label: 'Classes & subjects', icon: School, section: 'Academics' },
  { id: 'timetable', label: 'Timetable', icon: CalendarClock, section: 'Academics' },
  { id: 'library', label: 'Digital library', icon: Library, section: 'Academics' },
  { id: 'attendance', label: 'Attendance', icon: CalendarCheck, section: 'Reports' },
  { id: 'evaluation', label: 'Assessment scores', icon: ScanText, section: 'Reports' },
  { id: 'settings', label: 'Settings', icon: Settings, section: 'Configure' },
]

export const adminTabsFor = (isSuper: boolean) => ADMIN_TABS.filter((t) => isSuper || !t.superOnly)
export const isAdminTab = (v: string | null, isSuper: boolean): v is AdminTab => adminTabsFor(isSuper).some((t) => t.id === v)
export const adminTabLink = (id: AdminTab) => `/admin-dashboard?tab=${id}`
