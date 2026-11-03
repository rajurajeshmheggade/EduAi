/* Web Speech API typings for Aura Live. SpeechRecognition (and Chrome's on-device extras) is not in every
   TypeScript DOM lib, so the parts Aura uses are declared here instead of falling back to `any`. */

export const SPEECH_LANG = 'en-US'

export interface RecognitionAlternative { readonly transcript: string }
export interface RecognitionResult extends ArrayLike<RecognitionAlternative> { readonly isFinal: boolean }
export interface RecognitionResultEvent { readonly results: ArrayLike<RecognitionResult> }
export interface RecognitionErrorEvent { readonly error: string }

/** The subset of `SpeechRecognition` Aura drives. `processLocally` is Chrome's on-device mode. */
export interface Recognizer {
  continuous: boolean
  interimResults: boolean
  lang: string
  processLocally?: boolean
  onstart: (() => void) | null
  onresult: ((event: RecognitionResultEvent) => void) | null
  onerror: ((event: RecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

export type OnDeviceStatus = 'available' | 'downloadable' | 'downloading' | 'unavailable'
export interface OnDeviceOptions { langs: string[]; processLocally: boolean }

export interface RecognizerConstructor {
  new (): Recognizer
  /** Chrome: is the on-device model for these languages installed? */
  available?: (options: OnDeviceOptions) => Promise<OnDeviceStatus>
  /** Chrome: download the on-device model in the background. */
  install?: (options: OnDeviceOptions) => Promise<boolean>
}

type SpeechWindow = Window & typeof globalThis & {
  SpeechRecognition?: RecognizerConstructor
  webkitSpeechRecognition?: RecognizerConstructor
  webkitAudioContext?: typeof AudioContext
}

const speechWindow = (): SpeechWindow | null => (typeof window === 'undefined' ? null : (window as SpeechWindow))

/** The browser's speech recognition constructor, or null (e.g. Firefox). */
export function getRecognizerConstructor(): RecognizerConstructor | null {
  const w = speechWindow()
  return w?.SpeechRecognition ?? w?.webkitSpeechRecognition ?? null
}

export function getAudioContextClass(): typeof AudioContext | null {
  const w = speechWindow()
  return w?.AudioContext ?? w?.webkitAudioContext ?? null
}

/** Speech synthesis, when this browser has it. */
export function getSynth(): SpeechSynthesis | null {
  const w = speechWindow()
  return w && 'speechSynthesis' in w ? w.speechSynthesis : null
}

/** Can this browser record raw microphone audio for server transcription? */
export function canRecordForServer(): boolean {
  return typeof AudioWorkletNode !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

/** A natural-sounding English voice (Google / Natural / Microsoft), when one is installed. */
export function pickVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | undefined {
  return synth.getVoices().find((v) =>
    (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Microsoft')) && v.lang.startsWith('en'))
}

/** Text Aura reads aloud: drop bracketed notes (e.g. "[Offline Mode]") and markdown symbols. */
export function speakableText(text: string): string {
  return text.replace(/\[.*?\]/g, '').replace(/[*_#`]+/g, '').replace(/\s+/g, ' ').trim()
}

export const normalizeText = (text: string) => text.replace(/\s+/g, ' ').trim()
/** Case/punctuation-only edits (the browser finalizing a phrase) don't count as the student still talking. */
export const comparableText = (text: string) => normalizeText(text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ''))
