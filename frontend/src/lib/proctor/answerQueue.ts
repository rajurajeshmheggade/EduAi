/**
 * Autosave with an offline queue. Each answer is saved 800 ms after the last change; while offline (or when a save
 * fails on the network) pending answers are kept — in IndexedDB in the browser — and synced in order on reconnect.
 * The latest answer per question wins; time spent accumulates.
 */
import type { ExamAnswer } from './examApi'

export interface Pending { session: string; question_id: string; answer: ExamAnswer | null; time_ms: number; changed: number }

export interface QueueStore {
  load(session: string): Promise<Pending[]>
  put(p: Pending): Promise<void>
  remove(session: string, questionId: string): Promise<void>
}

export class MemoryStore implements QueueStore {
  rows = new Map<string, Pending>()
  async load(session: string) { return [...this.rows.values()].filter((p) => p.session === session) }
  async put(p: Pending) { this.rows.set(`${p.session}:${p.question_id}`, { ...p }) }
  async remove(session: string, q: string) { this.rows.delete(`${session}:${q}`) }
}

export class IdbStore implements QueueStore {
  private db: Promise<IDBDatabase>
  constructor() {
    this.db = new Promise((resolve, reject) => {
      const r = indexedDB.open('eduai-exam', 1)
      r.onupgradeneeded = () => r.result.createObjectStore('answers')
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
  }
  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db
    return new Promise((resolve, reject) => {
      const req = fn(db.transaction('answers', mode).objectStore('answers'))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  async load(session: string) {
    const all = (await this.tx('readonly', (s) => s.getAll())) as Pending[]
    return all.filter((p) => p.session === session)
  }
  async put(p: Pending) { await this.tx('readwrite', (s) => s.put(p, `${p.session}:${p.question_id}`)) }
  async remove(session: string, q: string) { await this.tx('readwrite', (s) => s.delete(`${session}:${q}`)) }
}

export const defaultStore = (): QueueStore => (typeof indexedDB === 'undefined' ? new MemoryStore() : new IdbStore())

type Send = (questionId: string, answer: ExamAnswer | null, timeMs: number) => Promise<unknown>
type Outcome = 'saved' | 'offline' | 'rejected'

const isNetworkError = (e: unknown) => {
  const r = (e as { response?: { status?: number } })?.response
  return !r || !r.status || r.status >= 500 || r.status === 429
}

export class AnswerQueue {
  private pending = new Map<string, Pending>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private flushing: Promise<void> | null = null
  private last = 0
  readonly session: string
  private readonly send: Send
  private readonly store: QueueStore
  private readonly debounceMs: number
  onChange: (state: { pending: number; offline: boolean; error: string | null }) => void = () => {}
  offline = false
  error: string | null = null

  constructor(session: string, send: Send, store: QueueStore = defaultStore(), debounceMs = 800) {
    this.session = session
    this.send = send
    this.store = store
    this.debounceMs = debounceMs
  }

  /** Answers left unsaved by an earlier page (reload while offline). */
  async restore(): Promise<Pending[]> {
    const rows = await this.store.load(this.session).catch(() => [])
    rows.forEach((p) => { this.pending.set(p.question_id, p); this.last = Math.max(this.last, p.changed) })
    if (rows.length) void this.flush()
    return rows
  }

  get size() { return this.pending.size }

  change(questionId: string, answer: ExamAnswer | null, timeMs: number) {
    const prev = this.pending.get(questionId)
    this.last = Math.max(Date.now(), this.last + 1)        // strictly increasing: sync order = change order
    const p: Pending = { session: this.session, question_id: questionId, answer, time_ms: (prev?.time_ms ?? 0) + timeMs, changed: this.last }
    this.pending.set(questionId, p)
    void this.store.put(p).catch(() => {})
    clearTimeout(this.timers.get(questionId))
    this.timers.set(questionId, setTimeout(() => void this.flush(), this.debounceMs))
    this.emit()
  }

  /** Sends everything pending, oldest change first. Stops at the first network failure (kept for later). */
  flush(): Promise<void> {
    this.flushing ??= this.run().finally(() => { this.flushing = null })
    return this.flushing
  }

  private async run() {
    for (const p of [...this.pending.values()].sort((a, b) => a.changed - b.changed)) {
      const outcome = await this.sendOne(p)
      if (outcome === 'offline') { this.offline = true; this.emit(); return }
    }
    this.offline = false
    this.emit()
  }

  private async sendOne(p: Pending): Promise<Outcome> {
    try {
      await this.send(p.question_id, p.answer, p.time_ms)
    } catch (e) {
      if (isNetworkError(e)) return 'offline'
      this.error = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'An answer could not be saved'
      this.drop(p)
      return 'rejected'
    }
    this.drop(p)
    this.error = null
    return 'saved'
  }

  private drop(p: Pending) {
    const cur = this.pending.get(p.question_id)
    if (!cur) return
    if (cur.changed === p.changed) {
      this.pending.delete(p.question_id)
      void this.store.remove(this.session, p.question_id).catch(() => {})
    } else {                                     // a newer change made meanwhile stays queued, minus the time just sent
      cur.time_ms = Math.max(0, cur.time_ms - p.time_ms)
      void this.store.put(cur).catch(() => {})
    }
  }

  private emit() { this.onChange({ pending: this.pending.size, offline: this.offline, error: this.error }) }
}
