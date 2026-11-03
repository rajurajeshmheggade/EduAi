import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readAloudService, type ReadAloudPage, type ReadMode } from '@/services/readAloudService'
import { useReadAloud } from './useReadAloud'

vi.mock('wawa-lipsync', () => ({
  Lipsync: class { viseme = 'viseme_sil'; features = null; connectAudio = vi.fn(); processAudio = vi.fn() },
}))
vi.mock('@/services/readAloudService', () => ({
  readAloudService: { voice: vi.fn(), page: vi.fn(), audio: vi.fn(), prepare: vi.fn(), status: vi.fn() },
}))

const svc = vi.mocked(readAloudService)
const TOTAL = 9
const script = (p: number, mode: ReadMode = 'explain'): ReadAloudPage => ({
  page: p, total_pages: TOTAL, mode, engine: 'azure-gpt-4o', lesson: null, version: `v${p}`,
  segments: [{ index: 0, text: `Page ${p}, part one.` }, { index: 1, text: `Page ${p}, part two.` }],
})
/** A request that only ends when it is aborted (an AI explanation still being written). */
const pending = (signal?: AbortSignal) => new Promise<never>((_, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted'))))

const pagesAsked = () => svc.page.mock.calls.map(([, p, , o]) => `${p}${o?.prefetch ? ' (ahead)' : ''}`)
const clipsAsked = () => svc.audio.mock.calls.map(([, p, i, , o]) => `${p}#${i}@${o?.version}`)

describe('useReadAloud prefetching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    URL.createObjectURL = vi.fn(() => `blob:clip-${Math.random()}`)
    URL.revokeObjectURL = vi.fn()
    svc.voice.mockResolvedValue({ teacher: { name: 'Raju', gender: 'male' }, voice: 'male', engine: 'Neural voice (offline)' })
    svc.prepare.mockImplementation(async (_id, p) => ({ page: p, mode: 'explain', pages: [
      { page: p, status: 'preparing', script: 'preparing', audio: 'queued', engine: null, fallback: false },
      { page: p + 1, status: 'queued', script: 'queued', audio: 'queued', engine: null, fallback: false }] }))
    svc.page.mockImplementation(async (_id, p, mode) => script(p, mode))
    svc.audio.mockImplementation(async () => new Blob(['x'], { type: 'audio/mpeg' }))
  })

  it('prepares the open page and the next one while the tutor is idle, so playing needs no new request', async () => {
    const { result } = renderHook(() => useReadAloud('tb1', () => {}, 3))
    await waitFor(() => expect(result.current.ready).toEqual({ book: 'tb1', mode: 'explain', page: 3, status: 'ready', next: { page: 4, status: 'ready' } }))
    expect(svc.prepare).toHaveBeenCalledWith('tb1', 3, 'explain', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(pagesAsked()).toEqual(['3', '4 (ahead)'])               // next page fetched ahead: server pipeline stays on 3
    expect(clipsAsked()).toEqual(['3#0@v3', '4#0@v4'])              // each first part, for that script version

    act(() => result.current.start(3))
    await waitFor(() => expect(result.current.status).toBe('playing'))
    expect(result.current.text).toBe('Page 3, part one.')
    expect(pagesAsked()).toEqual(['3', '4 (ahead)'])               // already here: nothing fetched again
    expect(clipsAsked()).toEqual(['3#0@v3', '4#0@v4', '3#1@v3'])   // only the next part is prefetched
  })

  it('waits for the student to settle on a page before preparing it', async () => {
    const { rerender } = renderHook(({ page }) => useReadAloud('tb1', () => {}, page), { initialProps: { page: 1 } })
    for (const page of [2, 3, 4, 5]) rerender({ page })            // flipping through quickly
    await waitFor(() => expect(svc.prepare).toHaveBeenCalled())
    await waitFor(() => expect(pagesAsked()).toEqual(['5', '6 (ahead)']))
    expect(svc.prepare.mock.calls.map(([, p]) => p)).toEqual([5])
  })

  it('cancels unfinished requests for the pages left behind when the student jumps', async () => {
    const signals = new Map<number, AbortSignal>()
    svc.page.mockImplementation(async (_id, p, mode, o) => {
      if (p === 2) { signals.set(p, o!.signal!); return pending(o?.signal) }   // page 2's lesson is still being written
      return script(p, mode)
    })
    const { result, rerender } = renderHook(({ page }) => useReadAloud('tb1', () => {}, page), { initialProps: { page: 1 } })
    await waitFor(() => expect(signals.has(2)).toBe(true))
    await waitFor(() => expect(result.current.ready?.next).toEqual({ page: 2, status: 'preparing' }))

    rerender({ page: 7 })                                           // jump to chapter 2
    await waitFor(() => expect(signals.get(2)!.aborted).toBe(true))
    await waitFor(() => expect(result.current.ready).toMatchObject({ page: 7, status: 'ready', next: { page: 8, status: 'ready' } }))
    expect(svc.prepare.mock.calls.map(([, p]) => p)).toEqual([1, 7])
    expect(pagesAsked()).toEqual(['1', '2 (ahead)', '7', '8 (ahead)'])
  })

  it('keeps a bounded number of clips and frees the ones it drops', async () => {
    const { rerender } = renderHook(({ page }) => useReadAloud('tb1', () => {}, page), { initialProps: { page: 1 } })
    for (let page = 1; page <= TOTAL; page++) {
      rerender({ page })
      await waitFor(() => expect(svc.audio.mock.calls.some(([, p]) => p === Math.min(page + 1, TOTAL))).toBe(true))
    }
    expect(URL.revokeObjectURL).toHaveBeenCalled()                 // older pages' audio was released
    expect(vi.mocked(URL.createObjectURL).mock.calls.length - vi.mocked(URL.revokeObjectURL).mock.calls.length).toBeLessThanOrEqual(8)
  })
})
