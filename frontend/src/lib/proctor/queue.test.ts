import { describe, expect, it, vi } from 'vitest'
import { AnswerQueue, MemoryStore } from './answerQueue'
import { EventTransport } from './transport'

const net = () => Object.assign(new Error('Network Error'), { response: undefined })
const http = (status: number, detail = 'bad') => Object.assign(new Error('HTTP'), { response: { status, data: { detail } } })

describe('AnswerQueue (autosave + offline)', () => {
  it('debounces, keeps answers while offline and syncs them in order on reconnect', async () => {
    vi.useFakeTimers()
    const sent: string[] = []
    let online = false
    const store = new MemoryStore()
    const q = new AnswerQueue('s1', async (qid, a) => { if (!online) throw net(); sent.push(`${qid}=${JSON.stringify(a)}`) }, store, 800)
    q.change('q1', { option: 1 }, 1000)
    q.change('q2', { text: 'hi' }, 500)
    q.change('q1', { option: 2 }, 300)                    // latest wins, time accumulates
    await vi.advanceTimersByTimeAsync(900)
    expect(q.offline).toBe(true)
    expect(store.rows.size).toBe(2)                      // persisted for a reload
    online = true
    await q.flush()
    expect(sent).toEqual(['q2={"text":"hi"}', 'q1={"option":2}'])
    expect(q.size).toBe(0)
    expect(store.rows.size).toBe(0)
    vi.useRealTimers()
  })

  it('restores answers left by an earlier page and drops answers the server rejects', async () => {
    const store = new MemoryStore()
    await store.put({ session: 's2', question_id: 'q9', answer: { value: '6' }, time_ms: 10, changed: 1 })
    const send = vi.fn().mockRejectedValueOnce(http(422, 'Choose one of the options')).mockResolvedValue({})
    const q = new AnswerQueue('s2', send, store, 10)
    const rows = await q.restore()
    expect(rows).toHaveLength(1)
    await q.flush()
    expect(q.error).toBe('Choose one of the options')
    expect(q.size).toBe(0)
  })
})

describe('EventTransport', () => {
  it('batches, flushes urgent events at once, retries with the same seq and uploads evidence after the ack', async () => {
    let seq = 0
    const batches: number[][] = []
    let fail = true
    const upload = vi.fn().mockResolvedValue({})
    const onStatus = vi.fn()
    const t = new EventTransport({
      nextSeq: () => ++seq,
      send: async (evs) => { batches.push(evs.map((e) => e.seq)); if (fail) throw net(); return { accepted: evs.map((e) => e.seq), status: 'IN_PROGRESS', warnings_count: 1, max_warnings: 5, ended: false, locked: false, submit_reason: null, deadline_at: null, server_time: '' } },
      upload, onStatus,
    }, 5000, 20)
    t.emit({ code: 'COPY_PASTE', at: 0, duration_ms: 0 })
    expect(batches).toHaveLength(0)                      // not urgent: waits for the batch
    const blob = new Blob(['x'], { type: 'image/jpeg' })
    t.emit({ code: 'TAB_HIDDEN', at: 1, duration_ms: 9000 }, { urgent: true, evidence: { blob, kind: 'webcam' } })
    await t.flush()
    expect(batches[0]).toEqual([1, 2])
    expect(upload).not.toHaveBeenCalled()               // failed: kept
    fail = false
    await t.flush()
    expect(batches[1]).toEqual([1, 2])                  // retried with the same seq
    expect(upload).toHaveBeenCalledWith(blob, 'webcam', 2)
    expect(onStatus).toHaveBeenCalledTimes(1)
    expect(t.pending).toBe(0)
  })
})
