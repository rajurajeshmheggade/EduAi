import { useCallback, useEffect, useState } from 'react'
import { Inbox, Mail, Phone, Save } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, Textarea } from '@/components/ui/field'
import { errorMessage } from '@/services/apiClient'
import { LEAD_STATUS as STATUS, leadsService, type Lead, type LeadStatus } from '@/services/leadsService'

/** Platform owner's inbox for demo requests from the public landing page. */
export function DemoRequestsPanel() {
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [counts, setCounts] = useState<Partial<Record<LeadStatus, number>>>({})
  const [filter, setFilter] = useState<LeadStatus | ''>('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await leadsService.list(filter)
      setLeads(data.requests); setCounts(data.counts)
    } catch (e) { setError(errorMessage(e)) }
  }, [filter])
  useEffect(() => { void load() }, [load])

  async function update(id: string, patch: { status?: LeadStatus; notes?: string }) {
    setError(null)
    try { await leadsService.update(id, patch); await load() } catch (e) { setError(errorMessage(e)) }
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2"><Inbox className="h-5 w-5 text-brand-600" /> Demo requests</CardTitle>
          <CardDescription>Leads from the “Book a free demo” form on the website.</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(STATUS) as LeadStatus[]).map((s) => <Badge key={s} tone={STATUS[s].tone}>{STATUS[s].label} {counts[s] ?? 0}</Badge>)}
          <Select aria-label="Filter by status" className="h-9 w-36" value={filter} onChange={(e) => setFilter(e.target.value as LeadStatus | '')}>
            <option value="">All</option>{(Object.keys(STATUS) as LeadStatus[]).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        {!leads ? <div className="skeleton h-40" /> : leads.length === 0 ? <p className="py-10 text-center text-sm text-ink-300">No demo requests yet.</p> : leads.map((l) => (
          <div key={l.request_id} className="rounded-xl border border-line p-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-fg">{l.institution_name} <span className="text-xs font-normal capitalize text-ink-500">· {l.institution_type}{l.city ? ` · ${l.city}` : ''}{l.student_count ? ` · ${l.student_count} students` : ''}</span></div>
                <div className="mt-0.5 flex flex-wrap gap-x-4 text-sm text-ink-300">
                  <span>{l.full_name}{l.role ? ` (${l.role})` : ''}</span>
                  <a href={`mailto:${l.email}`} className="inline-flex items-center gap-1 text-brand-600 hover:underline"><Mail className="h-3.5 w-3.5" />{l.email}</a>
                  {l.phone && <a href={`tel:${l.phone}`} className="inline-flex items-center gap-1 text-brand-600 hover:underline"><Phone className="h-3.5 w-3.5" />{l.phone}</a>}
                </div>
                <div className="mt-1 text-xs text-ink-500">{new Date(l.created_at).toLocaleString()}{l.interests.length ? ` · interested in ${l.interests.join(', ').replace(/_/g, ' ')}` : ''}</div>
                {l.message && <p className="mt-2 rounded-lg bg-ink-800 p-2 text-sm text-ink-100">“{l.message}”</p>}
              </div>
              <Select aria-label={`Status for ${l.institution_name}`} className="h-9 w-36" value={l.status} onChange={(e) => update(l.request_id, { status: e.target.value as LeadStatus })}>
                {(Object.keys(STATUS) as LeadStatus[]).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
              </Select>
            </div>
            <div className="mt-3 flex gap-2">
              <Textarea aria-label={`Notes for ${l.institution_name}`} rows={1} className="min-h-9 text-sm" placeholder="Notes (call outcome, next step…)"
                value={notes[l.request_id] ?? l.notes ?? ''} onChange={(e) => setNotes({ ...notes, [l.request_id]: e.target.value })} />
              <Button size="sm" variant="secondary" className="h-9" onClick={() => update(l.request_id, { notes: notes[l.request_id] ?? l.notes ?? '' })}><Save className="h-3.5 w-3.5" /> Save</Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
