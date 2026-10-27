import { useState, type ReactNode } from 'react'
import { ArrowLeft, BookOpen, Calendar, ClipboardList, Clock, Eye, Loader2, Plus, Search, Trash2, TriangleAlert, Users } from 'lucide-react'
import { ConfirmDialog } from '@/components/lesson-plan/dialogs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import type { LessonPlanRow, SessionRow } from '@/types/lessonPlan'
import { Pager } from './Pager'

/* Session Manager — the sessions belonging to one lesson plan (port of Rapid's SessionList.jsx).
   Header, the lesson-plan summary card with search + Create Session, a 3-up grid of session cards with
   Plan / Preview / Delete, and honest loading / error / no-match / empty states. DATA is the server's
   paginated list — nothing is derived in the browser.

   Card stats: Objectives = the generated content's specific objectives; Outcomes = the ELOs selected for the
   session (falling back to the content's own outcome list for an older row). */

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Generated list fields arrive as strings or as objects carrying the text under one of a few keys. */
const textsOf = (v: unknown): string[] => (Array.isArray(v) ? v : [])
  .map((x) => (typeof x === 'string' ? x : String((x && typeof x === 'object' && ((x as Record<string, unknown>).text || (x as Record<string, unknown>).elo || (x as Record<string, unknown>).title)) || '')))
  .map((s) => s.trim())
  .filter(Boolean)

export interface SessionCardData {
  id: string
  sessionNo: number
  title: string
  duration: string
  date: string
  status: 'completed' | 'draft'
  objectives: number
  outcomes: number
  raw: SessionRow
}

/** One API row → the shape the card renders. */
function cardOf(row: SessionRow): SessionCardData {
  const elos = Array.isArray(row.elos) ? row.elos : []
  const content = row.content && typeof row.content === 'object' ? row.content : {}
  return {
    id: row.id,
    sessionNo: row.sessionNo,
    title: row.title || `Session ${row.sessionNo || ''}`,
    duration: row.durationMins ? `${row.durationMins} mins` : '—',
    date: fmtDate(row.updatedAt || row.createdAt),
    status: row.status === 'completed' ? 'completed' : 'draft',
    objectives: textsOf(content.specificObjectives).length,
    outcomes: elos.length || textsOf(content.learningOutcomes).length,
    raw: row,
  }
}

function Meta({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-500 [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:shrink-0">{icon}{children}</span>
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center">
      <div className="font-display text-lg font-semibold leading-tight text-fg tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11.5px] text-ink-500">{label}</div>
    </div>
  )
}

/** The card is a container, not a button: a session opens through its named actions only (Plan / Preview). */
function SessionCard({ session, onPlan, onPreview, onDelete }: {
  session: SessionCardData; onPlan: () => void; onPreview: () => void; onDelete: () => void
}) {
  return (
    <div className="glass flex w-full flex-col gap-3.5 rounded-2xl p-5 text-left transition-[border-color,box-shadow] duration-150 hover:border-brand-400/50 hover:shadow-[0_4px_14px_-8px_rgb(16_24_40/.18)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-base font-semibold leading-snug text-fg">
          {session.sessionNo ? <span className="font-medium text-ink-500">{session.sessionNo}. </span> : null}{session.title}
        </div>
        <Badge tone={session.status === 'completed' ? 'ok' : 'warn'} className="shrink-0 capitalize">{session.status}</Badge>
      </div>
      <div className="flex flex-wrap gap-4">
        <Meta icon={<Clock />}>{session.duration}</Meta>
        {session.date ? <Meta icon={<Calendar />}>{session.date}</Meta> : null}
      </div>
      <div className="grid grid-cols-2 gap-2.5 border-t border-line pt-3">
        <Stat value={session.objectives} label="Objectives" />
        <Stat value={session.outcomes} label="Outcomes" />
      </div>
      <div className="mt-0.5 grid grid-cols-[1fr_1fr_auto] gap-2 border-t border-line pt-3">
        <Button variant="secondary" size="sm" onClick={onPlan} title={`Plan — ${session.title}`}><ClipboardList className="h-3.5 w-3.5" />Plan</Button>
        <Button variant="secondary" size="sm" onClick={onPreview} title={`Preview — ${session.title}`}><Eye className="h-3.5 w-3.5" />Preview</Button>
        <Button variant="secondary" size="sm" onClick={onDelete} aria-label={`Delete ${session.title}`} title="Delete"
          className="w-10 px-0 hover:border-bad/40 hover:bg-bad/10 hover:text-bad"><Trash2 className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  )
}

function StateCard({ icon, iconClass, title, children, action }: { icon: ReactNode; iconClass: string; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="glass rounded-2xl px-7 py-12 text-center">
      <span className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[20px] [&>svg]:h-7 [&>svg]:w-7 ${iconClass}`}>{icon}</span>
      <h3 className="mb-1.5 font-display text-[17px] font-semibold text-fg">{title}</h3>
      <div className="mx-auto max-w-[460px] text-[13.5px] leading-relaxed text-ink-500">{children}</div>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function SessionList({
  plan, rows, total, page, pageSize, loading, error, search,
  onSearch, onPageChange, onPageSize, onRetry, onBack, onCreate, onPlanSession, onPreviewSession, onDeleteSession,
}: {
  plan: LessonPlanRow
  rows: SessionRow[]
  total: number
  page: number
  pageSize: number
  loading: boolean
  error: string
  search: string
  onSearch: (q: string) => void
  onPageChange: (n: number) => void
  onPageSize: (n: number) => void
  onRetry: () => void
  onBack: () => void
  onCreate: () => void
  onPlanSession: (s: SessionCardData) => void
  onPreviewSession: (s: SessionCardData) => void
  onDeleteSession: (s: SessionCardData) => void
}) {
  const [confirm, setConfirm] = useState<SessionCardData | null>(null)
  const sessions = (Array.isArray(rows) ? rows : []).map(cardOf)
  const grade = plan.className || ''
  const subject = plan.subjectName || ''
  const title = plan.title || 'Lesson Plan'

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4 animate-fade-up">
        <div>
          <button type="button" onClick={onBack}
            className="mb-3 inline-flex cursor-pointer items-center gap-1.5 rounded-lg text-sm font-medium text-ink-500 transition-colors hover:text-brand-600">
            <ArrowLeft className="h-4 w-4" />Back to Repository
          </button>
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-purple-600 to-purple-800 text-white shadow-[0_6px_14px_-6px_rgb(107_33_168/.55)]">
              <BookOpen className="h-5 w-5" />
            </span>
            <div>
              <h1 className="font-display text-3xl font-bold">Session <span className="text-gradient">Manager</span></h1>
              <p className="mt-1 text-sm text-ink-300">Organize &amp; plan individual learning sessions</p>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-fg">{grade}</div>
          <div className="text-[13px] text-ink-500">{subject}</div>
        </div>
      </header>

      {/* Lesson plan summary */}
      <div className="glass flex flex-wrap items-start justify-between gap-4 rounded-2xl p-5">
        <div className="min-w-0">
          <h2 className="mb-1 font-display text-[23px] font-bold text-fg">{title}</h2>
          <p className="mb-3 text-[13.5px] text-ink-500">Manage sessions for this lesson plan</p>
          <div className="flex flex-wrap gap-4">
            <Meta icon={<BookOpen />}>{total || 0} Session{(total || 0) === 1 ? '' : 's'}</Meta>
            {grade && <Meta icon={<Users />}>{grade}</Meta>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
            <Input aria-label="Search sessions" placeholder="Search sessions…" value={search} onChange={(e) => onSearch(e.target.value)}
              className="w-[230px] max-w-full pl-9" />
          </div>
          <Button id="create-session" onClick={onCreate}><Plus className="h-4 w-4" />Create Session</Button>
        </div>
      </div>

      {loading ? (
        <div className="glass rounded-2xl px-6 py-12 text-center">
          <Loader2 className="mx-auto mb-3.5 h-8 w-8 animate-spin text-brand-500" />
          <p className="text-[13.5px] text-ink-500">Loading sessions…</p>
        </div>
      ) : error ? (
        // Calm, not alarming — but NOT dressed up as an empty list: "no sessions" when the server never
        // answered would say something untrue about the teacher's own lesson plan.
        <StateCard icon={<TriangleAlert />} iconClass="bg-warn/12 text-warn" title="We couldn’t reach your sessions"
          action={<Button variant="secondary" onClick={onRetry}>Try again</Button>}>{error}</StateCard>
      ) : sessions.length === 0 && search ? (
        <StateCard icon={<Search />} iconClass="bg-ink-800 text-ink-500" title={`No sessions match “${search}”`}
          action={<Button variant="secondary" onClick={() => onSearch('')}>Clear search</Button>}>
          Try a different title, or clear the search to see every session in this lesson plan.
        </StateCard>
      ) : sessions.length === 0 ? (
        // The real empty state — the Create Session action already sits in the summary card above.
        <StateCard icon={<BookOpen />} iconClass="bg-gradient-to-br from-purple-600 to-purple-800 text-white shadow-[0_12px_24px_-14px_rgb(107_33_168/.6)]"
          title="No sessions created yet">Use Create Session to add the first one.</StateCard>
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {sessions.map((s) => <SessionCard key={s.id} session={s}
              onPlan={() => onPlanSession(s)} onPreview={() => onPreviewSession(s)} onDelete={() => setConfirm(s)} />)}
          </div>
          {/* `total > 0`, not `total > pageSize`: the Pager decides for itself whether it has anything to show,
              and keeps its size selector reachable once the list is longer than the smallest page size. */}
          {total > 0 && <Pager page={page} size={pageSize} total={total} onPage={onPageChange} onSize={onPageSize} />}
        </>
      )}

      {confirm && (
        <ConfirmDialog title="Delete this session?" confirmLabel="Delete session" onClose={() => setConfirm(null)}
          onConfirm={() => { const x = confirm; setConfirm(null); onDeleteSession(x) }}
          message={<><b className="font-semibold text-fg">{confirm.title}</b> and the resources picked for it will be removed from this lesson plan. The lesson plan itself is not changed.</>} />
      )}
    </div>
  )
}
