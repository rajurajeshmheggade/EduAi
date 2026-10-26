export const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const DAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const PERIODS = Array.from({ length: 8 }, (_, i) => `Period-${i + 1}`)

/** Default bell schedule (45-min periods from 09:00, 15-min break after period 3) used to prefill new slots. */
export function defaultPeriodTimes(n: number): { start: string; end: string } {
  const start = 9 * 60 + (n - 1) * 45 + (n > 3 ? 15 : 0)
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  return { start: fmt(start), end: fmt(start + 45) }
}

/** Deep link that opens the attendance page pre-selected for a timetable period. */
export const markAttendanceLink = (s: { class_code: string; subject_code: string; period_number: number }) =>
  `/teacher/attendance?class=${encodeURIComponent(s.class_code)}&subject=${encodeURIComponent(s.subject_code)}&period=${s.period_number}`
