import { Hand, Mic, MicOff, Send, Video, VideoOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { CameraBubble } from './CameraBubble'
import { Captions } from './Captions'
import { useAuraLive } from './useAuraLive'
import { VoiceStatus } from './VoiceStatus'

/** Student ▸ Wellness ▸ Aura Live: hands-free voice (and local video preview) session with Aura (MindAlign AuraLive). */
export function AuraLiveTab() {
  const live = useAuraLive()
  const { voice } = live
  const { active, listening, speaking, loading, transcribing, hearingVoice } = voice

  const micLabel = speaking
    ? 'Interrupt Aura and speak'
    : listening
      ? (hearingVoice ? 'Send what you said to Aura now' : 'Pause the microphone')
      : 'Tap to speak to Aura'
  // Coarse state for screen readers (the visible pill's countdown would be too chatty to announce)
  const phase = !active ? '' : speaking ? 'Aura is speaking' : loading ? 'Aura is answering' : transcribing ? 'Transcribing your words' : listening ? 'Listening' : 'Ready'

  return (
    <div className="mx-auto grid max-w-[900px] gap-6 md:grid-cols-[320px_minmax(0,1fr)]">
      {/* Camera & controls panel */}
      <Card className="flex flex-col items-center gap-5 px-6 py-8 text-center">
        <h4 className="font-display text-base font-semibold text-fg">Live Webcam Feed</h4>

        <CameraBubble
          videoRef={live.videoRef}
          cameraActive={live.cameraActive}
          listening={listening}
          speaking={speaking}
          busy={listening || loading || speaking}
        />

        <span className="sr-only" role="status">{phase}</span>
        {active && <VoiceStatus voice={voice} meterRef={live.levelMeterRef} />}

        <div className="mt-2 flex w-full flex-col gap-3">
          <Button
            onClick={() => void live.toggleSession()}
            variant={active ? 'danger' : 'default'}
            className={cn('w-full', !active && 'from-rose-400 to-purple-500')}
            aria-label={active ? 'Close Live Counseling Session' : 'Start Live Voice & Video Session'}
          >
            {active ? <><VideoOff className="h-4 w-4" />Close Session</> : <><Video className="h-4 w-4" />Start Live Session</>}
          </Button>

          {active && (
            <Button
              onClick={live.toggleMic}
              variant={listening || speaking ? 'outline' : 'secondary'}
              className={cn('w-full', (listening || speaking) && 'border-rose-400/50 bg-rose-400/10 text-rose-400 hover:bg-rose-400/15')}
              disabled={loading || transcribing}
              aria-label={micLabel}
            >
              {speaking ? <><Hand className="h-4 w-4" />Interrupt & Speak</>
                : listening ? (hearingVoice ? <><Send className="h-4 w-4" />Send now</> : <><MicOff className="h-4 w-4" />Pause mic</>)
                  : <><Mic className="h-4 w-4" />Tap to Speak</>}
            </Button>
          )}

          {active && (
            <p className="text-xs leading-snug text-ink-500">
              Hands-free: just talk. Your words appear live, and Aura replies after a 3-second pause.
            </p>
          )}

          {voice.notice && <p role="status" className="text-xs leading-snug text-brand-300">{voice.notice}</p>}
          {voice.error && <p role="alert" className="text-xs leading-snug text-bad">{voice.error}</p>}
        </div>

        <p className="text-[0.7rem] leading-snug text-ink-500">
          Your camera is a private preview on this device. Video is never recorded or uploaded.
        </p>
      </Card>

      {/* Closed captions & transcript panel */}
      <Captions
        captions={live.captions}
        voice={voice}
        pauseProgressRef={live.pauseProgressRef}
        speechSupported={live.speechSupported}
        onSendTyped={live.sendTyped}
      />
    </div>
  )
}
