import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classroomService } from '@/services/classroomService'
import type { BellSchedule, MyTimetable, TimetableSession } from '@/types'
import { MyTimetableView } from './MyTimetableView'

vi.mock('@/services/classroomService', async (orig) => {
  const real = await orig<typeof import('@/services/classroomService')>()
  return { ...real, classroomService: { ...real.classroomService, myTimetable: vi.fn() } }
})
const svc = vi.mocked(classroomService)

const TODAY = '2026-11-04'                                  // a Wednesday
const P = (n: number, start: string, end: string) => ({ item_kind: 'PERIOD' as const, period_number: n, label: null, start_time: start, end_time: end })
const BELL: BellSchedule = { configured: true, default: [P(1, '09:00', '09:45'), P(2, '09:45', '10:30')], by_day: {} }
const session = (over: Partial<TimetableSession>): TimetableSession => ({
  session_key: `${over.session_date ?? TODAY}:G10:${over.period_number ?? 1}`, session_date: TODAY, day_of_week: 3,
  class_code: 'G10', class_name: 'Grade 10', period_number: 1, start_time: '09:00', end_time: '09:45', subject_code: 'PHY',
  subject_name: 'Physics', subject_type: 'THEORY', teacher_code: 'T1', teacher_name: 'Priya', room_number: null, is_online: false,
  online_url: null, source: 'TEMPLATE', status: 'SCHEDULED', slot_id: 's1', entry_id: null, schedule_type: 'WEEKLY',
  template_teacher_code: 'T1', note: null, holiday_name: null, class_timetable_status: 'PUBLISHED', copied_from: null, ...over,
})
const data = (sessions: TimetableSession[], range = { start: TODAY, end: TODAY }): MyTimetable => ({
  today: 3, today_date: TODAY, slots: [{ slot_id: 's1' } as MyTimetable['slots'][number]], holidays: [], recent_changes: [], range,
  sessions, range_holidays: [], working_days: [1, 2, 3, 4, 5, 6], bell_schedule: BELL,
})

function renderView(role: 'teacher' | 'student') {
  return render(<MemoryRouter><MyTimetableView role={role} /></MemoryRouter>)
}

describe('MyTimetableView — opens on today', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 4, 9, 15))         // local 09:15 on TODAY: period 1 is running
    svc.myTimetable.mockImplementation(async (range) => data(
      range?.start === TODAY && range.end === TODAY
        ? [session({}), session({ period_number: 2, start_time: '09:45', end_time: '10:30', subject_name: 'Maths', is_online: true, online_url: 'https://meet.example/x' })]
        : [session({}), session({ session_date: '2026-11-05', day_of_week: 4, subject_name: 'Chemistry' })],
      range))
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it.each(['student', 'teacher'] as const)('%s: today’s day view by default, with one request for today', async (role) => {
    renderView(role)
    expect(await screen.findByRole('heading', { name: 'Today’s timetable' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'day' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'week' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Today' })).toBeDisabled()
    expect(screen.getByLabelText('Go to date')).toHaveValue(TODAY)
    // today's periods, the running one marked
    expect(screen.getByLabelText(/^Physics, Grade 10, period 1/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Maths, Grade 10, period 2/)).toBeInTheDocument()
    expect(screen.getByRole('listitem', { current: 'time' })).toHaveTextContent('NOW')
    expect(screen.getByRole('button', { name: /Join online/ })).toBeInTheDocument()
    // the calendar reuses today's data instead of fetching the same date twice
    expect(svc.myTimetable).toHaveBeenCalledTimes(1)
    expect(svc.myTimetable).toHaveBeenCalledWith({ start: TODAY, end: TODAY }, expect.anything())
  })

  it('teachers get “Mark attendance” on today’s periods', async () => {
    renderView('teacher')
    expect(await screen.findAllByRole('link', { name: /Mark attendance/ })).toHaveLength(2)
  })

  it('the week view stays one click away, and “Today” comes back to the day', async () => {
    renderView('student')
    await screen.findByRole('heading', { name: 'Today’s timetable' })
    fireEvent.click(screen.getByRole('button', { name: 'week' }))
    expect(svc.myTimetable).toHaveBeenLastCalledWith({ start: '2026-11-02', end: '2026-11-08' }, expect.anything())
    expect(await screen.findByLabelText(/^Chemistry/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Timetable' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'day' }))
    expect(await screen.findByRole('heading', { name: 'Today’s timetable' })).toBeInTheDocument()
  })
})
