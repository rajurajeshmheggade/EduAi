import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '@/components/ui/toast'
import { useWellness } from '@/components/wellness/WellnessContext'
import { wellnessService } from '@/services/wellnessService'
import type { Helpline } from '@/types/wellness'
import { canRecordForServer, getRecognizerConstructor, normalizeText } from './speechApi'
import { useCamera } from './useCamera'
import { httpStatus, transcribeFailure } from './transcribeErrors'
import { AuraVoiceEngine, INITIAL_VOICE_STATE, type VoiceState } from './voiceEngine'

export interface Caption {
  id: number
  sender: 'Student' | 'Aura'
  role: 'user' | 'model'
  text: string
  /** Set when a server safety guardrail answered instead of the AI. */
  guardrailType?: string
  helplines?: Helpline[]
}

// Offline reply must stay crisis-safe: the server-side helpline guardrail can't run when the request fails
const OFFLINE_REPLY =
  'I am having trouble connecting to my servers right now, but please take a deep breath. Inhale for 4 seconds, hold for 4, and exhale for 4. If you feel unsafe or overwhelmed, please call Tele-MANAS at 14416 or KIRAN at 1800-599-0019, free and available 24x7. What is bothering you?'
const AI_OFFLINE_NOTICE = "Aura's AI is offline on this server, so her replies are generic."

let captionSeq = 0
const caption = (c: Omit<Caption, 'id'>): Caption => ({ ...c, id: ++captionSeq })

type AddCaption = (c: Omit<Caption, 'id'>) => void

/** Send one turn to Aura (the server adds history, student context and journal references) and speak the reply. */
async function askAura(engine: AuraVoiceEngine, text: string, addCaption: AddCaption) {
  engine.setLoading(true)
  try {
    const r = await wellnessService.chat(text, { channel: 'live' })
    if (typeof r.reply !== 'string' || !r.reply.trim()) throw new Error('Empty reply')
    if (r.aiSource === 'fallback') engine.setNotice(AI_OFFLINE_NOTICE)
    addCaption({
      sender: 'Aura', role: 'model', text: r.reply,
      guardrailType: r.guardrailTriggered ? (r.guardrailType ?? 'safety') : undefined,
      helplines: r.helplines ? Object.values(r.helplines) : undefined,
    })
    engine.setLoading(false)
    // Read output aloud; listening resumes by itself when Aura finishes
    if (engine.active) engine.speak(r.reply)
  } catch (e) {
    console.error('Aura reply failed:', e)
    engine.setLoading(false)
    addCaption({ sender: 'Aura', role: 'model', text: OFFLINE_REPLY })
    if (engine.active) engine.speak(OFFLINE_REPLY)
  }
}

/** Aura Live session state: camera preview, voice engine, captions and the typed fallback. */
export function useAuraLive() {
  const { context, meta } = useWellness()
  const [voice, setVoice] = useState<VoiceState>(INITIAL_VOICE_STATE)
  const [captions, setCaptions] = useState<Caption[]>([])
  const levelMeterRef = useRef<HTMLDivElement | null>(null)
  const pauseProgressRef = useRef<HTMLDivElement | null>(null)
  const aiEnabledRef = useRef(meta?.aiEnabled !== false)
  const sttDownRef = useRef(false)
  const gradeRef = useRef(context.gradeLabel)
  useEffect(() => {
    aiEnabledRef.current = meta?.aiEnabled !== false
    gradeRef.current = context.gradeLabel
  }, [meta, context.gradeLabel])

  const { videoRef, active: cameraActive, start: startCamera, stop: stopCamera } = useCamera()
  const addCaption = useCallback<AddCaption>((c) => setCaptions((xs) => [...xs, caption(c)]), [])

  const [engine] = useState(() => new AuraVoiceEngine())

  useEffect(() => {
    engine.connect({
      onChange: (patch) => setVoice((v) => ({ ...v, ...patch })),
      // Meter and progress bar are updated through the DOM (10x per second) instead of re-rendering React
      onMicLevel: (level) => levelMeterRef.current?.style.setProperty('--mic-level', level.toFixed(3)),
      onPauseProgress: (fraction) => {
        const el = pauseProgressRef.current
        if (el) el.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`
      },
      onTurn: (text) => {
        addCaption({ sender: 'Student', role: 'user', text })
        void askAura(engine, text, addCaption)
      },
      transcribe: async (wav) => {
        try {
          return await wellnessService.transcribe(wav)
        } catch (e) {
          if (httpStatus(e) === 503) sttDownRef.current = true // no AI provider: stop offering server transcription
          throw transcribeFailure(e)
        }
      },
      serverSttAvailable: () => aiEnabledRef.current && !sttDownRef.current && canRecordForServer(),
    })
    // Release camera, microphone, AudioContext and speech when the tab closes
    return () => {
      engine.setActive(false)
      engine.stop()
      engine.disconnect()
      stopCamera()
    }
  }, [engine, addCaption, stopCamera])

  const toggleSession = useCallback(async () => {
    if (engine.active) {
      engine.setActive(false)
      engine.stop()
      stopCamera()
      addCaption({
        sender: 'Aura', role: 'model',
        text: `Session closed. Remember that taking breaks and studying in focus blocks is key to doing well in ${gradeRef.current || 'school'}. Let me know if you need to talk again!`,
      })
      return
    }
    engine.begin() // inside the click: Chrome may download its on-device speech model in the background
    const session = engine.sessionId
    const stillOpen = () => engine.active && engine.sessionId === session
    setCaptions([])
    const cameraOn = await startCamera(stillOpen)
    if (!stillOpen()) return // closed while the camera was starting
    if (!cameraOn) toast('Camera unavailable, so Aura Live continues with voice only.', 'info')

    const welcome = `Welcome to Aura Live! I'm your digital counseling speaker. Just talk naturally and I'll reply when you pause. How are you feeling about your ${gradeRef.current ? `${gradeRef.current} studies` : 'studies'} today?`
    setCaptions([caption({ sender: 'Aura', role: 'model', text: welcome })])
    // Voice engine + pause detector; listening starts by itself as soon as the welcome finishes
    if (!(await engine.startVoice())) return
    engine.speak(welcome)
  }, [engine, startCamera, stopCamera, addCaption])

  const toggleMic = useCallback(() => engine.toggleMic(), [engine])

  /** Typed fallback: same conversation, Aura still answers aloud. Returns whether the text was sent. */
  const sendTyped = useCallback((raw: string): boolean => {
    const text = normalizeText(raw)
    if (!text || !engine.active || engine.loading || engine.transcribing) return false
    engine.beginTypedTurn()
    addCaption({ sender: 'Student', role: 'user', text })
    void askAura(engine, text, addCaption)
    return true
  }, [engine, addCaption])

  // Voice works with the browser's speech recognition, or in any browser that can record audio for the server
  const speechSupported = useMemo(
    () => !!getRecognizerConstructor() || (canRecordForServer() && meta?.aiEnabled !== false),
    [meta?.aiEnabled],
  )

  return {
    voice, captions, cameraActive, videoRef, levelMeterRef, pauseProgressRef, speechSupported,
    toggleSession, toggleMic, sendTyped,
  }
}
