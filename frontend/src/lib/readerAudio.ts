import { Lipsync } from 'wawa-lipsync'

/**
 * One audio element and one lip-sync analyser for the whole app. Web Audio can attach a media element to a single
 * source node only once, and wawa-lipsync has no teardown — so both live for the page's lifetime and are reused.
 */
let audio: HTMLAudioElement | null = null
let lipsync: Lipsync | null = null

export function readerAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio()
    audio.preload = 'auto'
  }
  return audio
}

/** Create on the first "Read" click (a user gesture) so the browser lets the AudioContext start. */
export function readerLipsync(): Lipsync {
  lipsync ??= new Lipsync()
  return lipsync
}

/** The analyser if reading has started at least once, else null (the avatar then rests). */
export function activeLipsync(): Lipsync | null {
  return lipsync
}
