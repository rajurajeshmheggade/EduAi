/**
 * Bounded cache of requests (least recently used goes first), for prefetching: asking twice for one key shares one
 * request, every entry has its own AbortController, and `retain` cancels unfinished requests the user no longer
 * needs (they jumped to another page). Failed or aborted requests are dropped so the next ask tries again.
 */
export class RequestCache<T> {
  private entries = new Map<string, { promise: Promise<T>; ctl: AbortController; settled: boolean }>()
  private max: number
  private onEvict?: (value: T) => void

  /** `onEvict` releases what a finished entry holds (e.g. revokes an object URL). */
  constructor(max: number, onEvict?: (value: T) => void) {
    this.max = max
    this.onEvict = onEvict
  }

  get(key: string, load: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const hit = this.entries.get(key)
    if (hit) {
      this.entries.delete(key)
      this.entries.set(key, hit)                 // most recently used
      return hit.promise
    }
    const ctl = new AbortController()
    const entry = { promise: load(ctl.signal), ctl, settled: false }
    entry.promise.then(() => { entry.settled = true }, () => { if (this.entries.get(key) === entry) this.entries.delete(key) })
    this.entries.set(key, entry)
    while (this.entries.size > this.max) this.evict(this.entries.keys().next().value!)
    return entry.promise
  }

  /** Finished successfully and still cached. */
  ready(key: string): boolean {
    return !!this.entries.get(key)?.settled
  }

  /** Cancels and forgets unfinished requests whose key `keep` rejects; finished ones stay (bounded anyway). */
  retain(keep: (key: string) => boolean): void {
    for (const [key, e] of [...this.entries]) if (!e.settled && !keep(key)) this.evict(key)
  }

  delete(key: string): void {
    if (this.entries.has(key)) this.evict(key)
  }

  clear(): void {
    for (const key of [...this.entries.keys()]) this.evict(key)
  }

  get size(): number {
    return this.entries.size
  }

  private evict(key: string): void {
    const e = this.entries.get(key)
    if (!e) return
    this.entries.delete(key)
    if (e.settled) {
      if (this.onEvict) void e.promise.then(this.onEvict, () => {})
    } else {
      e.ctl.abort()
      if (this.onEvict) void e.promise.then(this.onEvict, () => {})   // a request that ignored the abort
    }
  }
}
