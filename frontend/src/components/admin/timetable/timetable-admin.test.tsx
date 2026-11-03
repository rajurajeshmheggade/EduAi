import { AxiosError, AxiosHeaders } from 'axios'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { timetableService } from '@/services/timetableService'
import type { BellSchedule, Member, SchoolClass, TimetableCalendar, TimetableConflict, TimetableSession } from '@/types'
import { BellSchedulePanel } from './BellSchedulePanel'
import { DatedCalendarPanel } from './DatedCalendarPanel'

vi.mock('@/services/timetableService', async (orig) => {
  const real = await orig<typeof import('@/services/timetableService')>()
  return {
    ...real,
    timetableService: {
      ...real.timetableService, calendar: vi.fn(), saveSession: vi.fn(), checkConflicts: vi.fn(), cancelSession: vi.fn(),
      deleteEntry: vi.fn(), workingDays: vi.fn(), setWorkingDays: vi.fn(), bellSchedule: vi.fn(), setBellSchedule: vi.fn(),
    },
  }
})
const svc = vi.mocked(timetableService)

const P = (n: number, start: string, end: string) => ({ item_kind: 'PERIOD' as const, period_number: n, label: null, start_time: start, end_time: end })
const BELL: BellSchedule = { configured: false, default: [P(1, '09:00', '09:45'), P(2, '09:45', '10:30'), { item_kind: 'BREAK', period_number: null, label: 'Break', start_time: '10:30', end_time: '10:45' }], by_day: {} }
const CLASSES = [{ class_code: 'G10', class_name: 'Grade 10', is_active: true, timetable_status: 'PUBLISHED', room_number: null,
  subjects: [{ subject_code: 'PHY', subject_name: 'Physics', subject_type: 'THEORY', teacher_code: 'T1', teacher_name: 'Priya' }] }] as unknown as SchoolClass[]
const TEACHERS = [{ user_code: 'T1', full_name: 'Priya', is_active: true }, { user_code: 'T2', full_name: 'Kavya', is_active: true }] as unknown as Member[]

const today = new Date()
const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
const SESSION: TimetableSession = {
  session_key: `${iso}:G10:1`, session_date: iso, day_of_week: 1, class_code: 'G10', class_name: 'Grade 10', period_number: 1,
  start_time: '09:00', end_time: '09:45', subject_code: 'PHY', subject_name: 'Physics', subject_type: 'THEORY', teacher_code: 'T1',
  teacher_name: 'Priya', room_number: null, is_online: false, online_url: null, source: 'TEMPLATE', status: 'SCHEDULED', slot_id: 's1',
  entry_id: null, schedule_type: 'WEEKLY', template_teacher_code: 'T1', note: null, holiday_name: null, class_timetable_status: 'PUBLISHED', copied_from: null,
}
const CAL: TimetableCalendar = { start: iso, end: iso, today: iso, sessions: [SESSION], holidays: [], working_days: [1, 2, 3, 4, 5, 6, 7], bell_schedule: BELL }

const conflict = (kind: TimetableConflict['kind'], message: string, severity: 'error' | 'warning' = 'error'): TimetableConflict => ({
  kind, severity, message, conflict_date: iso, day_of_week: 1, class_code: 'G9', period_number: 1, start_time: '09:00', end_time: '09:45',
  teacher_code: 'T2', room_number: null, subject_name: 'English', source: 'TEMPLATE',
})

beforeEach(() => {
  vi.clearAllMocks()
  svc.calendar.mockResolvedValue(CAL)
})

describe('DatedCalendarPanel', () => {
  it('opens a session for the date and lists every conflict from a 409', async () => {
    render(<DatedCalendarPanel org={null} classes={CLASSES} teachers={TEACHERS} rooms={[]} />)
    const card = await screen.findByRole('button', { name: /Physics, Grade 10, period 1.*Edit/ })
    expect(svc.calendar).toHaveBeenCalledWith(expect.objectContaining({ class_code: 'G10' }), null, expect.anything())
    fireEvent.click(card)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Weekly period')).toBeInTheDocument()

    const found = [conflict('TEACHER_CLASH', 'Kavya already teaches G9 (period 1, 09:00-09:45)'), conflict('ROOM_CLASH', 'Room LAB-1 is already used by G9'),
      conflict('BREAK_OVERLAP', 'Overlaps Break (10:30-10:45)', 'warning')]
    svc.saveSession.mockRejectedValue(new AxiosError('Conflict', '409', undefined, undefined,
      { status: 409, statusText: 'Conflict', headers: {}, config: { headers: new AxiosHeaders() }, data: { detail: found[0].message, conflicts: found } }))
    fireEvent.change(within(dialog).getByLabelText('Teacher'), { target: { value: 'T2' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Save for this date/ }))

    expect(await within(dialog).findByText(/2 conflicts — not saved/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Kavya already teaches G9/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Room LAB-1 is already used/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Overlaps Break/)).toBeInTheDocument()
    expect(svc.saveSession).toHaveBeenCalledWith(expect.objectContaining({ class_code: 'G10', session_date: iso, period_number: 1, teacher_code: 'T2' }), null)
  })

  it('cancels a weekly period for one date', async () => {
    svc.cancelSession.mockResolvedValue({ cancelled: SESSION.session_key, session: { ...SESSION, status: 'CANCELLED' } })
    render(<DatedCalendarPanel org="DEMO" classes={CLASSES} teachers={TEACHERS} rooms={[]} />)
    fireEvent.click(await screen.findByRole('button', { name: /Physics, Grade 10, period 1.*Edit/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Cancel on this date/ }))
    await waitFor(() => expect(svc.cancelSession).toHaveBeenCalledWith({ class_code: 'G10', session_date: iso, period_number: 1, reason: null }, 'DEMO'))
    await waitFor(() => expect(svc.calendar).toHaveBeenCalledTimes(2))   // reloaded after the change
  })
})

describe('BellSchedulePanel', () => {
  it('edits the bell, blocks overlaps before saving, and saves working days', async () => {
    svc.workingDays.mockResolvedValue({ working_days: [1, 2, 3, 4, 5, 6, 7], weekly_periods_on_closed_days: 0 })
    svc.setWorkingDays.mockResolvedValue({ working_days: [1, 2, 3, 4, 5, 6], weekly_periods_on_closed_days: 2 })
    svc.bellSchedule.mockResolvedValue(BELL)
    svc.setBellSchedule.mockResolvedValue({ ...BELL, configured: true })
    render(<BellSchedulePanel org={null} />)

    expect(await screen.findByText('Built-in bell')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Row 2 start'), { target: { value: '09:30' } })
    expect(screen.getByText('Period 1 and Period 2 overlap.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save default bell/ })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Row 2 start'), { target: { value: '09:45' } })
    fireEvent.click(screen.getByRole('button', { name: /Save default bell/ }))
    await waitFor(() => expect(svc.setBellSchedule).toHaveBeenCalledWith(null, BELL.default, null))

    fireEvent.click(screen.getByRole('checkbox', { name: 'Sunday' }))
    fireEvent.click(screen.getByRole('button', { name: /Save working days/ }))
    await waitFor(() => expect(svc.setWorkingDays).toHaveBeenCalledWith([1, 2, 3, 4, 5, 6], null))
    expect(await screen.findByText(/2 weekly periods are on a closed day/)).toBeInTheDocument()
  })
})
