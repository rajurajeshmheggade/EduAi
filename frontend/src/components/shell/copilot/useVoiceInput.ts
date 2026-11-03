import { useCallback, useEffect, useRef, useState } from 'react'
import { getRecognizerConstructor, type Recognizer, type RecognitionErrorEvent, type RecognitionResultEvent } from '@/components/wellness/live/speechApi'
import { copilotService } from '@/services/copilotService'

/** idle → listening (browser dictation) | recording (voice message for the server) → transcribing → idle */
export type VoiceState = 'idle' | 'listening' | 'recording' | 'transcribing'

/** A voice message is cut off after this long (the server also caps the upload size). */
export const MAX_RECORDING_SECONDS = 60

const UI_TO_SPEECH: Record<string, string> = { hi: 'hi-IN', kn: 'kn-IN', ta: 'ta-IN' }

/** Dictation language: the UI language when it's an Indian-language UI, else the browser's English variant. */
export function speechLang(uiLang: string | undefined): string {
  const ui = (uiLang ?? 'en').split('-')[0]
  if (UI_TO_SPEECH[ui]) return UI_TO_SPEECH[ui]
  const nav = typeof navigator !== 'undefined' ? navigator.language : ''
  return nav?.toLowerCase().startsWith('en') ? nav : 'en-IN'
}

const SPEECH_ERRORS: Record<string, string> = {
  'not-allowed': "Microphone access is blocked — allow it for this site in your browser's settings, then try again.",
  'audio-capture': 'No microphone was found — connect one or check your system sound settings.',
  'no-speech': "Didn't catch anything — tap the mic and try again.",
  network: 'Voice typing needs an internet connection in this browser.',
  'service-not-allowed': "This browser's voice typing service isn't available here.",
  'language-not-supported': "Voice typing doesn't support this language in this browser.",
}

function micError(e: unknown): string {
  const name = e instanceof DOMException || e instanceof Error ? e.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return SPEECH_ERRORS['not-allowed']
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return SPEECH_ERRORS['audio-capture']
  if (name === 'NotReadableError') return 'Your microphone is being used by another app — close it and try again.'
  return "Couldn't start the microphone — please try again."
}

const clean = (t: string) => t.replace(/\s+/g, ' ').trim()

export interface VoiceInputOptions {
  /** BCP-47 language for browser dictation. */
  lang: string
  /** Server transcription is available for the recording fallback (null while unknown). */
  serverTranscription: boolean | null
  /** Live transcript of this voice session (interim + final while dictating; the full text once transcribed). */
  onText: (text: string) => void
  /** The session ended with this final text (used for auto-send). */
  onComplete?: (text: string) => void
}

/**
 * Voice input for the Copilot box. Prefers the browser's own speech recognition (live dictation with interim
 * results; it stops by itself when the speaker pauses, or on a second click). Without it, records a short voice
 * message with MediaRecorder and sends it to POST /copilot/transcribe. Either way the text lands in the input for
 * the user to review — nothing is sent unless they choose auto-send.
 */
export function useVoiceInput({ lang, serverTranscription, onText, onComplete }: VoiceInputOptions) {
  const [state, setState] = useState<VoiceState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const recognizer = useRef<Recognizer | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const timer = useRef<number | null>(null)
  const cancelled = useRef(false) // unmounted
  const discard = useRef(false) // this session was cancelled (question sent / panel closed): drop its text
  // The browser's speech service failed (network / blocked): use the recording fallback from now on.
  const [speechBroken, setSpeechBroken] = useState(false)
  const cb = useRef({ onText, onComplete })
  useEffect(() => { cb.current = { onText, onComplete } })

  const speechAvailable = !!getRecognizerConstructor()
  const canRecord = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'
  const mode: 'speech' | 'record' | null = speechAvailable && !speechBroken ? 'speech' : canRecord ? 'record' : null

  const clearTimer = () => { if (timer.current !== null) { window.clearInterval(timer.current); timer.current = null } }
  const releaseMic = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null }

  /** Seconds counter for the recording indicator; ends the session at MAX_RECORDING_SECONDS. */
  function tick(end: () => void) {
    let secs = 0
    setElapsed(0)
    clearTimer()
    timer.current = window.setInterval(() => {
      secs += 1
      setElapsed(secs)
      if (secs >= MAX_RECORDING_SECONDS) end()
    }, 1000)
  }

  /** Finish the session and keep its text (second click on the mic). */
  const stop = useCallback(() => {
    if (recognizer.current) recognizer.current.stop()
    else if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop()
  }, [])

  /** End the session and throw its text away (the question was sent, or the panel closed). */
  const cancel = useCallback(() => {
    if (!recognizer.current && !(recorder.current && recorder.current.state !== 'inactive')) return
    discard.current = true
    if (recognizer.current) recognizer.current.abort()
    else recorder.current?.stop()
  }, [])

  // Unmount: drop any live session without transcribing it.
  useEffect(() => {
    cancelled.current = false
    return () => {
      cancelled.current = true
      recognizer.current?.abort()
      if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop()
      clearTimer()
      releaseMic()
    }
  }, [])

  function startDictation() {
    const Ctor = getRecognizerConstructor()
    if (!Ctor) return
    const rec = new Ctor()
    rec.lang = lang
    rec.interimResults = true
    rec.continuous = false // ends by itself after a pause in speech
    let finalText = ''
    discard.current = false
    rec.onresult = (e: RecognitionResultEvent) => {
      if (discard.current) return
      let fin = ''
      let interim = ''
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]
        const t = r[0]?.transcript ?? ''
        if (r.isFinal) fin += t
        else interim += t
      }
      finalText = clean(fin)
      cb.current.onText(clean(`${fin} ${interim}`))
    }
    rec.onerror = (e: RecognitionErrorEvent) => {
      if (e.error === 'aborted') return
      if ((e.error === 'network' || e.error === 'service-not-allowed') && canRecord && serverTranscription !== false) {
        setSpeechBroken(true)
        setError(`${SPEECH_ERRORS[e.error]} Tap the mic again to send a voice message instead.`)
        return
      }
      setError(SPEECH_ERRORS[e.error] ?? 'Voice typing stopped unexpectedly — please try again.')
    }
    rec.onend = () => {
      recognizer.current = null
      clearTimer()
      setState('idle')
      if (finalText && !cancelled.current && !discard.current) cb.current.onComplete?.(finalText)
    }
    try {
      rec.start()
    } catch {
      setError("Couldn't start voice typing — please try again.")
      return
    }
    recognizer.current = rec
    setState('listening')
    tick(() => rec.stop())
  }

  async function startRecording() {
    if (serverTranscription === false) {
      setError("Voice typing isn't available in this browser, and voice messages need the AI key (offline demo mode). Please type your question — or try Chrome or Edge.")
      return
    }
    let media: MediaStream
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      setError(micError(e))
      return
    }
    if (cancelled.current) { media.getTracks().forEach((t) => t.stop()); return }
    discard.current = false
    stream.current = media
    const mr = new MediaRecorder(media)
    const chunks: Blob[] = []
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    mr.onstop = async () => {
      recorder.current = null
      clearTimer()
      releaseMic()
      if (cancelled.current) return
      if (discard.current) { setState('idle'); return }
      const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' })
      if (!blob.size) { setState('idle'); setError("Didn't catch anything — tap the mic and try again."); return }
      setState('transcribing')
      try {
        const text = clean(await copilotService.transcribe(blob))
        if (cancelled.current) return
        if (!text) { setError("Didn't catch anything — tap the mic and try again."); return }
        cb.current.onText(text)
        cb.current.onComplete?.(text)
      } catch (e) {
        if (!cancelled.current) setError(e instanceof Error ? e.message : "Couldn't transcribe that voice message — please try again.")
      } finally {
        if (!cancelled.current) setState('idle')
      }
    }
    mr.start()
    recorder.current = mr
    setState('recording')
    tick(() => { if (mr.state !== 'inactive') mr.stop() })
  }

  /** Start a voice session, or finish the current one (second click). */
  function toggle() {
    if (state === 'listening' || state === 'recording') { stop(); return }
    if (state === 'transcribing') return
    setError(null)
    if (mode === 'speech') startDictation()
    else if (mode === 'record') void startRecording()
    else setError("Voice input isn't supported in this browser — please type your question.")
  }

  return { state, error, elapsed, mode, toggle, stop, cancel, clearError: () => setError(null) }
}
