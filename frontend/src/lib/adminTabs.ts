import { Building2, CalendarCheck, CalendarClock, ClipboardCheck, DoorOpen, FileSignature, GraduationCap, Inbox, LayoutDashboard, Library, ScanEye, ScanText, School, ShieldCheck, UserCog, Users, type LucideIcon } from 'lucide-react'

/** Admin console pages. They live in the sidebar (AppShell) and are selected with `/admin-dashboard?tab=<id>`. */
export type AdminTab = 'overview' | 'teachers' | 'classes' | 'timetable' | 'students' | 'attendance' | 'evaluation' | 'institutions' | 'leads' | 'library'
  | 'admissions' | 'admissions-team' | 'privacy' | 'admission-tests' | 'admission-forms' | 'proctoring'

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
  { id: 'proctoring', label: 'Proctoring', icon: ScanEye, section: 'Academics' },
  { id: 'admissions', label: 'Admissions home', icon: DoorOpen, section: 'Admissions' },
  { id: 'admissions-team', label: 'Admissions team', icon: UserCog, section: 'Admissions' },
  { id: 'admission-tests', label: 'Admission tests', icon: ClipboardCheck, section: 'Admissions' },
  { id: 'admission-forms', label: 'Admission forms', icon: FileSignature, section: 'Admissions' },
  { id: 'privacy', label: 'Privacy & consent', icon: ShieldCheck, section: 'Admissions' },
  { id: 'attendance', label: 'Attendance', icon: CalendarCheck, section: 'Reports' },
  { id: 'evaluation', label: 'Assessment scores', icon: ScanText, section: 'Reports' },
]
// Settings is intentionally not in the navigation (removed from the UI per product decision). The route, panel
// and backend settings API are untouched and still reachable by anyone who already has `?tab=settings` bookmarked
// is not supported — `isAdminTab` below rejects it and AdminDashboard falls back to 'overview'.

export const adminTabsFor = (isSuper: boolean) => ADMIN_TABS.filter((t) => isSuper || !t.superOnly)
export const isAdminTab = (v: string | null, isSuper: boolean): v is AdminTab => adminTabsFor(isSuper).some((t) => t.id === v)
export const adminTabLink = (id: AdminTab) => `/admin-dashboard?tab=${id}`
