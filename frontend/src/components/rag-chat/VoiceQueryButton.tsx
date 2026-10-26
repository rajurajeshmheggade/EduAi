import { useRef, useState } from 'react'
import { Loader2, Mic, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { transcribe } from '@/services/ragAvatarService'

/** Records a spoken question and sends it to Whisper (/ICMELive/transcribe-audio). */
export function VoiceQueryButton({ onText, disabled }: { onText: (text: string) => void; disabled?: boolean }) {
  const [state, setState] = useState<'idle' | 'recording' | 'transcribing'>('idle')
  const [err, setErr] = useState<string | null>(null)
  const rec = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])

  async function start() {
    setErr(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      chunks.current = []
      mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        setState('transcribing')
        try {
          onText(await transcribe(new Blob(chunks.current, { type: mr.mimeType || 'audio/webm' })))
        } catch (e) {
          setErr(e instanceof Error ? e.message : 'Transcription failed')
        } finally {
          setState('idle')
        }
      }
      mr.start()
      rec.current = mr
      setState('recording')
    } catch {
      setErr('Microphone unavailable')
    }
  }

  return (
    <div className="relative">
      <Button
        variant={state === 'recording' ? 'danger' : 'secondary'}
        size="icon"
        disabled={disabled || state === 'transcribing'}
        onClick={() => (state === 'recording' ? rec.current?.stop() : start())}
        aria-label={state === 'recording' ? 'Stop recording' : 'Ask by voice'}
        title={err ?? (state === 'recording' ? 'Stop & transcribe' : 'Ask by voice')}
        id="voice-query-button"
      >
        {state === 'transcribing' ? <Loader2 className="h-4 w-4 animate-spin" /> : state === 'recording' ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      </Button>
      {state === 'recording' && <span className="pointer-events-none absolute inset-0 animate-pulse-ring rounded-xl border border-bad" />}
      {err && <p role="alert" className="absolute bottom-full right-0 mb-2 w-56 rounded-lg border border-bad/30 bg-ink-900 p-2 text-xs text-bad">{err}</p>}
    </div>
  )
}
