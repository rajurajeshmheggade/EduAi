import { describe, expect, it, vi } from 'vitest'
import { runReadiness, type ReadinessSnapshot, type ReadinessStep } from './readiness'

const later = <T,>(ms: number, value?: T) => new Promise<T>((r) => setTimeout(() => r(value as T), ms))

/** The AI Classroom's shape: voice -> 3D model (needs the gender); first page script -> first spoken part. */
function classroom(over: Partial<Record<'voice' | 'avatar' | 'script' | 'audio', ReadinessStep['run']>>, log: string[]): ReadinessStep[] {
  const step = (id: string, run: ReadinessStep['run'], extra: Partial<ReadinessStep> = {}): ReadinessStep => ({
    id, label: id, ...extra, run: async (ctx) => { log.push(`start ${id}`); await run(ctx); log.push(`done ${id}`) },
  })
  return [
    step('voice', over.voice ?? (() => later(5))),
    step('avatar', over.avatar ?? (async ({ progress }) => { progress(0.5); await later(5); progress(1) }), { after: ['voice'], weight: 4, timeoutMs: 200 }),
    step('script', over.script ?? (() => later(5)), { weight: 2 }),
    step('audio', over.audio ?? (() => later(5)), { after: ['voice', 'script'] }),
  ]
}

describe('runReadiness', () => {
  it('runs independent steps together and dependent ones in order, with weighted progress', async () => {
    const log: string[] = []
    const seen: ReadinessSnapshot[] = []
    const out = await runReadiness(classroom({}, log), { onChange: (s) => seen.push(s) })
    expect(log.slice(0, 2).sort()).toEqual(['start script', 'start voice'])          // started at once, in parallel
    expect(log.indexOf('start avatar')).toBeGreaterThan(log.indexOf('done voice'))   // needs the teacher's gender
    expect(log.indexOf('start audio')).toBeGreaterThan(Math.max(log.indexOf('done voice'), log.indexOf('done script')))
    expect(out.settled).toBe(true)
    expect(out.progress).toBe(100)
    expect(out.steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done'])
    const progress = seen.map((s) => s.progress)
    expect(progress).toEqual([...progress].sort((a, b) => a - b))                    // never goes backwards
    expect(seen.some((s) => s.steps.find((x) => x.id === 'avatar')?.progress === 0.5)).toBe(true)
  })

  it('times a slow step out (the classroom then shows the 2D avatar) and still settles', async () => {
    const log: string[] = []
    const out = await runReadiness(classroom({ avatar: () => new Promise(() => {}) }, log))
    expect(out.settled).toBe(true)
    expect(Object.fromEntries(out.steps.map((s) => [s.id, s.state]))).toEqual({ voice: 'done', avatar: 'timeout', script: 'done', audio: 'done' })
  })

  it('skips what depends on a failed step and reports why', async () => {
    const out = await runReadiness(classroom({ voice: () => Promise.reject(new Error('The avatar tutor is off for your school')) }, []))
    const by = Object.fromEntries(out.steps.map((s) => [s.id, s]))
    expect(by.voice.state).toBe('failed')
    expect(by.voice.error).toMatch(/off for your school/)
    expect(by.avatar.state).toBe('skipped')
    expect(by.audio.state).toBe('skipped')
    expect(by.script.state).toBe('done')
    expect(out.progress).toBe(100)
  })

  it('stops reporting once the screen is left', async () => {
    const ctl = new AbortController()
    const onChange = vi.fn()
    const run = runReadiness(classroom({}, []), { signal: ctl.signal, onChange })
    ctl.abort()
    const calls = onChange.mock.calls.length
    await run
    expect(onChange.mock.calls.length).toBe(calls)
  })
})
