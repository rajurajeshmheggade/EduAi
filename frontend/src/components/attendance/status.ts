import type { AttendanceStatus } from '@/types'

export const STATUS_ORDER: AttendanceStatus[] = ['present', 'absent', 'late', 'excused']

export const STATUS_META: Record<AttendanceStatus, { label: string; short: string; idle: string; active: string; cell: string }> = {
  present: { label: 'Present', short: 'P', idle: 'hover:border-ok/50 hover:text-ok', active: 'border-ok bg-ok text-white', cell: 'bg-ok/15 text-ok' },
  absent: { label: 'Absent', short: 'A', idle: 'hover:border-bad/50 hover:text-bad', active: 'border-bad bg-bad text-white', cell: 'bg-bad/15 text-bad' },
  late: { label: 'Late', short: 'L', idle: 'hover:border-warn/50 hover:text-warn', active: 'border-warn bg-warn text-white', cell: 'bg-warn/15 text-warn' },
  excused: { label: 'Leave', short: 'LV', idle: 'hover:border-brand-400/50 hover:text-brand-600', active: 'border-brand-500 bg-brand-500 text-white', cell: 'bg-brand-500/12 text-brand-600' },
}
