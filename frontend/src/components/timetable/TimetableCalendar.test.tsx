import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { bellProblems, periodOptions } from '@/lib/timetable'
import type { BellSchedule, Holiday, TimetableSession } from '@/types'
import { CalendarToolbar, TimetableCalendar } from './TimetableCalendar'

const P = (n: number, start: string, end: string) => ({ item_kind: 'PERIOD' as const, period_number: n, label: null, start_time: start, end_time: end })
const B = (label: string, start: string, end: string) => ({ item_kind: 'BREAK' as const, period_number: null, label, start_time: start, end_time: end })
const BELL: BellSchedule = { configured: true, default: [P(1, '09:00', '09:45'), P(2, '09:45', '10:30'), B('Recess', '10:30', '10:45'), P(3, '10:45', '11:30')], by_day: {} }

const s = (over: Partial<TimetableSession>): TimetableSession => ({
  session_key: `${over.session_date ?? '2026-11-02'}:G10:${over.period_number ?? 1}`, session_date: '2026-11-02', day_of_week: 1,
  class_code: 'G10', class_name: 'Grade 10', period_number: 1, start_time: '09:00', end_time: '09:45', subject_code: 'PHY',
  subject_name: 'Physics', subject_type: 'THEORY', teacher_code: 'T1', teacher_name: 'Priya', room_number: null, is_online: false,
  online_url: null, source: 'TEMPLATE', status: 'SCHEDULED', slot_id: 's1', entry_id: null, schedule_type: 'WEEKLY',
  template_teacher_code: 'T1', note: null, holiday_name: null, class_timetable_status: 'PUBLISHED', copied_from: null, ...over,
})

const SESSIONS = [
  s({}),
  s({ period_number: 2, start_time: '09:45', end_time: '10:30', subject_name: 'Maths', source: 'OVERRIDE', teacher_code: 'T2', teacher_name: 'Kavya', entry_id: 'e1' }),
  s({ session_date: '2026-11-03', day_of_week: 2, status: 'CANCELLED', entry_id: 'e2' }),
  s({ session_date: '2026-11-04', day_of_week: 3, period_number: 9, start_time: '15:00', end_time: '15:45', source: 'DATED', slot_id: null, entry_id: 'e3', subject_name: 'Lab' }),
]
const HOLIDAY: Holiday = { holiday_id: 'h1', name: 'Founders Day', start_date: '2026-11-06', end_date: '2026-11-06', holiday_type: 'SCHOOL',
  description: null, scope: 'SCHOOL_WIDE', class_codes: [], is_full_day: true, status: 'PUBLISHED' }

const base = { anchor: '2026-11-04', sessions: SESSIONS, holidays: [HOLIDAY], bell: BELL, workingDays: [1, 2, 3, 4, 5, 6], today: '2026-11-02', secondary: 'teacher' as const }

describe('TimetableCalendar', () => {
  it('week view: periods with the bell break, dated changes, cancellations, holidays and closed days', () => {
    const onSession = vi.fn()
    const onEmpty = vi.fn()
    render(<TimetableCalendar {...base} view="week" onSession={onSession} onEmpty={onEmpty} />)
    const table = screen.getByRole('table')
    const rows = within(table).getAllByRole('row').map((r) => within(r).queryAllByRole('rowheader')[0]?.textContent ?? '')
    expect(rows.slice(1)).toEqual(['P109:00', 'P209:45', 'Recess', 'P310:45', 'P9'])
    expect(screen.getByRole('button', { name: /Maths.*Changed for this date. Edit/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Physics.*Cancelled. Edit/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Lab.*Extra session. Edit/ })).toBeInTheDocument()
    expect(screen.getByText('Founders Day')).toBeInTheDocument()
    expect(screen.getByText('Closed')).toBeInTheDocument()                          // Sunday
    expect(screen.getByRole('columnheader', { current: 'date' })).toHaveTextContent('Mon')

    fireEvent.click(screen.getByRole('button', { name: /Maths/ }))
    expect(onSession).toHaveBeenCalledWith(expect.objectContaining({ entry_id: 'e1' }))
    // a cancelled period can be filled again; Sunday (closed) offers no add buttons
    fireEvent.click(screen.getByRole('button', { name: /Add a session on Tue.*period 1/ }))
    expect(onEmpty).toHaveBeenCalledWith('2026-11-03', 1)
    expect(screen.queryAllByRole('button', { name: /Add a session on Sun/ })).toHaveLength(0)
  })

  it('day view lists the bell of that day, and month view summarises each date', () => {
    const { rerender } = render(<TimetableCalendar {...base} view="day" anchor="2026-11-02" />)
    expect(screen.getByText('Recess')).toBeInTheDocument()
    expect(screen.getByLabelText(/Maths, Grade 10, period 2/)).toBeInTheDocument()
    expect(screen.getAllByText('Free')).toHaveLength(1)                              // P3

    const onDay = vi.fn()
    rerender(<TimetableCalendar {...base} view="month" anchor="2026-11-15" onDay={onDay} />)
    fireEvent.click(screen.getByRole('button', { name: /2 sessions, 1 changed or extra/ }))
    expect(onDay).toHaveBeenCalledWith('2026-11-02')
    expect(screen.getByRole('button', { name: /0 sessions, 1 cancelled/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /holiday Founders Day/ })).toBeInTheDocument()
  })

  it('toolbar switches views and steps by the view unit', () => {
    const onView = vi.fn()
    const onAnchor = vi.fn()
    render(<CalendarToolbar view="week" anchor="2026-11-04" today="2026-11-04" onView={onView} onAnchor={onAnchor} />)
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(onAnchor).toHaveBeenCalledWith('2026-11-11')
    fireEvent.click(screen.getByRole('button', { name: 'month' }))
    expect(onView).toHaveBeenCalledWith('month')
    expect(screen.getByRole('button', { name: 'Today' })).toBeDisabled()
  })
})

describe('timetable helpers', () => {
  it('offers attendance periods from the bell plus the day’s extra periods, marking the teacher’s own', () => {
    const opts = periodOptions(BELL.default, [{ period_number: 9, start_time: '15:00', end_time: '15:45' }], new Set([2, 9]))
    expect(opts.map((o) => [o.value, o.scheduled])).toEqual([['Period-1', false], ['Period-2', true], ['Period-3', false], ['Period-9', true]])
    expect(opts[1].label).toBe('Period 2 · 09:45–10:30')
  })

  it('flags bell schedules the server would reject', () => {
    expect(bellProblems(BELL.default)).toEqual([])
    expect(bellProblems([P(1, '09:00', '09:45'), P(1, '10:00', '10:45')])).toContain('Each period number may appear only once.')
    expect(bellProblems([P(1, '09:00', '09:45'), B('Snack', '09:30', '09:50')])).toContain('Period 1 and Snack overlap.')
    expect(bellProblems([P(1, '09:45', '09:00')])).toContain('Every row needs an end time after its start time.')
  })
})
