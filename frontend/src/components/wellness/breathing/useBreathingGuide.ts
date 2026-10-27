import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BREATH_INTRO_CUE,
  BREATH_LEAD_IN_MS,
  BREATH_VOICE_RATE,
  DEFAULT_VOICE_LEAD_MS,
  MAX_VOICE_WAIT_MS,
  buildSessionEndCue,
  getBreathPosition,
  getPhaseStartMs,
  nextVoiceLead,
  pickCalmVoice,
} from './breathVoice'
import { BREATH_MODES, type BreathMode, type BreathModeKey, type BreathStep } from './modes'

// Per-device preference only (the student's choice of spoken guide); nothing that matters is kept in the browser.
const VOICE_PREF_KEY = 'eduai.wellness.breathVoice'
// How often the session clock is read (keeps the bubble and the voice within a frame or two of each other)
const TICK_MS = 40

/* One clock for the whole session: the bubble, the countdown and the voice are all derived from `startAt`
   (the moment the first inhale starts), so they cannot drift apart however long the session runs.
   `pendingPhase` is the phase whose cue has been sent to the speech engine but is not audible yet. */
interface SessionClock {
  sequence: readonly BreathStep[]
  startAt: number
  announcedPhase: number
  pendingPhase: number | null
  captionPhase: number
  cyclesAwarded: number
}
const newClock = (sequence: readonly BreathStep[], startAt: number): SessionClock =>
  ({ sequence, startAt, announcedPhase: -1, pendingPhase: null, captionPhase: -1, cyclesAwarded: 0 })

const speechSupported = () =>
  typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function'

function readVoicePref(): boolean {
  try { return localStorage.getItem(VOICE_PREF_KEY) !== 'off' } catch { return true }
}

export interface BreathingGuide {
  modeKey: BreathModeKey
  mode: BreathMode
  step: BreathStep
  isPlaying: boolean
  /** "Get ready" countdown between pressing Begin and the first inhale. */
  isPreparing: boolean
  isBreathing: boolean
  secondsRemaining: number
  cycles: number
  voiceSupported: boolean
  voiceOn: boolean
  /** What the guide is saying (or last said). */
  caption: string
  isSpeaking: boolean
  start: () => void
  /** Ends the session and returns the cycles completed in it. */
  stop: () => number
  toggleVoice: () => void
  changeMode: (key: BreathModeKey) => void
}

/** The breathing session engine (MindAlign BreathingBubble logic): session clock, voice-over locked to it, cycle count. */
export function useBreathingGuide(onCycleComplete: (mode: BreathMode) => void): BreathingGuide {
  const [modeKey, setModeKey] = useState<BreathModeKey>('BOX')
  const [isPlaying, setIsPlaying] = useState(false)
  const [isPreparing, setIsPreparing] = useState(false)
  const [stepIdx, setStepIdx] = useState(0)
  const [secondsRemaining, setSecondsRemaining] = useState(BREATH_MODES.BOX.sequence[0].duration)
  const [cycles, setCycles] = useState(0)
  // Voice-over guide: on unless the student turned it off earlier
  const [voiceOn, setVoiceOn] = useState(readVoicePref)
  const [caption, setCaption] = useState('')
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [voiceSupported] = useState(speechSupported)

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const sessionRef = useRef<SessionClock>(newClock(BREATH_MODES.BOX.sequence, 0))
  const voiceLeadRef = useRef(DEFAULT_VOICE_LEAD_MS)
  const tickRef = useRef<(() => void) | null>(null)
  // The clock callback outlives the render that created it, so it reads live values from refs
  const voiceOnRef = useRef(voiceOn)
  const onCycleRef = useRef(onCycleComplete)
  useEffect(() => {
    voiceOnRef.current = voiceOn
    onCycleRef.current = onCycleComplete
  })

  const mode = BREATH_MODES[modeKey]

  /* Read a cue aloud; its caption appears the moment the voice actually starts.
     `phase` is the breathing phase the cue belongs to (omitted for the intro and the closing line).
     Returns true when the cue was handed to the speech engine. */
  const speakCue = useCallback((text: string, phase?: number): boolean => {
    if (!speechSupported() || !text) return false
    const synth = window.speechSynthesis
    const session = sessionRef.current
    // Breathing cues queue behind whatever is still being said (only the short intro can overlap them);
    // the closing line replaces it. Cancelling an idle engine would only delay the next cue in Chromium.
    const wasBusy = synth.speaking || synth.pending
    if (phase === undefined && wasBusy) synth.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    const voice = pickCalmVoice(synth.getVoices())
    if (voice) utterance.voice = voice
    utterance.rate = BREATH_VOICE_RATE
    const spokenAt = performance.now()
    utterance.onstart = () => {
      if (utteranceRef.current !== utterance) return // replaced by a newer cue
      if (phase !== undefined && sessionRef.current === session) {
        const now = performance.now()
        // Learn how long this engine takes to start talking, so the next cue is sent that early
        // (a cue that had to queue behind the intro says nothing about the engine)
        if (!wasBusy) voiceLeadRef.current = nextVoiceLead(voiceLeadRef.current, now - spokenAt)
        if (session.pendingPhase === phase) {
          // Lock the bubble to the voice: this phase begins at the instant its cue becomes audible
          session.startAt = now - getPhaseStartMs(session.sequence, phase)
          session.pendingPhase = null
        }
        session.captionPhase = phase
      }
      setCaption(text)
      setIsSpeaking(true)
      tickRef.current?.() // move the bubble now, not on the next tick
    }
    const finish = () => {
      // A cue that failed before it started must not keep the bubble waiting
      if (phase !== undefined && session.pendingPhase === phase) session.pendingPhase = null
      if (utteranceRef.current === utterance) setIsSpeaking(false)
    }
    utterance.onend = finish
    utterance.onerror = finish
    utteranceRef.current = utterance // also keeps the utterance alive until it finishes
    synth.speak(utterance)
    return true
  }, [])

  const stopVoice = useCallback(() => {
    utteranceRef.current = null
    sessionRef.current.pendingPhase = null
    if (speechSupported()) window.speechSynthesis.cancel()
    setIsSpeaking(false)
    setCaption('')
  }, [])

  // Never keep talking after the student leaves the Breathing tab
  useEffect(() => () => {
    utteranceRef.current = null
    if (speechSupported()) window.speechSynthesis.cancel()
  }, [])

  // Session clock: every tick reads the time and derives the phase, the countdown and the next voice cue from it
  useEffect(() => {
    if (!isPlaying) return
    const sequence = BREATH_MODES[modeKey].sequence
    const session = sessionRef.current

    const tick = () => {
      let elapsed = performance.now() - session.startAt // negative during the "get ready" lead-in

      // A cue is on its way: the bubble changes phase when the voice starts (see speakCue), so if the voice is
      // a little late, hold the current phase for it rather than letting the bubble run ahead.
      if (session.pendingPhase !== null) {
        const boundary = getPhaseStartMs(sequence, session.pendingPhase)
        if (elapsed >= boundary) {
          if (elapsed - boundary < MAX_VOICE_WAIT_MS) {
            elapsed = boundary - 1
          } else {
            // The voice never started: carry on without it, starting the phase now
            session.startAt += elapsed - boundary
            session.pendingPhase = null
            elapsed = boundary
          }
        }
      }
      const position = elapsed < 0 ? null : getBreathPosition(sequence, elapsed)

      // Voice-over: send the next phase's cue early by the speech engine's usual start-up delay, so it becomes
      // audible right on the phase change. A cue that is already late is skipped, never spoken late.
      const upcomingPhase = position ? position.phase + 1 : 0
      const upcomingAt = position ? position.nextPhaseAtMs : 0
      if (voiceOnRef.current && session.announcedPhase < upcomingPhase && elapsed >= upcomingAt - voiceLeadRef.current) {
        session.announcedPhase = upcomingPhase
        if (speakCue(sequence[upcomingPhase % sequence.length].voice, upcomingPhase)) session.pendingPhase = upcomingPhase
      }

      if (!position) {
        setIsPreparing(true)
        setSecondsRemaining(Math.ceil(-elapsed / 1000))
        return
      }
      setIsPreparing(false)
      setStepIdx(position.stepIdx)
      setSecondsRemaining(position.secondsRemaining)
      setCycles(position.cycle)
      while (session.cyclesAwarded < position.cycle) {
        session.cyclesAwarded++
        onCycleRef.current(BREATH_MODES[modeKey])
      }
      // Caption safety net: if the engine never reported that the cue started, still show it on the phase change
      if (voiceOnRef.current && session.captionPhase < position.phase) {
        session.captionPhase = position.phase
        setCaption(sequence[position.stepIdx].voice)
      }
    }

    tickRef.current = tick
    tick()
    const timer = window.setInterval(tick, TICK_MS)
    return () => {
      window.clearInterval(timer)
      tickRef.current = null
    }
  }, [isPlaying, modeKey, speakCue])

  const start = () => {
    sessionRef.current = newClock(mode.sequence, performance.now() + BREATH_LEAD_IN_MS)
    setIsPreparing(true)
    setIsPlaying(true)
    setStepIdx(0)
    setSecondsRemaining(Math.ceil(BREATH_LEAD_IN_MS / 1000))
    setCycles(0)
    // Spoken inside the click, which also warms up the speech engine before the first breathing cue
    if (voiceOn) speakCue(BREATH_INTRO_CUE)
  }

  const stop = () => {
    setIsPlaying(false)
    setIsPreparing(false)
    setStepIdx(0)
    setSecondsRemaining(mode.sequence[0].duration)
    if (voiceOn) speakCue(buildSessionEndCue(cycles))
    return cycles
  }

  const toggleVoice = () => {
    const next = !voiceOn
    setVoiceOn(next)
    voiceOnRef.current = next // the session clock must not send another cue before the next render
    try { localStorage.setItem(VOICE_PREF_KEY, next ? 'on' : 'off') } catch { /* private mode */ }
    if (!next) stopVoice()
  }

  const changeMode = (key: BreathModeKey) => {
    stopVoice()
    setIsPlaying(false)
    setIsPreparing(false)
    setModeKey(key)
    setStepIdx(0)
    setSecondsRemaining(BREATH_MODES[key].sequence[0].duration)
    setCycles(0)
  }

  return {
    modeKey, mode, step: mode.sequence[stepIdx] ?? mode.sequence[0], isPlaying, isPreparing,
    isBreathing: isPlaying && !isPreparing, secondsRemaining, cycles,
    voiceSupported, voiceOn, caption, isSpeaking,
    start, stop, toggleVoice, changeMode,
  }
}
