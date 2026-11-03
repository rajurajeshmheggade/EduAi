import { describe, expect, it } from 'vitest'
import {
  addDays, addMonths, bellForDay, eachDate, endOfMonth, gridRows, isoWeekday, isWorkingDay, minutes, monthGrid, overlaps,
  parseISODate, rangeLabel, sessionsByDate, shiftAnchor, startOfWeek, toISODate, todayISO, viewRange, weekDates,
} from './calendar'
import type { BellSchedule, TimetableSession } from '@/types'

const session = (over: Partial<TimetableSession>): TimetableSession => ({
  session_key: 'k', session_date: '2026-11-02', day_of_week: 1, class_code: 'G10', class_name: 'Grade 10', period_number: 1,
  start_time: '09:00', end_time: '09:45', subject_code: 'PHY', subject_name: 'Physics', subject_type: 'THEORY',
  teacher_code: 'T1', teacher_name: 'Priya', room_number: null, is_online: false, online_url: null, source: 'TEMPLATE',
  status: 'SCHEDULED', slot_id: 's1', entry_id: null, schedule_type: 'WEEKLY', template_teacher_code: 'T1', note: null,
  holiday_name: null, class_timetable_status: 'PUBLISHED', copied_from: null, ...over,
})

const P = (n: number, start: string, end: string) => ({ item_kind: 'PERIOD' as const, period_number: n, label: null, start_time: start, end_time: end })
const B = (label: string, start: string, end: string) => ({ item_kind: 'BREAK' as const, period_number: null, label, start_time: start, end_time: end })

describe('ISO date arithmetic', () => {
  it('round-trips and adds days across month, year and DST boundaries', () => {
    expect(toISODate(parseISODate('2026-11-02'))).toBe('2026-11-02')
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30')   // EU DST change weekend
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')   // leap year
  })

  it('adds months without overflowing short months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
  })

  it('uses ISO weekdays (Monday = 1, Sunday = 7) and Monday-first weeks', () => {
    expect(isoWeekday('2026-11-02')).toBe(1)
    expect(isoWeekday('2026-11-07')).toBe(6)
    expect(isoWeekday('2026-11-08')).toBe(7)
    expect(startOfWeek('2026-11-08')).toBe('2026-11-02')
    expect(startOfWeek('2026-11-02')).toBe('2026-11-02')
    expect(weekDates('2026-11-04')).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'])
    expect(weekDates('2026-12-30')[6]).toBe('2027-01-03')
  })

  it('lists date ranges inclusively', () => {
    expect(eachDate('2026-11-29', '2026-12-02')).toEqual(['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02'])
    expect(eachDate('2026-11-02', '2026-11-01')).toEqual([])
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28')
  })

  it('formats today in local time', () => {
    expect(todayISO(new Date(2026, 10, 2, 23, 59))).toBe('2026-11-02')
  })
})

describe('month grid and view ranges', () => {
  it('covers whole Monday–Sunday weeks around the month', () => {
    const grid = monthGrid('2026-11-15')        // 1 Nov 2026 is a Sunday, 30 Nov a Monday
    expect(grid[0][0]).toBe('2026-10-26')
    expect(grid[0][6]).toBe('2026-11-01')
    expect(grid[grid.length - 1][0]).toBe('2026-11-30')
    expect(grid[grid.length - 1][6]).toBe('2026-12-06')
    expect(grid).toHaveLength(6)
    expect(grid.every((w) => w.length === 7)).toBe(true)
    expect(monthGrid('2027-02-10')).toHaveLength(4)   // Feb 2027 starts on a Monday and ends on a Sunday
  })

  it('maps each view to the range it fetches and navigates by its own unit', () => {
    expect(viewRange('day', '2026-11-04')).toEqual({ start: '2026-11-04', end: '2026-11-04' })
    expect(viewRange('week', '2026-11-04')).toEqual({ start: '2026-11-02', end: '2026-11-08' })
    expect(viewRange('month', '2026-11-04')).toEqual({ start: '2026-10-26', end: '2026-12-06' })
    expect(shiftAnchor('day', '2026-11-04', -1)).toBe('2026-11-03')
    expect(shiftAnchor('week', '2026-11-04', 1)).toBe('2026-11-11')
    expect(shiftAnchor('month', '2026-01-31', 1)).toBe('2026-02-28')
  })

  it('labels the range for the toolbar', () => {
    expect(rangeLabel('week', '2026-11-04')).toMatch(/2.*8.*2026/)
    expect(rangeLabel('month', '2026-11-04')).toMatch(/2026/)
  })
})

describe('time and timetable helpers', () => {
  it('compares HH:MM ranges as half-open intervals', () => {
    expect(minutes('09:45')).toBe(585)
    expect(overlaps({ start_time: '09:00', end_time: '09:45' }, { start_time: '09:30', end_time: '10:15' })).toBe(true)
    expect(overlaps({ start_time: '09:00', end_time: '09:45' }, { start_time: '09:45', end_time: '10:30' })).toBe(false)
  })

  it('picks a weekday’s own bell, else the default', () => {
    const bell: BellSchedule = { configured: true, default: [P(1, '09:00', '09:45')], by_day: { 6: [P(1, '08:00', '08:40')] } }
    expect(bellForDay(bell, 6)[0].start_time).toBe('08:00')
    expect(bellForDay(bell, 2)[0].start_time).toBe('09:00')
    expect(bellForDay(null, 2)).toEqual([])
  })

  it('builds grid rows with breaks between the right periods and extra session periods', () => {
    const bell: BellSchedule = {
      configured: true,
      default: [P(1, '09:00', '09:45'), P(2, '09:45', '10:30'), B('Recess', '10:30', '10:45'), P(3, '10:45', '11:30'), B('Lunch', '11:30', '12:00')],
      by_day: {},
    }
    const rows = gridRows(bell, [1, 2, 3], [session({ period_number: 9, start_time: '15:00', end_time: '15:45' })])
    expect(rows.map((r) => (r.kind === 'break' ? r.item.label : `P${r.period}`))).toEqual(['P1', 'P2', 'Recess', 'P3', 'P9', 'Lunch'])
  })

  it('groups sessions by date in time order and checks working days', () => {
    const grouped = sessionsByDate([
      session({ session_date: '2026-11-03', period_number: 2, start_time: '09:45' }),
      session({ session_date: '2026-11-03', period_number: 1, start_time: '09:00' }),
      session({ session_date: '2026-11-02' }),
    ])
    expect([...grouped.keys()]).toEqual(['2026-11-03', '2026-11-02'])
    expect(grouped.get('2026-11-03')!.map((s) => s.period_number)).toEqual([1, 2])
    expect(isWorkingDay([1, 2, 3, 4, 5], '2026-11-07')).toBe(false)
    expect(isWorkingDay([1, 2, 3, 4, 5, 6], '2026-11-07')).toBe(true)
    expect(isWorkingDay(undefined, '2026-11-08')).toBe(true)
  })
})
