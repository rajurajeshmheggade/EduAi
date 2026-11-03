import { describe, expect, it, vi } from 'vitest'
import { RequestCache } from './requestCache'

const hanging = (signal: AbortSignal) => new Promise<string>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))

describe('RequestCache', () => {
  it('shares one request per key and evicts the least recently used', async () => {
    const evicted = vi.fn()
    const cache = new RequestCache<string>(2, evicted)
    const load = vi.fn(async (_s: AbortSignal) => 'page')
    await Promise.all([cache.get('1', load), cache.get('1', load)])
    expect(load).toHaveBeenCalledTimes(1)
    await cache.get('2', async () => 'two')
    await cache.get('1', load)                                   // 1 is now the most recently used
    await cache.get('3', async () => 'three')
    expect(cache.size).toBe(2)
    expect(cache.ready('2')).toBe(false)
    expect(cache.ready('1') && cache.ready('3')).toBe(true)
    await vi.waitFor(() => expect(evicted).toHaveBeenCalledWith('two'))
  })

  it('cancels unfinished requests the reader left behind and keeps finished ones', async () => {
    const cache = new RequestCache<string>(10)
    await cache.get('1', async () => 'done')
    const left = cache.get('2', hanging)
    const kept = cache.get('9', hanging)
    cache.retain((k) => k === '9' || k === '10')
    await expect(left).rejects.toThrow('aborted')
    expect(cache.ready('1')).toBe(true)
    cache.clear()
    await expect(kept).rejects.toThrow('aborted')
    expect(cache.size).toBe(0)
  })

  it('drops failed requests so the next ask tries again', async () => {
    const cache = new RequestCache<string>(4)
    await expect(cache.get('1', () => Promise.reject(new Error('503')))).rejects.toThrow('503')
    await expect(cache.get('1', async () => 'ok')).resolves.toBe('ok')
  })
})
