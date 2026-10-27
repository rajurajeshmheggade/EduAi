/* Aura Live voice engine: hands-free speech-to-text with 3-second pause auto-send, text-to-speech replies,
   barge-in, and a server transcription fallback (port of MindAlign AuraLive.jsx's speech logic).
   It is a plain class rather than hook code because the Web Speech / Web Audio callbacks outlive any render:
   all live values are fields, and the UI only receives change patches. */
import { encodeWavBlob, recordedMs } from './audioCapture'
import { attachPcmCapture, closeMicMonitor, openMicMonitor, prepareOnDeviceRecognition, readMicActivity, type MicMonitor } from './micMonitor'
import {
  comparableText, getRecognizerConstructor, getSynth, normalizeText, pickVoice, speakableText, SPEECH_LANG,
  type RecognitionErrorEvent, type RecognitionResultEvent, type Recognizer,
} from './speechApi'

/** Aura replies automatically once the student has been silent this long. */
export const SILENCE_PAUSE_DELAY = 3000
// When the "paused, sending soon" cue appears
const PAUSE_INDICATOR_DELAY = 1000
// If the transcript stops changing this long, send even though the mic still hears background noise
const STALE_TRANSCRIPT_DELAY = 8000
// How often the voice monitor samples the microphone and checks for the pause
const MONITOR_INTERVAL = 100
// Server transcription engine: longest spoken turn sent in one request, and pre-roll kept before speech starts
const MAX_RECORDING_MS = 45000
const PREROLL_CHUNKS = 12

// Errors meaning the browser's own speech service can't be used here (e.g. blocked by a corporate proxy).
// Aura switches speech engines instead of failing on these.
const BROWSER_SERVICE_ERRORS = ['network', 'service-not-allowed', 'language-not-supported']

// Recognition errors that restarting won't fix, with what the student should do about them
const RECOGNITION_ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Allow the microphone for this site, then tap to speak.',
  'service-not-allowed': 'Speech recognition is turned off in this browser. Try Google Chrome or Microsoft Edge.',
  'audio-capture': 'No microphone was found. Connect one, then tap to speak.',
  network: 'The browser speech service is unreachable. Check your internet connection, then tap to speak.',
  'language-not-supported': 'English speech recognition is not available in this browser.',
}

export const SERVER_STT_UNAVAILABLE =
  "Voice transcription isn't available on this server, so Aura can't hear you in this browser. Type your message below, or try Google Chrome or Microsoft Edge."
const CANT_RECORD =
  "Aura can't record your voice. Allow microphone access for this site (or try Google Chrome or Microsoft Edge), then tap to speak."
const SWITCHED_TO_SERVER =
  "This network blocks the browser's speech service, so Aura is transcribing your voice herself. Your words appear after each pause."
const ON_DEVICE_READY = 'On-device speech recognition is ready, so your words will appear live from your next turn.'
const TRANSCRIBE_FAILED = "Aura couldn't transcribe that. Please try again."

/** 'browser' = Web Speech API (on-device when Chrome's local model is installed, otherwise the browser's cloud
    service); 'server' = record the turn and transcribe it on the EduAI backend (works behind proxies and in
    browsers without speech recognition, e.g. Firefox). */
export type SpeechEngineKind = 'browser' | 'server'

export interface VoiceState {
  active: boolean
  listening: boolean
  speaking: boolean
  /** Waiting for Aura's reply. */
  loading: boolean
  /** The student paused; the turn is sent when the countdown ends. */
  pausing: boolean
  sendCountdown: number
  hearingVoice: boolean
  transcribing: boolean
  /** The student's current turn, as recognized so far. */
  liveInterim: string
  error: string
  notice: string
}

export const INITIAL_VOICE_STATE: VoiceState = {
  active: false, listening: false, speaking: false, loading: false, pausing: false, sendCountdown: 0,
  hearingVoice: false, transcribing: false, liveInterim: '', error: '', notice: '',
}

/** Thrown by the `transcribe` hook with a student-facing message. `stopListening` pauses hands-free mode
    because retrying straight away would only fail the same way. */
export class TranscribeError extends Error {
  readonly stopListening: boolean
  constructor(message: string, stopListening = false) {
    super(message)
    this.name = 'TranscribeError'
    this.stopListening = stopListening
  }
}

export interface VoiceEngineHooks {
  /** Only the fields that actually changed. */
  onChange: (patch: Partial<VoiceState>) => void
  /** 0..1, ten times a second: drive the level meter through the DOM, not React state. */
  onMicLevel: (level: number) => void
  /** 0..1 progress of the pause countdown. */
  onPauseProgress: (fraction: number) => void
  /** A finished spoken turn. The receiver must call `setLoading(true)` synchronously, then `speak(reply)`. */
  onTurn: (text: string) => void
  /** 16 kHz mono WAV → text. Throw a TranscribeError for a friendly message. */
  transcribe: (wav: Blob) => Promise<string>
  /** Can the server transcribe audio right now (AI provider configured, recording supported)? */
  serverSttAvailable: () => boolean
}

const NOOP_HOOKS: VoiceEngineHooks = {
  onChange: () => {},
  onMicLevel: () => {},
  onPauseProgress: () => {},
  onTurn: () => {},
  transcribe: () => Promise.reject(new TranscribeError(TRANSCRIBE_FAILED)),
  serverSttAvailable: () => false,
}

export class AuraVoiceEngine {
  private hooks: VoiceEngineHooks = NOOP_HOOKS
  private readonly state: VoiceState = { ...INITIAL_VOICE_STATE }
  private session = 0

  private recognition: Recognizer | null = null
  private monitor: MicMonitor | null = null
  private monitorTimer: number | undefined
  private commitFallbackTimer: number | undefined
  private restartTimer: number | undefined
  private utterance: SpeechSynthesisUtterance | null = null
  private speechDone: (() => void) | null = null
  private speechStartedAt = 0
  private idleSince = 0

  // The student's current spoken turn
  private carryoverText = '' // text from earlier recognition sessions within this turn
  private sessionText = '' // final + interim text of the running recognition session
  private heardSpeech = false
  private lastTextChange = 0
  private lastVoice = 0
  private commitPending = false
  private discardResults = false
  private manualPause = false

  private kind: SpeechEngineKind = 'browser'
  private onDeviceReady = false
  private engineSwitchPending = false
  private recording: Float32Array[] | null = null // chunks of the turn being recorded (server engine)

  /** Wire the engine to the UI (from an effect). */
  connect(hooks: VoiceEngineHooks) { this.hooks = hooks }
  /** After unmount: late async results go nowhere. */
  disconnect() { this.hooks = NOOP_HOOKS }

  get active() { return this.state.active }
  get loading() { return this.state.loading }
  get transcribing() { return this.state.transcribing }
  /** Increments on every session start, so late async results of a closed session are dropped. */
  get sessionId() { return this.session }

  private set(patch: Partial<VoiceState>) {
    const changed: Partial<VoiceState> = {}
    let any = false
    for (const key of Object.keys(patch) as (keyof VoiceState)[]) {
      if (this.state[key] !== patch[key]) {
        Object.assign(changed, { [key]: patch[key] })
        any = true
      }
    }
    if (!any) return
    Object.assign(this.state, changed)
    this.hooks.onChange(changed)
  }

  setActive(value: boolean) { this.set({ active: value }) }
  setLoading(value: boolean) { this.set({ loading: value }) }
  setNotice(notice: string) { this.set({ notice }) }

  // ---------------------------------------------------------------- session lifecycle
  /** Call inside the click that starts the session (so Chrome may fetch its on-device model in the background). */
  begin() {
    this.session++
    this.set({ active: true, error: '', notice: '' })
    // Browsers without speech recognition (e.g. Firefox) use server transcription from the start
    this.kind = getRecognizerConstructor() ? 'browser' : 'server'
    getSynth()?.getVoices() // Chrome loads voices lazily: start now so the welcome can use a natural one
    void prepareOnDeviceRecognition(() => {
      this.onDeviceReady = true
      if (this.state.active && this.kind === 'server') this.set({ notice: ON_DEVICE_READY })
    }).then((ready) => { if (ready) this.onDeviceReady = true })
  }

  /** Voice engine + pause detector. Resolves false when the session was closed meanwhile. */
  async startVoice(): Promise<boolean> {
    const session = this.session
    this.initRecognition()
    await this.startMonitor(session)
    if (!this.state.active || session !== this.session) return false
    window.clearInterval(this.monitorTimer)
    this.monitorTimer = window.setInterval(() => this.tick(), MONITOR_INTERVAL)
    return true
  }

  /** Release the microphone, recognition and speech. Safe to call any number of times. */
  stop() {
    window.clearInterval(this.monitorTimer)
    this.monitorTimer = undefined
    window.clearTimeout(this.commitFallbackTimer)
    window.clearTimeout(this.restartTimer)
    this.commitPending = false
    this.engineSwitchPending = false
    this.recording = null
    this.set({ transcribing: false })
    const wasSpeaking = this.utterance !== null || this.state.speaking
    this.utterance = null
    this.speechDone = null
    if (wasSpeaking) getSynth()?.cancel()
    const rec = this.recognition
    if (rec) {
      this.abortRecognition()
      rec.onstart = null
      rec.onresult = null
      rec.onerror = null
      rec.onend = null
      this.recognition = null
    }
    closeMicMonitor(this.monitor)
    this.monitor = null
    this.set({ listening: false, speaking: false })
    this.resetTurn()
    this.hooks.onMicLevel(0)
  }

  // ---------------------------------------------------------------- microphone monitor + PCM tap
  private async startMonitor(session: number) {
    const monitor = await openMicMonitor()
    if (!monitor) return
    if (!this.state.active || session !== this.session) {
      closeMicMonitor(monitor)
      return
    }
    this.monitor = monitor
    const captureNode = await attachPcmCapture(monitor, (chunk) => this.onPcmChunk(chunk))
    if (this.monitor === monitor) monitor.captureNode = captureNode
    else if (captureNode) captureNode.port.onmessage = null // session closed while the worklet loaded
  }

  private onPcmChunk(chunk: Float32Array) {
    const recording = this.recording
    if (!recording) return
    recording.push(chunk)
    // Until the student starts talking, keep only a short pre-roll so a quiet mic doesn't pile up audio
    if (!this.heardSpeech && recording.length > PREROLL_CHUNKS) recording.shift()
  }

  // ---------------------------------------------------------------- current spoken turn
  private turnText() { return normalizeText(`${this.carryoverText} ${this.sessionText}`) }

  private resetTurn() {
    this.carryoverText = ''
    this.sessionText = ''
    this.heardSpeech = false
    this.lastTextChange = Date.now()
    this.lastVoice = 0
    this.set({ liveInterim: '', pausing: false, sendCountdown: 0, hearingVoice: false })
    this.hooks.onPauseProgress(0)
  }

  private markSpeechHeard() {
    this.heardSpeech = true
    this.set({ hearingVoice: true, error: '', pausing: false, sendCountdown: 0 })
    this.hooks.onPauseProgress(0)
  }

  // ---------------------------------------------------------------- Web Speech API recognition
  private initRecognition() {
    const Ctor = getRecognizerConstructor()
    if (!Ctor) {
      console.warn('Speech Recognition API not supported in this browser.')
      return
    }
    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = SPEECH_LANG
    rec.onstart = () => this.set({ listening: true })
    rec.onresult = (event) => this.onRecognitionResult(event)
    rec.onerror = (event) => this.onRecognitionError(rec, event)
    rec.onend = () => this.onRecognitionEnd()
    this.recognition = rec
  }

  private onRecognitionResult(event: RecognitionResultEvent) {
    if (this.discardResults) return
    // Rebuild this session's transcript from every result, so revised or repeated chunks never duplicate text
    let finalText = ''
    let interimText = ''
    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i]
      const chunk = result[0]?.transcript ?? ''
      if (result.isFinal) finalText += ` ${chunk}`
      else interimText += ` ${chunk}`
    }
    const previousText = this.turnText()
    this.sessionText = normalizeText(`${finalText} ${interimText}`)
    const currentText = this.turnText()
    if (currentText && comparableText(currentText) !== comparableText(previousText)) {
      this.lastTextChange = Date.now()
      this.markSpeechHeard()
    }
    this.set({ liveInterim: currentText })
  }

  private onRecognitionError(rec: Recognizer, event: RecognitionErrorEvent) {
    // 'no-speech' (student hasn't started yet) and 'aborted' (we stopped it) are expected; onend restarts
    if (event.error === 'no-speech' || event.error === 'aborted') return
    console.warn('Speech recognition notice:', event.error)
    if (BROWSER_SERVICE_ERRORS.includes(event.error)) {
      // The browser's speech service is unusable here: switch engines (onend restarts listening) instead of failing
      if (this.onDeviceReady && !rec.processLocally) {
        this.engineSwitchPending = true
        return
      }
      if (this.monitor?.captureNode && this.hooks.serverSttAvailable()) {
        this.kind = 'server'
        this.engineSwitchPending = true
        this.set({ notice: SWITCHED_TO_SERVER })
        return
      }
    }
    const message = RECOGNITION_ERROR_MESSAGES[event.error]
    if (message) {
      this.manualPause = true // restarting would only hit the same error again
      this.set({ error: message })
    }
  }

  private onRecognitionEnd() {
    this.set({ listening: false })
    this.hooks.onMicLevel(0)
    if (this.commitPending) {
      this.finalizeTurn()
      return
    }
    if (this.engineSwitchPending) {
      // Continue the same turn on the other speech engine
      this.engineSwitchPending = false
      this.carryoverText = this.turnText()
      this.sessionText = ''
      this.restartTimer = window.setTimeout(() => this.startListening(true), 250)
      return
    }
    if (this.discardResults) return // stopped on purpose: Aura speaking, mic paused or session closed
    // The browser ended the session by itself (silence timeout, network blip): keep the words and resume
    this.carryoverText = this.turnText()
    this.sessionText = ''
    const s = this.state
    if (s.active && !s.speaking && !s.loading && !this.manualPause) {
      this.restartTimer = window.setTimeout(() => { if (!this.manualPause) this.startListening(true) }, 250)
    }
  }

  private startListening(keepTurn = false) {
    const s = this.state
    if (!s.active || s.listening || s.speaking || s.loading || this.commitPending) return
    // Chrome's on-device model finished installing: go back to the browser engine for live transcripts
    if (this.kind === 'server' && this.onDeviceReady && this.recognition) this.kind = 'browser'
    const rec = this.recognition
    if (this.kind === 'browser' && !rec) return
    window.clearTimeout(this.restartTimer)
    this.manualPause = false
    this.discardResults = false
    this.engineSwitchPending = false
    if (!keepTurn) this.resetTurn()

    if (this.kind === 'server') {
      if (!this.hooks.serverSttAvailable()) {
        this.manualPause = true
        this.set({ error: SERVER_STT_UNAVAILABLE })
        return
      }
      if (!this.monitor?.captureNode) {
        this.manualPause = true
        this.set({ error: CANT_RECORD })
        return
      }
      this.recording = []
      this.set({ listening: true })
      return
    }
    if (!rec) return
    rec.processLocally = this.onDeviceReady
    try {
      rec.start()
    } catch {
      // Already started (InvalidStateError): nothing to do
    }
  }

  /** Stop listening and throw away anything still being recognized or recorded. */
  private abortRecognition() {
    window.clearTimeout(this.restartTimer)
    this.discardResults = true
    if (this.recording) {
      this.recording = null
      this.set({ listening: false })
    }
    try {
      this.recognition?.abort()
    } catch {
      // not running
    }
  }

  /** Send the current turn. stop() makes the browser flush its final transcript, then onend finalizes. */
  private commitTurn() {
    if (this.commitPending) return
    this.commitPending = true
    this.set({ pausing: false, sendCountdown: 0 })
    if (this.recording) {
      // Server engine: stop recording and transcribe the turn on the backend
      const chunks = this.recording
      this.recording = null
      this.set({ listening: false })
      this.hooks.onMicLevel(0)
      void this.transcribeRecording(chunks)
      return
    }
    if (!this.state.listening) {
      this.finalizeTurn()
      return
    }
    try {
      this.recognition?.stop()
    } catch {
      // not running
    }
    // Don't hang if the browser never fires onend after stop()
    this.commitFallbackTimer = window.setTimeout(() => this.finalizeTurn(), 1500)
  }

  /** Server engine: upload the recorded turn as WAV, then continue exactly like a browser-transcribed turn. */
  private async transcribeRecording(chunks: Float32Array[]) {
    const session = this.session
    if (chunks.length > 0) {
      const sampleRate = this.monitor?.audioContext.sampleRate || 48000
      this.set({ transcribing: true })
      try {
        const text = await this.hooks.transcribe(encodeWavBlob(chunks, sampleRate))
        if (session !== this.session) return
        this.sessionText = normalizeText(typeof text === 'string' ? text : '')
      } catch (err) {
        if (session !== this.session) return
        console.warn('Transcription failed:', err)
        if (this.state.active) {
          this.set({ error: err instanceof TranscribeError ? err.message : TRANSCRIBE_FAILED })
          if (err instanceof TranscribeError && err.stopListening) this.manualPause = true
        }
      } finally {
        if (session === this.session) this.set({ transcribing: false })
      }
    }
    this.finalizeTurn()
  }

  private finalizeTurn() {
    if (!this.commitPending) return
    window.clearTimeout(this.commitFallbackTimer)
    this.commitPending = false
    if (this.state.listening) this.abortRecognition() // fallback path: drop any late results
    const finalQuery = this.turnText()
    this.resetTurn()
    if (!this.state.active) return
    if (!finalQuery) {
      // Only noise was heard: keep listening once the stopped session has fully ended
      // (unless a transcription error paused hands-free mode)
      if (!this.manualPause) this.restartTimer = window.setTimeout(() => this.startListening(), 300)
      return
    }
    this.hooks.onTurn(finalQuery)
  }

  // ---------------------------------------------------------------- text to speech
  /** Read a reply aloud; listening resumes by itself when Aura finishes, is interrupted, or the engine fails. */
  speak(text: string) {
    const synth = getSynth()
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
      this.startListening()
      return
    }
    // Never listen while Aura talks, or she would transcribe her own voice
    this.abortRecognition()
    synth.cancel()

    const utterance = new SpeechSynthesisUtterance(speakableText(text))
    this.utterance = utterance // also keeps it from being garbage-collected before onend (Chrome)
    const voice = pickVoice(synth)
    if (voice) utterance.voice = voice
    utterance.rate = 1.0
    utterance.pitch = 1.05 // slightly warmer/softer pitch

    const finishSpeaking = () => {
      if (this.utterance !== utterance) return // superseded, or already handled
      this.utterance = null
      this.speechDone = null
      this.set({ speaking: false })
      this.startListening()
    }
    this.speechDone = finishSpeaking
    utterance.onend = finishSpeaking
    utterance.onerror = (e) => {
      if (e.error !== 'interrupted' && e.error !== 'canceled') console.error('Speech Synthesis error:', e)
      finishSpeaking()
    }

    this.set({ speaking: true })
    this.speechStartedAt = Date.now()
    synth.speak(utterance)
  }

  /** Barge-in: stop Aura mid-sentence and start listening right away. */
  private interrupt() {
    getSynth()?.cancel()
    this.speechDone?.()
  }

  // ---------------------------------------------------------------- 100 ms monitor
  /** Mic level meter, 3-second pause auto-send and recovery watchdogs. */
  private tick() {
    const now = Date.now()
    const s = this.state

    if (s.speaking) {
      // Chrome sometimes never fires utterance.onend; recover so Aura still hands the turn back
      const synth = getSynth()
      if (this.speechDone && synth && !synth.speaking && !synth.pending && now - this.speechStartedAt > 1500) this.speechDone()
      return
    }

    if (!s.listening) {
      this.hooks.onMicLevel(0)
      // Hands-free safety net: nothing is using the mic and the student didn't pause it, so listen again
      const idle = s.active && (this.recognition !== null || this.kind === 'server') &&
        !s.loading && !this.commitPending && !this.manualPause
      if (!idle) this.idleSince = 0
      else if (!this.idleSince) this.idleSince = now
      else if (now - this.idleSince > 2000) {
        this.idleSince = 0
        this.startListening(true)
      }
      return
    }
    this.idleSince = 0
    if (this.commitPending) return

    const { voice, level } = readMicActivity(this.monitor)
    this.hooks.onMicLevel(level)
    if (voice) {
      this.lastVoice = now
      this.markSpeechHeard()
    }
    if (!this.heardSpeech) return

    // Server engine: cap one recorded turn so the upload stays small
    const sampleRate = this.monitor?.audioContext.sampleRate || 48000
    if (this.recording && recordedMs(this.recording.length, sampleRate) >= MAX_RECORDING_MS) {
      this.commitTurn()
      return
    }

    const silentFor = now - Math.max(this.lastTextChange, this.lastVoice)
    const transcriptStaleFor = this.turnText() ? now - this.lastTextChange : 0
    if (silentFor >= SILENCE_PAUSE_DELAY || transcriptStaleFor >= STALE_TRANSCRIPT_DELAY) {
      this.commitTurn()
    } else if (silentFor >= PAUSE_INDICATOR_DELAY) {
      this.set({ pausing: true, sendCountdown: Math.ceil((SILENCE_PAUSE_DELAY - silentFor) / 1000) })
      this.hooks.onPauseProgress((silentFor - PAUSE_INDICATOR_DELAY) / (SILENCE_PAUSE_DELAY - PAUSE_INDICATOR_DELAY))
    }
  }

  // ---------------------------------------------------------------- student controls
  /** One button, context-aware: interrupt Aura, send what you said now, pause the mic, or start talking. */
  toggleMic() {
    if (this.state.speaking) {
      this.interrupt()
      return
    }
    if (this.kind === 'browser' && !this.recognition) return
    if (this.state.listening) {
      if (this.heardSpeech) {
        this.commitTurn()
      } else {
        this.manualPause = true
        this.abortRecognition()
      }
    } else {
      this.set({ error: '' })
      this.startListening()
    }
  }

  /** The student typed instead of speaking: stop Aura talking and drop the half-spoken turn. */
  beginTypedTurn() {
    if (this.utterance || this.state.speaking) {
      this.utterance = null
      this.speechDone = null
      getSynth()?.cancel()
      this.set({ speaking: false })
    }
    window.clearTimeout(this.commitFallbackTimer)
    this.commitPending = false
    this.abortRecognition()
    this.resetTurn()
    this.set({ error: '' })
  }
}
