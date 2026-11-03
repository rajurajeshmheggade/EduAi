import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AMBIENT_SOUNDS,
  BINAURAL_TONE_GAIN,
  WAVES_BASE_GAIN,
  WAVES_CUTOFF_HZ,
  WAVES_SWELL_GAIN,
  startBinauralBeats,
  startOceanWaves,
  useAmbientSound,
} from './ambientAudio'
import { POP_TONE, playPopSound } from './sfx'

interface FakeNode {
  connections: unknown[]
  disconnected: boolean
  connect: (target: unknown) => void
  disconnect: () => void
}
interface FakePlayable extends FakeNode { started: boolean; stopped: boolean; start: () => void; stop: () => void }
interface FakeParam { value: number }
interface FakeBuffer { length: number; getChannelData: () => Float32Array }

// Minimal stand-in for the Web Audio API that records what was built, started and stopped
function makeFakeContext() {
  const created = {
    oscillators: [] as (FakePlayable & { type: string; frequency: FakeParam })[],
    sources: [] as (FakePlayable & { buffer: FakeBuffer | null; loop: boolean })[],
    filters: [] as (FakeNode & { type: string; frequency: FakeParam })[],
    gains: [] as (FakeNode & { gain: FakeParam })[],
  }
  const node = <T extends object>(extra: T): FakeNode & T => ({
    connections: [],
    disconnected: false,
    connect(target: unknown) { this.connections.push(target) },
    disconnect() { this.disconnected = true },
    ...extra,
  })
  const playable = <T extends object>(extra: T) => {
    const n = node({
      started: false,
      stopped: false,
      start() { this.started = true },
      stop() { this.stopped = true },
      ...extra,
    })
    return n as unknown as FakePlayable & T
  }
  const raw = {
    sampleRate: 8000,
    destination: node({}),
    close: vi.fn(() => Promise.resolve()),
    resume: vi.fn(() => Promise.resolve()),
    createBuffer: (_channels: number, length: number) => {
      const data = new Float32Array(length)
      return { length, getChannelData: () => data }
    },
    createBufferSource: () => { const n = playable({ buffer: null as FakeBuffer | null, loop: false }); created.sources.push(n); return n },
    createOscillator: () => { const n = playable({ type: '', frequency: { value: 0 } }); created.oscillators.push(n); return n },
    createBiquadFilter: () => { const n = node({ type: '', frequency: { value: 0 } }); created.filters.push(n); return n },
    createGain: () => { const n = node({ gain: { value: 1 } }); created.gains.push(n); return n },
    createChannelMerger: () => node({}),
  }
  return { ctx: raw as unknown as BaseAudioContext, raw, created }
}

describe('startBinauralBeats', () => {
  it('plays 200 Hz and 210 Hz tones for a 10 Hz beat', () => {
    const { ctx, created } = makeFakeContext()
    startBinauralBeats(ctx)
    const frequencies = created.oscillators.map((o) => o.frequency.value)
    expect(frequencies).toEqual([200, 210])
    expect(frequencies[1] - frequencies[0]).toBe(10)
    expect(created.oscillators.every((o) => o.started && o.type === 'sine')).toBe(true)
  })

  it('stops both tones and releases the nodes when the returned function is called', () => {
    const { ctx, created } = makeFakeContext()
    const stop = startBinauralBeats(ctx)
    expect(created.oscillators.some((o) => o.stopped)).toBe(false)
    stop()
    expect(created.oscillators.every((o) => o.stopped)).toBe(true)
    expect(created.gains.every((g) => g.disconnected)).toBe(true)
  })
})

describe('startOceanWaves', () => {
  it('loops two seconds of filtered noise with a slow swell', () => {
    const { ctx, created } = makeFakeContext()
    startOceanWaves(ctx)
    const [noise] = created.sources
    expect(noise.loop).toBe(true)
    expect(noise.started).toBe(true)
    expect(noise.buffer?.length).toBe(ctx.sampleRate * 2)
    expect(created.filters[0]).toMatchObject({ type: 'lowpass', frequency: { value: WAVES_CUTOFF_HZ } })
    expect(created.oscillators[0].frequency.value).toBeLessThan(1) // the swell is far below hearing range
  })

  it('fills the noise buffer with samples between -1 and 1', () => {
    const { ctx, created } = makeFakeContext()
    startOceanWaves(ctx)
    const samples = created.sources[0].buffer?.getChannelData() ?? new Float32Array()
    expect(samples.some((s) => s !== 0)).toBe(true)
    expect(samples.every((s) => s >= -1 && s <= 1)).toBe(true)
  })

  it('stops the noise and the swell when the returned function is called', () => {
    const { ctx, created } = makeFakeContext()
    const stop = startOceanWaves(ctx)
    stop()
    expect(created.sources[0].stopped).toBe(true)
    expect(created.oscillators[0].stopped).toBe(true)
    expect(created.sources[0].disconnected).toBe(true)
  })
})

describe('audible levels', () => {
  it('keeps the waves audible between swells (the swell never cancels the base level)', () => {
    expect(WAVES_SWELL_GAIN).toBeLessThan(WAVES_BASE_GAIN)
    expect(WAVES_BASE_GAIN - WAVES_SWELL_GAIN).toBeGreaterThan(0.05)
  })

  it('plays well above the old near-silent levels without clipping', () => {
    expect(WAVES_BASE_GAIN).toBeGreaterThanOrEqual(0.2)
    expect(WAVES_BASE_GAIN + WAVES_SWELL_GAIN).toBeLessThan(1)
    expect(BINAURAL_TONE_GAIN).toBeGreaterThanOrEqual(0.1)
    expect(BINAURAL_TONE_GAIN).toBeLessThanOrEqual(0.3)
  })

  it('gives both ears the same tone level', () => {
    const { ctx, created } = makeFakeContext()
    startBinauralBeats(ctx)
    expect(created.gains.filter((g) => g.gain.value === BINAURAL_TONE_GAIN)).toHaveLength(2)
  })
})

describe('AMBIENT_SOUNDS', () => {
  it('offers ocean waves and binaural beats', () => {
    expect(Object.keys(AMBIENT_SOUNDS)).toEqual(['waves', 'binaural'])
  })
})

describe('useAmbientSound', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stubAudioContext() {
    const contexts: ReturnType<typeof makeFakeContext>[] = []
    // A plain function used with `new` returns the fake context object
    function FakeAudioContext() {
      const fake = makeFakeContext()
      contexts.push(fake)
      return fake.raw
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
    return contexts
  }

  it('creates no AudioContext until a sound is chosen', () => {
    const contexts = stubAudioContext()
    const { result } = renderHook(() => useAmbientSound())
    expect(result.current.soundPlaying).toBeNull()
    expect(contexts).toHaveLength(0)
  })

  it('plays one sound at a time and reuses a single context', () => {
    const contexts = stubAudioContext()
    const { result } = renderHook(() => useAmbientSound())
    act(() => result.current.toggleSound('waves'))
    expect(result.current.soundPlaying).toBe('waves')
    act(() => result.current.toggleSound('binaural'))
    expect(result.current.soundPlaying).toBe('binaural')
    expect(contexts).toHaveLength(1)
    const { created } = contexts[0]
    expect(created.sources[0].stopped).toBe(true) // the waves stopped when the beats started
    act(() => result.current.toggleSound('binaural'))
    expect(result.current.soundPlaying).toBeNull()
    expect(created.oscillators.every((o) => o.stopped)).toBe(true)
  })

  it('stops the sound and closes the context on unmount', () => {
    const contexts = stubAudioContext()
    const { result, unmount } = renderHook(() => useAmbientSound())
    act(() => result.current.toggleSound('waves'))
    unmount()
    expect(contexts[0].created.sources[0].stopped).toBe(true)
    expect(contexts[0].raw.close).toHaveBeenCalledTimes(1)
  })

  it('stays silent without Web Audio', () => {
    vi.stubGlobal('AudioContext', undefined)
    const { result } = renderHook(() => useAmbientSound())
    act(() => result.current.toggleSound('waves'))
    expect(result.current.soundPlaying).toBeNull()
  })
})

describe('playPopSound', () => {
  it('sweeps the pitch up and stops after the pop', () => {
    const calls: string[] = []
    const param = (name: string) => ({
      value: 0,
      setValueAtTime: (v: number, t: number) => { calls.push(`${name}=${v}@${t}`) },
      exponentialRampToValueAtTime: (v: number, t: number) => { calls.push(`${name}->${v}@${t}`) },
    })
    const osc = { type: '', frequency: param('f'), connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null }
    const gain = { gain: param('g'), connect: vi.fn(), disconnect: vi.fn() }
    const ctx = { currentTime: 1, destination: {}, createOscillator: () => osc, createGain: () => gain } as unknown as BaseAudioContext
    expect(playPopSound(ctx)).toBe(true)
    expect(calls).toEqual([`f=300@1`, `f->1000@${1 + POP_TONE.seconds}`, `g=0.15@1`, `g->0.01@${1 + POP_TONE.seconds}`])
    expect(osc.stop).toHaveBeenCalledWith(1 + POP_TONE.seconds)
  })

  it('never throws when audio fails', () => {
    const ctx = { createOscillator: () => { throw new Error('closed') } } as unknown as BaseAudioContext
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(playPopSound(ctx)).toBe(false)
  })
})
