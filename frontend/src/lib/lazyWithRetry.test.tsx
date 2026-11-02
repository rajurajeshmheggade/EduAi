import { Suspense } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { importWithRetry, isChunkLoadError, lazyWithRetry, resetFailedImports } from './lazyWithRetry'

const chunkError = () => new TypeError('Failed to fetch dynamically imported module: /assets/Page-abc123.js')
const Page = ({ name }: { name: string }) => <p>Hello {name}</p>

describe('lazyWithRetry', () => {
  afterEach(() => {
    sessionStorage.clear()
    resetFailedImports()
  })

  it('retries a failed download with backoff before giving up', async () => {
    const factory = vi.fn()
      .mockRejectedValueOnce(chunkError())
      .mockRejectedValueOnce(chunkError())
      .mockResolvedValue({ default: Page })
    await expect(importWithRetry(factory, { retries: 2, delayMs: 1 })).resolves.toEqual({ default: Page })
    expect(factory).toHaveBeenCalledTimes(3)
  })

  it('reloads once for a stale chunk after a deploy, but never loops', async () => {
    const reload = vi.fn()
    const failing = () => Promise.reject(chunkError())
    const first = importWithRetry(failing, { retries: 1, delayMs: 1, reload })
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    void first                                                   // never settles: the page is reloading
    await expect(importWithRetry(failing, { retries: 0, reload })).rejects.toThrow(/dynamically imported module/)
    expect(reload).toHaveBeenCalledTimes(1)                      // reloaded moments ago: show the error instead
  })

  it('does not reload for ordinary errors, and times out a download that hangs', async () => {
    const reload = vi.fn()
    await expect(importWithRetry(() => Promise.reject(new Error('boom')), { retries: 0, reload })).rejects.toThrow('boom')
    await expect(importWithRetry(() => new Promise(() => {}), { retries: 0, timeoutMs: 20, reload })).rejects.toThrow(/took too long/)
    expect(reload).not.toHaveBeenCalled()
    expect(isChunkLoadError(chunkError())).toBe(true)
    expect(isChunkLoadError(new Error('Loading CSS chunk 12 failed'))).toBe(true)
    expect(isChunkLoadError(new Error('boom'))).toBe(false)
  })

  it("the error boundary's Try again really downloads the page again", async () => {
    sessionStorage.setItem('eduai.chunk-reload-at', String(Date.now()))     // already reloaded: no reload this time
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let online = false
    const factory = vi.fn(() => (online ? Promise.resolve({ default: Page }) : Promise.reject(chunkError())))
    const Lazy = lazyWithRetry(factory, { retries: 0 })
    render(<ErrorBoundary><Suspense fallback={<p>Loading page…</p>}><Lazy name="Asha" /></Suspense></ErrorBoundary>)
    expect(await screen.findByText('This page could not be loaded')).toBeInTheDocument()
    expect(screen.getByText(/Check your internet connection/)).toBeInTheDocument()

    online = true
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Hello Asha')).toBeInTheDocument()
    expect(factory).toHaveBeenCalledTimes(2)
  })
})
