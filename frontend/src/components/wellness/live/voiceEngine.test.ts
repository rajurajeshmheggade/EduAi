import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecognitionErrorEvent, RecognitionResultEvent, Recognizer } from './speechApi'
import { transcribeFailure } from './transcribeErrors'
import { AuraVoiceEngine, SERVER_STT_UNAVAILABLE, type VoiceEngineHooks, type VoiceState } from './voiceEngine'

/** Minimal Web Speech recognizer: onend fires asynchronously after stop()/abort(), like real browsers. */
class FakeRecognizer implements Recognizer {
  static last: FakeRecognizer | null = null
  continuous = false
  interimResults = false
  lang = ''
  processLocally?: boolean
  onstart: (() => void) | null = null
  onresult: ((event: RecognitionResultEvent) => void) | null = null
  onerror: ((event: RecognitionErrorEvent) => void) | null = null
  onend: (() => void) | null = null
  running = false
  starts = 0
  constructor() { FakeRecognizer.last = this }
  start() {
    if (this.running) throw new Error('InvalidStateError')
    this.running = true
    this.starts++
    this.onstart?.()
  }
  stop() { this.end() }
  abort() { this.end() }
  say(transcript: string, isFinal = false) {
    this.onresult?.({ results: [Object.assign([{ transcript }], { isFinal })] })
  }
  fail(error: string) {
    this.onerror?.({ error })
    this.end()
  }
  private end() {
    if (!this.running) return
    this.running = false
    setTimeout(() => this.onend?.(), 0)
  }
}

type SpeechGlobal = { SpeechRecognition?: unknown }

function setup() {
  const state: Partial<VoiceState> = {}
  const hooks: VoiceEngineHooks = {
    onChange: (patch) => Object.assign(state, patch),
    onMicLevel: () => {},
    onPauseProgress: () => {},
    onTurn: vi.fn(),
    transcribe: vi.fn(),
    serverSttAvailable: () => false,
  }
  const engine = new AuraVoiceEngine()
  engine.connect(hooks)
  return { engine, state, hooks }
}

async function startSession(engine: AuraVoiceEngine) {
  engine.begin()
  expect(await engine.startVoice()).toBe(true)
  engine.speak('Welcome to Aura Live!') // jsdom has no speechSynthesis, so listening starts straight away
  const rec = FakeRecognizer.last
  if (!rec) throw new Error('recognizer not created')
  return rec
}

describe('AuraVoiceEngine (browser speech engine)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeRecognizer.last = null
    ;(window as unknown as SpeechGlobal).SpeechRecognition = FakeRecognizer
  })
  afterEach(() => {
    delete (window as unknown as SpeechGlobal).SpeechRecognition
    vi.useRealTimers()
  })

  it('shows live words, counts down the pause and sends the turn after 3 seconds of silence', async () => {
    const { engine, state, hooks } = setup()
    const rec = await startSession(engine)
    expect(rec.starts).toBe(1)
    expect(rec.continuous && rec.interimResults).toBe(true)
    expect(state.listening).toBe(true)

    rec.say('I feel stressed about')
    rec.say('I feel stressed about my mock tests')
    expect(state.liveInterim).toBe('I feel stressed about my mock tests')
    expect(state.hearingVoice).toBe(true)

    vi.advanceTimersByTime(1500)
    expect(state.pausing).toBe(true)
    expect(state.sendCountdown).toBe(2)
    expect(hooks.onTurn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1600) // pause reached: stop() flushes, onend finalizes
    vi.advanceTimersByTime(10)
    expect(hooks.onTurn).toHaveBeenCalledWith('I feel stressed about my mock tests')
    expect(state.liveInterim).toBe('')
    engine.stop()
  })

  it('keeps the words when the browser ends recognition by itself, and resumes listening', async () => {
    const { engine, state, hooks } = setup()
    const rec = await startSession(engine)
    rec.say('Physics is hard', true)
    rec.stop() // browser silence timeout
    vi.advanceTimersByTime(300)
    expect(rec.starts).toBe(2)
    rec.say('and so is chemistry')
    expect(state.liveInterim).toBe('Physics is hard and so is chemistry')
    vi.advanceTimersByTime(3200)
    expect(hooks.onTurn).toHaveBeenCalledWith('Physics is hard and so is chemistry')
    engine.stop()
  })

  it('pauses the mic on request and does not restart it hands-free', async () => {
    const { engine, state } = setup()
    const rec = await startSession(engine)
    engine.toggleMic() // nothing said yet: "Pause mic"
    vi.advanceTimersByTime(5000)
    expect(state.listening).toBe(false)
    expect(rec.starts).toBe(1)
    engine.toggleMic() // "Tap to Speak"
    expect(rec.starts).toBe(2)
    engine.stop()
  })

  it('stops retrying and explains a blocked microphone', async () => {
    const { engine, state } = setup()
    const rec = await startSession(engine)
    rec.fail('not-allowed')
    vi.advanceTimersByTime(5000)
    expect(state.error).toMatch(/Microphone access is blocked/)
    expect(rec.starts).toBe(1)
    engine.stop()
  })

  it('drops the half-spoken turn when the student types instead', async () => {
    const { engine, state, hooks } = setup()
    const rec = await startSession(engine)
    rec.say('I was saying something')
    engine.beginTypedTurn()
    engine.setLoading(true) // what the UI does while Aura answers the typed message
    vi.advanceTimersByTime(5000)
    expect(state.liveInterim).toBe('')
    expect(hooks.onTurn).not.toHaveBeenCalled()
    expect(rec.starts).toBe(1)
    engine.setLoading(false)
    engine.speak('Here is my reply') // no TTS in jsdom: hands the turn straight back
    expect(rec.starts).toBe(2)
    engine.stop()
  })

  it('releases everything on stop and ignores late recognizer events', async () => {
    const { engine, state, hooks } = setup()
    const rec = await startSession(engine)
    rec.say('hello')
    engine.setActive(false)
    engine.stop()
    vi.advanceTimersByTime(5000)
    expect(state.listening).toBe(false)
    expect(state.liveInterim).toBe('')
    expect(rec.onresult).toBeNull()
    expect(hooks.onTurn).not.toHaveBeenCalled()
  })
})

describe('transcribeFailure', () => {
  const httpError = (status: number) =>
    new AxiosError('Request failed', 'ERR_BAD_RESPONSE', undefined, undefined, {
      status, statusText: '', data: { detail: 'server detail' }, headers: {}, config: { headers: new AxiosHeaders() },
    } as AxiosResponse)

  it('maps the backend status codes to friendly notices', () => {
    expect(transcribeFailure(httpError(503))).toMatchObject({ message: SERVER_STT_UNAVAILABLE, stopListening: true })
    expect(transcribeFailure(httpError(429)).stopListening).toBe(true)
    expect(transcribeFailure(httpError(413)).message).toMatch(/under a minute/)
    expect(transcribeFailure(httpError(502))).toMatchObject({ stopListening: false })
    expect(transcribeFailure(new Error('offline')).message).toBe("Aura couldn't transcribe that (offline). Please try again.")
  })
})
