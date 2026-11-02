import { afterEach, describe, expect, it, vi } from 'vitest'
import { FOCUS_SOUNDS, startBrownNoise, startRain, startWhiteNoise } from '@/components/wellness/audio/ambientAudio'
import { fakeAudioContext, playingSources, stubAudioContext, type FakeNode } from '@/test/webAudio'
import { FOCUS_SOUND_OPTIONS, FocusSoundEngine } from './focusSound'

const gains = (nodes: FakeNode[]) => nodes.filter((n) => n.kind === 'gain') as (FakeNode & { gain: { value: number } })[]

describe('focus sounds (synthesised, no files)', () => {
  it('offers ocean waves, rain, white and brown noise and binaural beats', () => {
    expect(FOCUS_SOUND_OPTIONS.map((o) => o.id)).toEqual(['waves', 'rain', 'white', 'brown', 'binaural'])
    expect(Object.keys(FOCUS_SOUNDS).sort()).toEqual(['binaural', 'brown', 'rain', 'waves', 'white'])
  })

  it.each([['rain', startRain], ['white', startWhiteNoise], ['brown', startBrownNoise]] as const)('%s loops a noise buffer within -1..1 and stops cleanly', (_id, start) => {
    const { ctx, nodes } = fakeAudioContext()
    const out = ctx.createGain()
    const stop = start(ctx as unknown as BaseAudioContext, out as unknown as AudioNode)
    const [src] = nodes.filter((n) => n.kind === 'buffer') as (FakeNode & { loop: boolean; started: boolean; stopped: boolean; buffer: { getChannelData: () => Float32Array } })[]
    expect(src.loop).toBe(true)
    expect(src.started).toBe(true)
    const samples = src.buffer.getChannelData()
    expect(samples.some((x) => x !== 0)).toBe(true)
    expect(samples.every((x) => x >= -1 && x <= 1)).toBe(true)
    // routed to the given destination (the timer's volume), not straight to the speakers
    expect(nodes.some((n) => n.connections.includes(out))).toBe(true)
    expect(nodes.some((n) => n.connections.includes(ctx.destination))).toBe(false)
    stop()
    expect(src.stopped).toBe(true)
  })
})

describe('FocusSoundEngine', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('stays silent until unlocked by a gesture, and without Web Audio', () => {
    const made = stubAudioContext()
    const engine = new FocusSoundEngine()
    expect(engine.play('waves')).toBe(false)
    expect(made).toHaveLength(0)
    vi.stubGlobal('AudioContext', undefined)
    expect(engine.unlock()).toBe(false)
    expect(engine.chime()).toBe(false)
  })

  it('plays one sound at a time: switching stops the previous one', () => {
    const made = stubAudioContext()
    const engine = new FocusSoundEngine()
    expect(engine.unlock()).toBe(true)
    const { nodes } = made[0]
    engine.play('waves')
    expect(engine.playing).toBe('waves')
    const waves = playingSources(nodes)
    expect(waves.length).toBeGreaterThan(0)

    engine.play('rain')
    expect(engine.playing).toBe('rain')
    expect(waves.every((s) => s.stopped)).toBe(true)
    expect(playingSources(nodes)).toHaveLength(1)

    engine.play('rain')                                         // same sound: nothing restarts
    expect(playingSources(nodes)).toHaveLength(1)

    engine.play('binaural')
    expect(playingSources(nodes).map((s) => s.kind)).toEqual(['oscillator', 'oscillator'])
    engine.stop()
    expect(engine.playing).toBeNull()
    expect(playingSources(nodes)).toHaveLength(0)
    expect(made).toHaveLength(1)                                 // one context throughout
  })

  it('volume and mute act on the master gain in front of every sound and the chime', () => {
    const made = stubAudioContext()
    const engine = new FocusSoundEngine()
    engine.setVolume(0.3)
    engine.unlock()
    const { nodes, ctx } = made[0]
    const master = gains(nodes)[0]
    expect(master.connections).toContain(ctx.destination)
    expect(master.gain.value).toBe(0.3)
    engine.play('white')
    expect(nodes.some((n) => n.connections.includes(master) && n !== master)).toBe(true)

    engine.setVolume(0.8)
    expect(master.gain.value).toBe(0.8)
    engine.setMuted(true)
    expect(master.gain.value).toBe(0)
    expect(engine.chime()).toBe(false)                           // muted: no chime either
    engine.setMuted(false)
    expect(master.gain.value).toBe(0.8)
    expect(engine.chime()).toBe(true)
    engine.setVolume(7)
    expect(master.gain.value).toBe(1)
  })

  it('dispose stops the sound and closes the context', () => {
    const made = stubAudioContext()
    const engine = new FocusSoundEngine()
    engine.unlock()
    engine.play('brown')
    engine.dispose()
    expect(playingSources(made[0].nodes)).toHaveLength(0)
    expect(made[0].ctx.close).toHaveBeenCalledTimes(1)
    expect(engine.unlocked).toBe(false)
  })
})
