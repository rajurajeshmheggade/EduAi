import { vi } from 'vitest'

/** A recording stand-in for the Web Audio API (jsdom has none): what was built, connected, started and stopped. */
export interface FakeParam { value: number; setValueAtTime: (v: number) => void; exponentialRampToValueAtTime: () => void }
export interface FakeNode { kind: string; connections: unknown[]; disconnected: boolean; connect: (t: unknown) => void; disconnect: () => void }
export interface FakeSource extends FakeNode { started: boolean; stopped: boolean; start: () => void; stop: () => void; onended: null | (() => void) }

export function fakeAudioContext() {
  const nodes: FakeNode[] = []
  const param = (value = 0): FakeParam => ({ value, setValueAtTime(v: number) { this.value = v }, exponentialRampToValueAtTime: () => {} })
  const node = <T extends object>(kind: string, extra: T): FakeNode & T => {
    const n = { kind, connections: [] as unknown[], disconnected: false, connect(t: unknown) { this.connections.push(t) }, disconnect() { this.disconnected = true }, ...extra }
    nodes.push(n)
    return n
  }
  const source = <T extends object>(kind: string, extra: T) =>
    node(kind, { started: false, stopped: false, onended: null, start() { this.started = true }, stop() { this.stopped = true }, ...extra }) as unknown as FakeSource & T
  const ctx = {
    state: 'running' as AudioContextState,
    sampleRate: 4000,
    currentTime: 0,
    destination: node('destination', {}),
    resume: vi.fn(async () => {}),
    close: vi.fn(async function close(this: { state: string }) { this.state = 'closed' }),
    createBuffer: (_c: number, length: number) => { const data = new Float32Array(length); return { length, getChannelData: () => data } },
    createBufferSource: () => source('buffer', { buffer: null as unknown, loop: false }),
    createOscillator: () => source('oscillator', { type: 'sine', frequency: param() }),
    createBiquadFilter: () => node('filter', { type: 'lowpass', frequency: param() }),
    createGain: () => node('gain', { gain: param(1) }),
    createChannelMerger: () => node('merger', {}),
  }
  return { ctx, nodes }
}

/** Install a fake `window.AudioContext`; returns every context the code created. Undo with vi.unstubAllGlobals(). */
export function stubAudioContext() {
  const made: ReturnType<typeof fakeAudioContext>[] = []
  function FakeAudioContext() {
    const f = fakeAudioContext()
    made.push(f)
    return f.ctx
  }
  vi.stubGlobal('AudioContext', FakeAudioContext)
  return made
}

/** Sources (buffer / oscillator) that are playing right now. */
export const playingSources = (nodes: FakeNode[]) =>
  nodes.filter((n): n is FakeSource => (n.kind === 'buffer' || n.kind === 'oscillator') && (n as FakeSource).started && !(n as FakeSource).stopped)
