/**
 * Event transport: batches flag events every 5 s or 20 events (at once for anything that warns or pauses), retries
 * with the same seq (the server is idempotent by seq), then uploads each event's evidence snapshot once the event is
 * stored. The server's reply (warnings, ended) is passed back to the exam view.
 */
import type { FlagEvent } from './rules'
import type { StatusInfo, WireEvent } from './examApi'

export interface QueuedEvent { wire: WireEvent; evidence?: { blob: Blob; kind: 'webcam' | 'screen' } }

export interface TransportDeps {
  nextSeq: () => number
  send: (events: WireEvent[]) => Promise<StatusInfo & { accepted: number[] }>
  upload: (blob: Blob, kind: 'webcam' | 'screen', seq: number) => Promise<unknown>
  onStatus: (s: StatusInfo, sent: WireEvent[]) => void
}

export class EventTransport {
  private queue: QueuedEvent[] = []
  private sending: Promise<void> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly deps: TransportDeps
  readonly batchMs: number
  readonly batchSize: number

  constructor(deps: TransportDeps, batchMs = 5000, batchSize = 20) {
    this.deps = deps
    this.batchMs = batchMs
    this.batchSize = batchSize
  }

  start() { this.timer ??= setInterval(() => void this.flush(), this.batchMs) }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null }
  get pending() { return this.queue.length }

  /** Queue one event; urgent events (warnings, pauses) are sent at once. Returns the seq used. */
  emit(ev: FlagEvent, opts: { urgent?: boolean; evidence?: QueuedEvent['evidence'] } = {}): number {
    const seq = this.deps.nextSeq()
    this.queue.push({ wire: { seq, code: ev.code, client_ts: new Date(ev.at).toISOString(), duration_ms: Math.round(ev.duration_ms),
      confidence: ev.confidence, details: ev.details }, evidence: opts.evidence })
    if (opts.urgent || this.queue.length >= this.batchSize) void this.flush()
    return seq
  }

  /** Attach evidence captured a moment after the event was queued (e.g. after a screen grab resolves). */
  attach(seq: number, evidence: NonNullable<QueuedEvent['evidence']>) {
    const q = this.queue.find((x) => x.wire.seq === seq)
    if (q) q.evidence = evidence
    else void this.deps.upload(evidence.blob, evidence.kind, seq).catch(() => {})
  }

  flush(): Promise<void> {
    this.sending ??= this.run().finally(() => { this.sending = null })
    return this.sending
  }

  private async run() {
    while (this.queue.length) {
      const batch = this.queue.slice(0, 50)
      let res: StatusInfo & { accepted: number[] }
      try {
        res = await this.deps.send(batch.map((b) => b.wire))
      } catch (e) {
        const status = (e as { response?: { status?: number } })?.response?.status
        if (status === 422) this.queue = this.queue.slice(batch.length)   // malformed batch: drop rather than loop
        return                                                            // network / 429 / 5xx: retry on the next tick
      }
      this.queue = this.queue.slice(batch.length)
      const accepted = new Set(res.accepted)
      for (const b of batch) {
        if (b.evidence && accepted.has(b.wire.seq)) void this.deps.upload(b.evidence.blob, b.evidence.kind, b.wire.seq).catch(() => {})
      }
      this.deps.onStatus(res, batch.map((b) => b.wire))
      if (res.ended) { this.queue = []; return }
    }
  }
}
