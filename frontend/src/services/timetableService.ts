import axios from 'axios'
import { api } from './apiClient'
import type { BellItem, BellSchedule, CopyReport, Room, TimetableCalendar, TimetableConflict, TimetableSession } from '@/types'

/** Date-level timetable (admin console): calendar, dated sessions, conflicts, copy, bell schedule, working days, rooms. */
const B = '/ICMELive/api/v1/admin'

/** `org` is only sent by the platform super-admin to act on a specific institution. */
const withOrg = (org?: string | null, extra: Record<string, string> = {}) => ({ params: org ? { ...extra, org_code: org } : extra })

export interface SessionBody {
  class_code: string
  session_date: string
  period_number: number
  subject_code: string
  teacher_code?: string | null
  start_time: string
  end_time: string
  room_number?: string | null
  is_online?: boolean
  online_url?: string | null
  note?: string | null
  /** Moving a session to another period: the period it was in. */
  original_period_number?: number | null
}

export interface ConflictCheckBody {
  class_code: string
  period_number: number
  start_time: string
  end_time: string
  subject_code?: string | null
  teacher_code?: string | null
  room_number?: string | null
  is_online?: boolean
  session_date?: string | null
  day_of_week?: number | null
  effective_from?: string | null
  effective_to?: string | null
}

export interface CopyScope {
  class_codes?: string[]
  teacher_code?: string | null
  mode?: 'skip' | 'overwrite'
  replace_target?: boolean
  dry_run?: boolean
}

export type RoomBody = Omit<Room, 'room_id'>

/** The full conflict list a 409 from a timetable write carries (empty for any other error). */
export function conflictsOf(e: unknown): TimetableConflict[] {
  if (axios.isAxiosError(e) && e.response?.status === 409) {
    const c = (e.response.data as { conflicts?: TimetableConflict[] } | undefined)?.conflicts
    return Array.isArray(c) ? c : []
  }
  return []
}

export const timetableService = {
  async calendar(range: { start: string; end: string; class_code?: string; teacher_code?: string }, org?: string | null, signal?: AbortSignal) {
    const params: Record<string, string> = { start: range.start, end: range.end }
    if (range.class_code) params.class_code = range.class_code
    if (range.teacher_code) params.teacher_code = range.teacher_code
    return (await api.get<TimetableCalendar>(`${B}/timetable/calendar`, { ...withOrg(org, params), signal })).data
  },
  async saveSession(body: SessionBody, org?: string | null) {
    return (await api.put<{ session: TimetableSession; warnings: TimetableConflict[] }>(`${B}/timetable/sessions`, body, withOrg(org))).data
  },
  async cancelSession(body: { class_code: string; session_date: string; period_number: number; reason?: string | null }, org?: string | null) {
    return (await api.post<{ cancelled: string; session: TimetableSession | null }>(`${B}/timetable/sessions/cancel`, body, withOrg(org))).data
  },
  /** Removes a dated entry: an extra session disappears; an override / cancellation is undone (weekly period again). */
  async deleteEntry(entryId: string, reason?: string | null, org?: string | null) {
    return (await api.delete<{ deleted: string; restored: TimetableSession | null }>(`${B}/timetable/sessions/${entryId}`,
      withOrg(org, reason ? { reason } : {}))).data
  },
  async checkConflicts(body: ConflictCheckBody, org?: string | null) {
    return (await api.post<{ ok: boolean; conflicts: TimetableConflict[] }>(`${B}/timetable/check-conflicts`, body, withOrg(org))).data
  },
  async copy(body: CopyScope & { source_date: string; target_dates?: string[]; target_start?: string; target_end?: string }, org?: string | null) {
    return (await api.post<CopyReport>(`${B}/timetable/copy`, body, withOrg(org))).data
  },
  async copyWeek(body: CopyScope & { source_week: string; target_week: string; weeks?: number }, org?: string | null) {
    return (await api.post<CopyReport>(`${B}/timetable/copy-week`, body, withOrg(org))).data
  },
  async workingDays(org?: string | null) {
    return (await api.get<{ working_days: number[]; weekly_periods_on_closed_days: number }>(`${B}/timetable/working-days`, withOrg(org))).data
  },
  async setWorkingDays(days: number[], org?: string | null) {
    return (await api.put<{ working_days: number[]; weekly_periods_on_closed_days: number }>(`${B}/timetable/working-days`, { working_days: days }, withOrg(org))).data
  },
  async bellSchedule(org?: string | null) {
    return (await api.get<BellSchedule>(`${B}/timetable/bell-schedule`, withOrg(org))).data
  },
  /** `day` null = the default bell; 1–7 = that weekday's own bell. Empty `items` removes it (or resets the default). */
  async setBellSchedule(day: number | null, items: BellItem[], org?: string | null) {
    return (await api.put<BellSchedule>(`${B}/timetable/bell-schedule`, { day_of_week: day, items }, withOrg(org))).data
  },
  async rooms(org?: string | null) {
    return (await api.get<{ rooms: Room[] }>(`${B}/rooms`, withOrg(org))).data.rooms
  },
  async createRoom(body: RoomBody, org?: string | null) {
    return (await api.post<Room>(`${B}/rooms`, body, withOrg(org))).data
  },
  async updateRoom(id: string, body: RoomBody, org?: string | null) {
    return (await api.put<Room>(`${B}/rooms/${id}`, body, withOrg(org))).data
  },
  async deleteRoom(id: string, org?: string | null) {
    return (await api.delete(`${B}/rooms/${id}`, withOrg(org))).data
  },
}
