/* One-shot sound effects synthesised with Web Audio (no files). Each takes the component's AudioContext
   (see useAudioContext) instead of creating a new context per sound, which browsers limit and never free. */

interface ToneSpec {
  type: OscillatorType
  fromHz: number
  /** Exponential pitch sweep target; omit for a steady tone. */
  toHz?: number
  gain: number
  endGain: number
  seconds: number
}

/** Plays one tone and disconnects its nodes when it ends. Returns false when it could not be played. */
export function playTone(ctx: BaseAudioContext, tone: ToneSpec): boolean {
  try {
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = tone.type
    osc.frequency.setValueAtTime(tone.fromHz, t)
    if (tone.toHz) osc.frequency.exponentialRampToValueAtTime(tone.toHz, t + tone.seconds)
    gain.gain.setValueAtTime(tone.gain, t)
    gain.gain.exponentialRampToValueAtTime(tone.endGain, t + tone.seconds)
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
    }
    osc.start(t)
    osc.stop(t + tone.seconds)
    return true
  } catch (e) {
    console.warn('[wellness] could not play sound', e)
    return false
  }
}

/** Stress Buster balloon pop: a quick 300 → 1000 Hz sine sweep, 150 ms. */
export const POP_TONE: ToneSpec = { type: 'sine', fromHz: 300, toHz: 1000, gain: 0.15, endGain: 0.01, seconds: 0.15 }
/** Focus timer end: a gentle C5 chime fading out over 1.2 s. */
export const CHIME_TONE: ToneSpec = { type: 'sine', fromHz: 523.25, gain: 0.1, endGain: 0.001, seconds: 1.2 }

export const playPopSound = (ctx: BaseAudioContext) => playTone(ctx, POP_TONE)
export const playChime = (ctx: BaseAudioContext) => playTone(ctx, CHIME_TONE)
