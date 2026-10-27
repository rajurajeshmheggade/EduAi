/* Launch — opens the session player window and feeds it (the launch half of Rapid's SessionResources.jsx).

   The window plays files itself (video, audio, image, PDF, Office, links) from their signed urls. What it
   cannot do is call the API — it is a document.write'd popup with no bearer token — so the three rows that
   are not files (a Test, a Question, an Activity) are read HERE and pushed into it as they arrive. The server
   already answers in the window's wire shape; this side only re-sanitises it, because the popup is
   same-origin with the app and renders those HTML fields raw. */
import { STAGES } from '@/components/lesson-plan/data'
import { toast } from '@/components/ui/toast'
import { httpStatus, sessionErrorMessage, sessionPlanService } from '@/services/lessonPlanService'
import type { LaunchContent, SourceKind, WireQuestion } from '@/types/lessonPlan'
import type { PickedResource, ResourcesValue } from '../resourcesModel'
import { sanitizeHtml } from '../sanitizeHtml'
import { openSessionWindow, type LaunchFile, type LaunchPayload, type LaunchWindow } from '../sessionLaunch'
import { fileKind, thumbKind } from './kinds'

type ContentKind = Extract<SourceKind, 'test' | 'question' | 'activity'>
const contentKind = (k: SourceKind): ContentKind | null => (k === 'test' || k === 'question' || k === 'activity' ? k : null)

/** The totals and stage lists the Preview header and the window both use. */
export function sessionStats(v: ResourcesValue) {
  const files = (s: string) => v.stages[s]?.files ?? []
  return {
    // Stages that go into the launch payload — a stage's description is content of its own on the Lesson plan tab.
    prevStages: STAGES.filter((s) => files(s).length > 0 || !!v.stages[s]?.desc),
    // Stages the Preview lists — only those that actually carry resources.
    prevResStages: STAGES.filter((s) => files(s).length > 0),
    totalAssets: STAGES.reduce((n, s) => n + files(s).length, 0),
    totalMins: STAGES.reduce((n, s) => n + (parseInt(v.stages[s]?.duration ?? '', 10) || 0), 0) || (parseInt(v.duration, 10) || 0),
  }
}

/** The flat asset index the window numbers `id` (in `stage`) with. */
export function flatIndex(v: ResourcesValue, stage: string, id: string): number {
  let n = 0
  for (const sg of sessionStats(v).prevStages) {
    for (const f of v.stages[sg]?.files ?? []) {
      if (sg === stage && f.id === id) return n
      n++
    }
  }
  return 0
}

function launchFile(r: PickedResource): LaunchFile {
  const k = contentKind(r.sourceKind)
  return {
    name: r.name,
    label: fileKind(r.name, r.type).label,
    kind: thumbKind(r.name, r.type),
    url: r.url || '',
    meta: r.meta || '',
    resourceType: r.resourceType || '',
    source: k ?? 'resource',
  }
}

function payload(v: ResourcesValue, startIndex: number): LaunchPayload {
  const { prevStages, totalAssets, totalMins } = sessionStats(v)
  return {
    name: v.name || '',
    logoSrc: new URL('/favicon.svg', window.location.origin).href,
    totalAssets, totalMins, startIndex,
    stages: prevStages.map((s) => ({
      stage: s,
      // Rendered raw on the window's Lesson plan tab, so only the allow-listed formatting goes in.
      desc: sanitizeHtml(v.stages[s]?.desc ?? ''),
      setting: v.stages[s]?.setting ?? '',
      files: (v.stages[s]?.files ?? []).map(launchFile),
    })),
  }
}

// ── re-sanitising what the server pushes ─────────────────────────────────────────────────────────────
const arr = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : [])
const str = (x: unknown) => (typeof x === 'string' ? x : x == null ? '' : String(x))

/** Server text is html-escaped with <br> for newlines; the activity brief is drawn by the window as TEXT. */
const toText = (s: unknown) => str(s).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&')

function cleanQuestion(q: WireQuestion, n: number): WireQuestion {
  return {
    n: Number(q.n) || n,
    type: str(q.type) || 'Question',
    section: str(q.section),
    marks: Number(q.marks) || 0,
    html: sanitizeHtml(q.html),
    options: arr<WireQuestion['options'][number]>(q.options).map((o) => ({ html: sanitizeHtml(o?.html), correct: !!o?.correct })),
    statements: arr<WireQuestion['statements'][number]>(q.statements).map((s) => ({ html: sanitizeHtml(s?.html), answer: !!s?.answer })),
    pairs: arr<WireQuestion['pairs'][number]>(q.pairs).map((p) => ({ left: sanitizeHtml(p?.left), right: sanitizeHtml(p?.right) })),
    ar: arr<WireQuestion['ar'][number]>(q.ar).map((a) => ({ assertion: sanitizeHtml(a?.assertion), reason: sanitizeHtml(a?.reason), answer: str(a?.answer) || 'A' })),
    blanks: arr<unknown>(q.blanks).map(str),
    answer: str(q.answer),
    hint: str(q.hint),
  }
}

function cleanContent(d: unknown): LaunchContent {
  const c = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>
  const common = { title: str(c.title), meta: str(c.meta) }
  if (c.mode === 'test') {
    return { mode: 'test', ...common, paper: arr<WireQuestion>(c.paper).filter(Boolean).map((q, i) => cleanQuestion(q, i + 1)),
      arOptions: arr<unknown>(c.arOptions).map(str), arInstruction: str(c.arInstruction), key: c.key === true }
  }
  if (c.mode === 'question') {
    return { mode: 'question', ...common, html: sanitizeHtml(c.html), q: c.q && typeof c.q === 'object' ? cleanQuestion(c.q as WireQuestion, 1) : null,
      arOptions: arr<unknown>(c.arOptions).map(str), arInstruction: str(c.arInstruction), key: c.key === true }
  }
  if (c.mode === 'activity') {
    return { mode: 'activity', ...common, desc: toText(c.desc),
      files: arr<Record<string, unknown>>(c.files).filter(Boolean).map((f) => ({ title: str(f.title), type: str(f.type), url: str(f.url) })) }
  }
  return { mode: 'error', message: str(c.message) || 'This could not be loaded.' }
}

/** Reads every Test / Question / Activity of the session and pushes it into the window, in the flat order
 *  the window numbers its assets. Always ends in a payload — never leaves a stage spinning. */
function feedWindow(w: LaunchWindow, v: ResourcesValue) {
  const pending: { index: number; kind: ContentKind; row: PickedResource }[] = []
  let n = 0
  sessionStats(v).prevStages.forEach((sg) => {
    (v.stages[sg]?.files ?? []).forEach((f) => {
      const k = contentKind(f.sourceKind)
      if (k) pending.push({ index: n, kind: k, row: f })
      n += 1
    })
  })
  if (!pending.length) return

  // Delivery waits for the window; the READ does not. The popup's inline script may not have run yet when
  // the named window is being reused, so the push retries for up to ~10s.
  const deliver = (index: number, data: LaunchContent, tries: number) => {
    if (w.closed) return
    if (typeof w.__pushContent === 'function') { w.__pushContent(index, data); return }
    if (tries >= 100) { console.error(`[session] launch window never exposed __pushContent; giving up on asset ${index}`); return }
    window.setTimeout(() => deliver(index, data, tries + 1), 100)
  }

  pending.forEach(({ index, kind, row }) => {
    let settled = false
    const push = (data: LaunchContent) => { if (settled || w.closed) return; settled = true; deliver(index, data, 0) }
    window.setTimeout(() => push({ mode: 'error', message: 'This took too long to load. Check your connection, then reopen the session.' }), 20000)
    if (!row.resourceId) {
      push({ mode: 'error', message: 'This resource was saved without a repository link, so its content cannot be looked up.' })
      return
    }
    sessionPlanService.resourceContent(kind, row.resourceId)
      .then((d) => push(cleanContent(d)))
      .catch((e: unknown) => {
        console.error(`[session] resource-content failed for ${kind} #${row.resourceId}`, e)
        const s = httpStatus(e)
        push({
          mode: 'error',
          message: s === 404 ? 'This is no longer in the repository, so it cannot be shown.'
            : s === 403 ? 'You no longer have access to this.'
              : s === 400 ? 'This resource was saved without a repository link, so its content cannot be looked up.'
                : sessionErrorMessage(e, 'This could not be loaded.'),
        })
      })
  })
}

/** Open the player on asset `startIndex` and start feeding it. */
export function launchSession(v: ResourcesValue, startIndex = 0) {
  const w = openSessionWindow(payload(v, startIndex))
  if (!w) { toast('Your browser blocked the session window. Allow pop-ups for this site and try again.', 'error'); return }
  feedWindow(w, v)
}
