/**
 * Sound for the floating Focus Timer: one ambient sound at a time (switching stops the previous one), a master volume
 * and mute in front of everything, and the end-of-session chime through the same volume. All synthesised with Web
 * Audio (components/wellness/audio) — no files.
 *
 * The AudioContext is created by `unlock()`, which must run inside a user gesture (a click on Start or a sound).
 * Without Web Audio every call is a quiet no-op.
 */
import { FOCUS_SOUNDS, audioContextCtor, type FocusSoundId, type StopSound } from '@/components/wellness/audio/ambientAudio'
import { CHIME_TONE, playTone } from '@/components/wellness/audio/sfx'

export const FOCUS_SOUND_OPTIONS: { id: FocusSoundId; label: string; hint?: string }[] = [
  { id: 'waves', label: 'Ocean waves' },
  { id: 'rain', label: 'Rain' },
  { id: 'white', label: 'White noise' },
  { id: 'brown', label: 'Brown noise' },
  { id: 'binaural', label: 'Binaural 10 Hz', hint: 'Use headphones' },
]
export const isFocusSound = (x: unknown): x is FocusSoundId => FOCUS_SOUND_OPTIONS.some((o) => o.id === x)

export class FocusSoundEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private stopCurrent: StopSound | null = null
  private current: FocusSoundId | null = null
  private level = 0.6
  private muted = false

  /** Create or resume the AudioContext (call inside a user gesture). False without Web Audio. */
  unlock(): boolean {
    if (this.ctx && this.ctx.state !== 'closed') {
      if (this.ctx.state === 'suspended') void this.ctx.resume?.().catch(() => {})
      return true
    }
    const Ctor = audioContextCtor()
    if (!Ctor) return false
    try {
      const ctx = new Ctor()
      const master = ctx.createGain()
      master.gain.value = this.output()
      master.connect(ctx.destination)
      this.ctx = ctx
      this.master = master
      return true
    } catch (e) {
      console.warn('[focus] Web Audio is unavailable', e)
      return false
    }
  }

  get unlocked(): boolean { return !!this.ctx && this.ctx.state !== 'closed' }
  get playing(): FocusSoundId | null { return this.current }

  /** Play `id` (stopping whatever played before). False when audio is locked or failed. */
  play(id: FocusSoundId): boolean {
    if (this.current === id && this.stopCurrent) return true
    this.stop()
    if (!this.ctx || !this.master) return false
    try {
      this.stopCurrent = FOCUS_SOUNDS[id](this.ctx, this.master)
      this.current = id
      return true
    } catch (e) {
      console.warn('[focus] could not start the sound', e)
      return false
    }
  }

  stop() {
    const stop = this.stopCurrent
    this.stopCurrent = null
    this.current = null
    if (stop) {
      try { stop() } catch { /* context already closed */ }
    }
  }

  setVolume(level: number) {
    this.level = Math.min(1, Math.max(0, level))
    this.apply()
  }

  setMuted(muted: boolean) {
    this.muted = muted
    this.apply()
  }

  /** The end-of-session chime, at the timer's volume (silent when muted). */
  chime(): boolean {
    if (!this.ctx || !this.master || this.muted) return false
    return playTone(this.ctx, CHIME_TONE, this.master)
  }

  dispose() {
    this.stop()
    const ctx = this.ctx
    this.ctx = null
    this.master = null
    if (ctx && ctx.state !== 'closed') void ctx.close?.().catch(() => {})
  }

  private output() { return this.muted ? 0 : this.level }

  private apply() {
    const gain = this.master?.gain
    if (!gain || !this.ctx) return
    const v = this.output()
    // A short glide, so dragging the slider never crackles.
    if (typeof gain.setTargetAtTime === 'function') gain.setTargetAtTime(v, this.ctx.currentTime || 0, 0.05)
    else gain.value = v
  }
}
