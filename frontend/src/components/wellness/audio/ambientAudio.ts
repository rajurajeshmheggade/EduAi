/* Ambient sounds synthesised with the Web Audio API (no audio files to download).
   Shared by the Focus timer and the breathing guide (MindAlign utils/ambientAudio.js).

   Lifecycle: an AudioContext is only created inside a user gesture (the first sound toggle / Start click), one per
   component, and it is closed when that component unmounts — the Wellness shell unmounts a tab when the student
   switches tabs, so nothing keeps playing in the background of another tab. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Levels are set to be clearly audible on laptop speakers at a normal volume setting. (The first version peaked
// around -40 dBFS, all below 350 Hz, which small speakers barely reproduce, so it sounded like nothing was playing.)
export const WAVES_CUTOFF_HZ = 1000 // bright enough for small speakers, still a soft wash
export const WAVES_BASE_GAIN = 0.3 // level between waves
export const WAVES_SWELL_GAIN = 0.22 // how much each wave rises and falls (less than the base, so it never cuts out)
export const WAVES_SWELL_HZ = 0.1 // one wave every 10 seconds
export const BINAURAL_LEFT_HZ = 200
export const BINAURAL_RIGHT_HZ = 210 // 10 Hz apart → alpha "focus" beat
export const BINAURAL_TONE_GAIN = 0.12
const FADE_IN_SECONDS = 0.4
const FADE_OUT_SECONDS = 0.15

export type AmbientSoundId = 'waves' | 'binaural'
/** Stops a running sound and releases its nodes. */
export type StopSound = () => void

// Output stage that fades the sound in, so starting it never clicks
function createFadeIn(ctx: BaseAudioContext): GainNode {
  const fade = ctx.createGain()
  fade.gain.value = 0
  if (typeof fade.gain.setValueAtTime === 'function' && typeof fade.gain.linearRampToValueAtTime === 'function') {
    const now = ctx.currentTime || 0
    fade.gain.setValueAtTime(0, now)
    fade.gain.linearRampToValueAtTime(1, now + FADE_IN_SECONDS)
  } else {
    fade.gain.value = 1
  }
  fade.connect(ctx.destination)
  return fade
}

/** Fades the output out (no click), stops every source and disconnects every node once the sources have ended. */
function stopGracefully(ctx: BaseAudioContext, output: GainNode, sources: AudioScheduledSourceNode[], nodes: AudioNode[]) {
  const gain = output.gain
  const now = ctx.currentTime || 0
  const canRamp = ctx.state === 'running' && typeof gain.cancelScheduledValues === 'function' && typeof gain.linearRampToValueAtTime === 'function'
  let released = false
  const releaseAll = () => {
    if (released) return
    released = true
    for (const node of [...sources, ...nodes, output]) {
      try { node.disconnect() } catch { /* already disconnected */ }
    }
  }
  if (canRamp) {
    gain.cancelScheduledValues(now)
    gain.setValueAtTime(gain.value, now)
    gain.linearRampToValueAtTime(0, now + FADE_OUT_SECONDS)
  }
  for (const source of sources) {
    try { source.stop(canRamp ? now + FADE_OUT_SECONDS : 0) } catch { /* already stopped */ }
  }
  if (canRamp && sources[0]) sources[0].onended = releaseAll
  else releaseAll()
}

/**
 * Ocean waves: looped white noise through a low-pass filter, with a slow LFO swelling the volume.
 * @returns Call to stop the sound.
 */
export function startOceanWaves(ctx: BaseAudioContext): StopSound {
  const bufferSize = ctx.sampleRate * 2
  const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
  const output = noiseBuffer.getChannelData(0)
  for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1

  const noiseSource = ctx.createBufferSource()
  noiseSource.buffer = noiseBuffer
  noiseSource.loop = true

  const lowpass = ctx.createBiquadFilter()
  lowpass.type = 'lowpass'
  lowpass.frequency.value = WAVES_CUTOFF_HZ

  const waveGain = ctx.createGain()
  waveGain.gain.value = WAVES_BASE_GAIN

  const lfo = ctx.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = WAVES_SWELL_HZ

  const lfoGain = ctx.createGain()
  lfoGain.gain.value = WAVES_SWELL_GAIN

  lfo.connect(lfoGain)
  lfoGain.connect(waveGain.gain)

  const fadeIn = createFadeIn(ctx)
  noiseSource.connect(lowpass)
  lowpass.connect(waveGain)
  waveGain.connect(fadeIn)

  noiseSource.start()
  lfo.start()

  return () => stopGracefully(ctx, fadeIn, [noiseSource, lfo], [lowpass, waveGain, lfoGain])
}

/**
 * Binaural beats: 200 Hz in the left ear and 210 Hz in the right, heard as a 10 Hz alpha beat (needs headphones).
 * @returns Call to stop the sound.
 */
export function startBinauralBeats(ctx: BaseAudioContext): StopSound {
  const merger = ctx.createChannelMerger(2)

  const oscL = ctx.createOscillator()
  oscL.frequency.value = BINAURAL_LEFT_HZ
  oscL.type = 'sine'

  const oscR = ctx.createOscillator()
  oscR.frequency.value = BINAURAL_RIGHT_HZ
  oscR.type = 'sine'

  const gainL = ctx.createGain()
  const gainR = ctx.createGain()
  gainL.gain.value = BINAURAL_TONE_GAIN
  gainR.gain.value = BINAURAL_TONE_GAIN

  oscL.connect(gainL)
  oscR.connect(gainR)
  gainL.connect(merger, 0, 0)
  gainR.connect(merger, 0, 1)

  const fadeIn = createFadeIn(ctx)
  merger.connect(fadeIn)

  oscL.start()
  oscR.start()

  return () => stopGracefully(ctx, fadeIn, [oscL, oscR], [gainL, gainR, merger])
}

export const AMBIENT_SOUNDS: Record<AmbientSoundId, (ctx: BaseAudioContext) => StopSound> = {
  waves: startOceanWaves,
  binaural: startBinauralBeats,
}

type AudioContextCtor = typeof AudioContext
function audioContextCtor(): AudioContextCtor | undefined {
  if (typeof window === 'undefined') return undefined
  const w = window as typeof window & { webkitAudioContext?: AudioContextCtor }
  return w.AudioContext ?? w.webkitAudioContext
}

export interface AudioContextHandle {
  /** The component's AudioContext, created (or resumed) on demand — call it from a user gesture. Null without Web Audio. */
  ensure: () => AudioContext | null
  /** The context if one exists already; never creates one. */
  current: () => AudioContext | null
}

/** One lazily-created AudioContext per component, closed automatically on unmount. */
export function useAudioContext(): AudioContextHandle {
  const ref = useRef<AudioContext | null>(null)

  const ensure = useCallback((): AudioContext | null => {
    let ctx = ref.current
    if (!ctx || ctx.state === 'closed') {
      const Ctor = audioContextCtor()
      if (!Ctor) return null
      try {
        ctx = new Ctor()
      } catch (e) {
        console.warn('[wellness] Web Audio is unavailable', e)
        return null
      }
      ref.current = ctx
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    return ctx
  }, [])
  const current = useCallback(() => ref.current, [])

  useEffect(() => () => {
    const ctx = ref.current
    ref.current = null
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {})
  }, [])

  return useMemo(() => ({ ensure, current }), [ensure, current])
}

/**
 * One ambient sound at a time for a component, stopped automatically when the component unmounts.
 * Pass `audio` to share an AudioContext the component already owns (e.g. for its own chimes); otherwise the hook
 * owns one, created on the first toggle.
 */
export function useAmbientSound(audio?: AudioContextHandle) {
  const own = useAudioContext()
  const handle = audio ?? own
  const [soundPlaying, setSoundPlaying] = useState<AmbientSoundId | null>(null)
  const stopRef = useRef<StopSound | null>(null)

  const silence = useCallback(() => {
    const stop = stopRef.current
    stopRef.current = null
    if (stop) {
      try { stop() } catch { /* context already closed */ }
    }
  }, [])

  const stopSound = useCallback(() => {
    silence()
    setSoundPlaying(null)
  }, [silence])

  // Play the sound, or stop it if it is the one already playing
  const toggleSound = useCallback((id: AmbientSoundId) => {
    silence()
    if (soundPlaying === id) {
      setSoundPlaying(null)
      return
    }
    const ctx = handle.ensure()
    if (!ctx) {
      setSoundPlaying(null)
      return
    }
    try {
      stopRef.current = AMBIENT_SOUNDS[id](ctx)
      setSoundPlaying(id)
    } catch (e) {
      console.warn('[wellness] could not start ambient sound', e)
      setSoundPlaying(null)
    }
  }, [handle, silence, soundPlaying])

  useEffect(() => silence, [silence])

  return { soundPlaying, toggleSound, stopSound }
}
