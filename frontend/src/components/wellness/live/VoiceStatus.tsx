import type { RefObject } from 'react'
import { Loader2, Volume2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { VoiceState } from './voiceEngine'

// Relative heights of the live mic level meter bars
const METER_BARS = [0.45, 0.65, 0.8, 0.65, 0.45]
const WAVE_KEYFRAMES = '@keyframes aura-voice-wave{0%,100%{transform:scaleY(.25)}50%{transform:scaleY(.95)}}'

/** "Listening / Aura is speaking / Transcribing…" pill with the live mic level meter. The meter's
    `--mic-level` is written straight to the DOM by the voice engine, ten times a second. */
export function VoiceStatus({ voice, meterRef }: { voice: VoiceState; meterRef: RefObject<HTMLDivElement | null> }) {
  const { listening, speaking, loading, transcribing, pausing, sendCountdown, hearingVoice } = voice
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[0.8rem] font-semibold',
        listening
          ? 'border-rose-400/35 bg-rose-400/10 text-rose-400'
          : speaking
            ? 'border-purple-500/35 bg-purple-500/10 text-purple-600'
            : 'border-purple-500/20 bg-ink-800 text-ink-300',
      )}
    >
      {(listening || speaking) && (
        <div ref={meterRef} className="flex h-4 items-center gap-[3px]" aria-hidden="true">
          {speaking && <style>{WAVE_KEYFRAMES}</style>}
          {METER_BARS.map((weight, i) => (
            <span
              key={i}
              className="h-full w-[3px] rounded-sm bg-current transition-transform duration-100 ease-linear"
              style={speaking
                // While Aura speaks, the bars pulse on their own
                ? { animation: `aura-voice-wave 0.9s ease-in-out ${i * 0.12}s infinite` }
                : { transform: `scaleY(calc(0.2 + var(--mic-level, 0) * ${weight}))` }}
            />
          ))}
        </div>
      )}
      {listening && (
        <span>{pausing ? `Paused, sending in ${sendCountdown}s...` : hearingVoice ? 'Hearing you...' : 'Listening, just talk...'}</span>
      )}
      {speaking && (
        <>
          <Volume2 className="h-3.5 w-3.5" aria-hidden />
          <span>Aura is speaking...</span>
        </>
      )}
      {transcribing && (
        <>
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          <span>Transcribing your words...</span>
        </>
      )}
      {!listening && !speaking && !loading && !transcribing && <span>Ready</span>}
      {loading && (
        <>
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          <span>Aura is answering...</span>
        </>
      )}
    </div>
  )
}
