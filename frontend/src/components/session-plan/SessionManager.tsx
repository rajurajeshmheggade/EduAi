import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '@/components/ui/toast'
import { sessionErrorMessage, sessionPlanService, sessionReadError } from '@/services/lessonPlanService'
import type { LessonPlanRow, SessionRow } from '@/types/lessonPlan'
import { CreateSession } from './CreateSession'
import { resourcesFromSession } from './resourcesModel'
import { SessionList, type SessionCardData } from './SessionList'
import { SessionPlanScreen } from './SessionPlanScreen'
import { SessionResources } from './SessionResources'

/* Lesson Plan ▸ Session Manager — the session half of Rapid's LessonPlanTool.jsx. Sessions are DB rows, so the
   list is server state: server-paginated and server-searched, never assembled in the browser.

     list    → SessionList (Plan / Preview / Delete, search, pager)
     create  → CreateSession, which replaces the list in place; after a create the generated plan opens
     plan    → SessionPlanScreen, replacing the list in place (Back returns to it)
     preview → the Session Resources Preview modal, seeded from the saved row, over the list */

interface ListState {
  rows: SessionRow[]
  total: number
  page: number
  pageSize: number
  search: string
  loading: boolean
  error: string
}

const PAGE_SIZE = 9   // a 3-up grid

export function SessionManager({ plan, onBack, onChanged }: {
  plan: LessonPlanRow
  onBack: () => void
  onChanged: () => void
}) {
  const [state, setState] = useState<ListState>({ rows: [], total: 0, page: 1, pageSize: PAGE_SIZE, search: '', loading: true, error: '' })
  const [creating, setCreating] = useState(false)
  const [planSession, setPlanSession] = useState<SessionRow | null>(null)
  const [previewSession, setPreviewSession] = useState<SessionRow | null>(null)
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])
  const seq = useRef(0)
  const searchTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(searchTimer.current), [])

  // Only the newest request may write the list, so a slow earlier page or search can never overwrite it.
  const loadSessions = useCallback((page = 1, search = '', pageSize?: number) => {
    const size = pageSize ?? stateRef.current.pageSize
    const my = ++seq.current
    setState((s) => ({ ...s, loading: true, error: '', page, pageSize: size, search }))
    const fetchPage = (p: number) => {
      sessionPlanService.listSessions({ lessonPlanId: plan.id, search: search || undefined, page: p, pageSize: size })
        .then((res) => {
          if (my !== seq.current) return
          const rows = Array.isArray(res?.sessions) ? res.sessions : []
          const total = Number(res?.total) || 0
          // A page emptied by a delete steps back to the last page that exists instead of claiming "no sessions".
          const last = Math.max(1, Math.ceil(total / size))
          if (!rows.length && total > 0 && last < p) { setState((s) => ({ ...s, page: last })); fetchPage(last); return }
          setState((s) => ({ ...s, rows, total, loading: false, error: '' }))
        })
        .catch((e: unknown) => {
          if (my !== seq.current) return
          // A 404 on the collection is "nothing here yet" (sessionReadError → ''), i.e. the empty state.
          setState((s) => ({ ...s, rows: [], total: 0, loading: false, error: sessionReadError(e) }))
        })
    }
    fetchPage(page)
  }, [plan.id])

  // Fetch whenever the Session Manager opens on a plan (and again if the plan is swapped).
  useEffect(() => { loadSessions(1, '') }, [loadSessions])

  const onSearch = (q: string) => {
    setState((s) => ({ ...s, search: q }))
    window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => loadSessions(1, q), q ? 250 : 0)
  }

  const onDelete = (sn: SessionCardData) => {
    const t = sn.title || 'Session'
    const clipped = t.length > 48 ? `${t.slice(0, 48).trimEnd()}…` : t
    // Optimistic removal, reverted by the reload if the server refuses.
    setState((s) => ({ ...s, rows: s.rows.filter((r) => r.id !== sn.id), total: Math.max(0, s.total - 1) }))
    if (previewSession?.id === sn.id) setPreviewSession(null)
    sessionPlanService.deleteSession(sn.id)
      .then(() => { toast(`“${clipped}” deleted.`, 'success'); onChanged() })
      .catch((e: unknown) => toast(sessionErrorMessage(e, 'The session could not be deleted.'), 'error'))
      .finally(() => { const cur = stateRef.current; loadSessions(cur.page, cur.search) })
  }

  // The Preview IS the Session Resources preview — stage tabs, asset tiles and Launch — seeded from the row.
  const previewValue = useMemo(() => (previewSession ? resourcesFromSession(plan, previewSession) : null), [plan, previewSession])

  if (creating) {
    return (
      <CreateSession plan={plan} onBack={() => setCreating(false)}
        // After a create, go straight to the generated Session Plan — that is what the teacher just waited for.
        // The row is re-read so the Plan screen renders exactly what was stored, not the POST echo.
        onCreated={(res) => {
          setCreating(false)
          loadSessions(1, stateRef.current.search)
          onChanged()
          const id = res?.id
          if (!id) return
          sessionPlanService.getSession(id)
            .then((row) => { if (row) setPlanSession(row) })
            .catch(() => { /* the list already refreshed; the card is there to open */ })
        }} />
    )
  }

  if (planSession) {
    return <SessionPlanScreen plan={plan} session={planSession} onBack={() => setPlanSession(null)} />
  }

  return (
    <>
      <SessionList plan={plan}
        rows={state.rows} total={state.total} page={state.page} pageSize={state.pageSize}
        loading={state.loading} error={state.error} search={state.search}
        onSearch={onSearch}
        onPageChange={(n) => loadSessions(n, state.search)}
        onPageSize={(n) => loadSessions(1, state.search, n)}
        onRetry={() => loadSessions(state.page, state.search)}
        onBack={onBack}
        onCreate={() => setCreating(true)}
        onPlanSession={(sn) => setPlanSession(sn.raw)}
        onPreviewSession={(sn) => setPreviewSession(sn.raw)}
        onDeleteSession={onDelete} />
      {previewSession && previewValue && (
        <SessionResources plan={plan} previewOnly value={previewValue} onChange={() => { /* read-only */ }}
          objectives={Array.isArray(previewSession.elos) ? previewSession.elos : []}
          onClosePreview={() => setPreviewSession(null)} />
      )}
    </>
  )
}
