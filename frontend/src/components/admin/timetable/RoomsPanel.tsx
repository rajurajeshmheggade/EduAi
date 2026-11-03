import { useState, type FormEvent } from 'react'
import { DoorClosed, Loader2, Pencil, Plus, Save, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label, Select } from '@/components/ui/field'
import { ErrorState, SkeletonPage } from '@/components/ui/loading'
import { toast } from '@/components/ui/toast'
import { useAsync } from '@/lib/useAsync'
import { errorMessage } from '@/services/apiClient'
import { timetableService, type RoomBody } from '@/services/timetableService'
import type { Room } from '@/types'

const TYPE_LABEL: Record<Room['room_type'], string> = { CLASSROOM: 'Classroom', LAB: 'Lab', HALL: 'Hall', OTHER: 'Other' }
const EMPTY: RoomBody = { room_code: '', room_name: '', room_type: 'CLASSROOM', capacity: null, is_active: true }

/** Rooms master: the picklist for timetable rooms. Two sessions can't use the same room at the same time. */
export function RoomsPanel({ org }: { org?: string | null }) {
  const { data: rooms, error, loading, retry } = useAsync(() => timetableService.rooms(org), [org])
  const [editing, setEditing] = useState<Room | 'new' | null>(null)

  async function remove(r: Room) {
    try { await timetableService.deleteRoom(r.room_id, org); toast(`${r.room_code} removed`, 'success'); retry() } catch (e) { toast(errorMessage(e), 'error') }
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><DoorClosed className="h-4 w-4 text-brand-600" /> Rooms</CardTitle>
          <CardDescription>Offered when you set a session's room. Room clashes are checked for every room name, listed here or not; online sessions need no room.</CardDescription>
        </div>
        <Button size="sm" onClick={() => setEditing('new')} id="add-room"><Plus className="h-3.5 w-3.5" /> Add room</Button>
      </CardHeader>
      <CardContent>
        {error ? <ErrorState message={error} onRetry={retry} /> : loading && !rooms ? <SkeletonPage variant="table" /> : !rooms?.length ? (
          <p className="py-6 text-center text-sm text-ink-300">No rooms yet. Add classrooms, labs and halls to pick them on the timetable.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {rooms.map((r) => (
              <li key={r.room_id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 font-medium text-fg">{r.room_code}
                    <Badge tone={r.room_type === 'LAB' ? 'aqua' : 'neutral'}>{TYPE_LABEL[r.room_type]}</Badge>
                    {!r.is_active && <Badge tone="warn">Not in use</Badge>}
                  </div>
                  <div className="text-xs text-ink-500">{r.room_name || '—'}{r.capacity ? ` · seats ${r.capacity}` : ''}</div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setEditing(r)} aria-label={`Edit ${r.room_code}`}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                <Button size="sm" variant="danger" onClick={() => remove(r)} aria-label={`Remove ${r.room_code}`}><Trash2 className="h-3.5 w-3.5" /></Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {editing && <RoomDialog room={editing === 'new' ? null : editing} org={org} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); retry() }} />}
    </Card>
  )
}

function RoomDialog({ room, org, onClose, onSaved }: { room: Room | null; org?: string | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<RoomBody>(room ? { room_code: room.room_code, room_name: room.room_name ?? '', room_type: room.room_type, capacity: room.capacity, is_active: room.is_active } : EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const body = { ...form, room_name: form.room_name?.trim() || null }
      if (room) await timetableService.updateRoom(room.room_id, body, org)
      else await timetableService.createRoom(body, org)
      toast('Room saved', 'success')
      onSaved()
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  return (
    <Dialog open onClose={onClose} title={room ? `Edit ${room.room_code}` : 'Add room'}>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="rm-code">Room code</Label><Input id="rm-code" required maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9 ._\-/]*" placeholder="e.g. LAB-2" value={form.room_code} onChange={(e) => setForm({ ...form, room_code: e.target.value })} /></div>
        <div><Label htmlFor="rm-type">Type</Label>
          <Select id="rm-type" value={form.room_type} onChange={(e) => setForm({ ...form, room_type: e.target.value as Room['room_type'] })}>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        <div className="sm:col-span-2"><Label htmlFor="rm-name">Name (optional)</Label><Input id="rm-name" maxLength={120} placeholder="e.g. Physics lab, 2nd floor" value={form.room_name ?? ''} onChange={(e) => setForm({ ...form, room_name: e.target.value })} /></div>
        <div><Label htmlFor="rm-cap">Seats (optional)</Label><Input id="rm-cap" type="number" min={1} max={10000} value={form.capacity ?? ''} onChange={(e) => setForm({ ...form, capacity: e.target.value ? Number(e.target.value) : null })} /></div>
        <label className="flex h-10 cursor-pointer items-center gap-2 self-end rounded-xl border border-line px-3 text-sm">
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> In use
        </label>
        {room && room.room_code !== form.room_code && <p className="text-xs text-ink-500 sm:col-span-2">Renaming also updates the timetable periods and classes that use {room.room_code}.</p>}
        {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad sm:col-span-2">{error}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy} id="save-room">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save room</Button>
        </div>
      </form>
    </Dialog>
  )
}
