import { api } from './apiClient'

export type LeadStatus = 'NEW' | 'CONTACTED' | 'DEMO_DONE' | 'WON' | 'LOST'
export interface Lead {
  request_id: string; full_name: string; email: string; phone: string | null; institution_name: string
  institution_type: string; role: string | null; city: string | null; student_count: string | null
  interests: string[]; message: string | null; status: LeadStatus; notes: string | null; created_at: string
}
export const LEAD_STATUS: Record<LeadStatus, { label: string; tone: 'brand' | 'warn' | 'aqua' | 'ok' | 'neutral' }> = {
  NEW: { label: 'New', tone: 'brand' }, CONTACTED: { label: 'Contacted', tone: 'warn' }, DEMO_DONE: { label: 'Demo done', tone: 'aqua' },
  WON: { label: 'Won', tone: 'ok' }, LOST: { label: 'Lost', tone: 'neutral' },
}
const B = '/ICMELive/api/v1/admin/demo-requests'

/** Demo requests from the public website (platform super-admin only). */
export const leadsService = {
  list: async (status?: LeadStatus | '') =>
    (await api.get<{ requests: Lead[]; counts: Partial<Record<LeadStatus, number>> }>(B, { params: status ? { status_filter: status } : {} })).data,
  update: async (id: string, patch: { status?: LeadStatus; notes?: string }) => { await api.patch(`${B}/${id}`, patch) },
}
