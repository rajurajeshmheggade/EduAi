import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import type { BreathStep } from './modes'

// Relative heights of the voice-over level bars
const VOICE_BARS = [0.45, 0.65, 0.8, 0.65, 0.45]

const CSS = `
@keyframes wl-voice-bar { 0%, 100% { transform: scaleY(0.25); } 50% { transform: scaleY(0.95); } }
.wl-voice-bar { width: 3px; border-radius: 2px; background: currentColor; transform: scaleY(0.35); }
.wl-voice-meter[data-speaking='true'] .wl-voice-bar { animation: wl-voice-bar 0.9s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .wl-voice-meter[data-speaking='true'] .wl-voice-bar { animation: none; transform: scaleY(0.8); }
}
`

const HIGHLIGHT = 'radial-gradient(circle at 32% 28%, rgb(255 255 255 / 0.5), rgb(255 255 255 / 0) 60%)'

/** The breathing bubble: grows on the inhale, holds, shrinks on the exhale (colour only with reduced motion). */
export function BreathingBubble({ step, isPlaying, isBreathing, secondsRemaining, reducedMotion }: {
  step: BreathStep
  isPlaying: boolean
  isBreathing: boolean
  secondsRemaining: number
  reducedMotion: boolean
}) {
  const style: CSSProperties = isBreathing
    ? {
        transform: reducedMotion ? 'none' : `scale(${step.scale})`,
        backgroundColor: step.color,
        backgroundImage: HIGHLIGHT,
        boxShadow: `0 0 40px ${step.color}66, inset 0 -14px 28px rgb(15 23 42 / 0.14)`,
        transition: reducedMotion
          ? 'background-color 0.5s ease, box-shadow 0.5s ease'
          : `transform ${step.duration}s linear, background-color 0.5s ease, box-shadow 0.5s ease`,
      }
    : { transform: 'scale(1)', transition: reducedMotion ? 'none' : 'all 0.5s ease' }

  return (
    <div className="flex h-[220px] w-full items-center justify-center">
      <style>{CSS}</style>
      <div style={style}
        className={cn('flex h-40 w-40 flex-col items-center justify-center gap-1 rounded-full text-center font-display will-change-transform',
          isBreathing ? 'text-white [text-shadow:0_2px_4px_rgb(15_23_42/0.35)]' : 'border-2 border-dashed border-rose-400/70 bg-rose-50/70 text-fg')}>
        <span className="text-2xl font-extrabold">{isBreathing ? step.action : isPlaying ? 'Get ready' : 'Ready'}</span>
        <span className={cn('text-base tabular-nums', isBreathing ? 'opacity-90' : 'text-ink-300')}>{isPlaying ? `${secondsRemaining}s` : 'Focus'}</span>
      </div>
    </div>
  )
}

/** Voice-over caption: what the guide is saying right now, with level bars that move while it speaks.
    The live region stays mounted (so screen readers announce each new caption); only the pill comes and goes. */
export function VoiceCaption({ text, speaking, visible }: { text: string; speaking: boolean; visible: boolean }) {
  return (
    <div className="flex justify-center" role="status" aria-live="polite">
      {visible && text && (
        <div className={cn('flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors',
          speaking ? 'border-purple-300 bg-purple-50 text-purple-700' : 'border-line bg-ink-800 text-ink-300')}>
          <span className="wl-voice-meter flex h-4 items-center gap-[3px]" data-speaking={speaking} aria-hidden>
            {VOICE_BARS.map((weight, i) => (
              <span key={i} className="wl-voice-bar" style={{ height: `${weight * 100}%`, animationDelay: `${i * 0.12}s` }} />
            ))}
          </span>
          <span>{text}</span>
        </div>
      )}
    </div>
  )
}
