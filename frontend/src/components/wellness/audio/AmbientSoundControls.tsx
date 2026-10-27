import { Volume2, VolumeX } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AmbientSoundId } from './ambientAudio'

const SOUNDS: { id: AmbientSoundId; label: string; aria: string }[] = [
  { id: 'waves', label: 'Ocean Waves', aria: 'Toggle synthesized ocean waves background sound' },
  { id: 'binaural', label: 'Binaural 10Hz', aria: 'Toggle synthesized ten hertz alpha binaural beats sound' },
]

const tile =
  'flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-medium transition-colors ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

/** The three-button synthesised-audio grid shared by the breathing guide and the Focus timer. */
export function AmbientSoundControls({ title, muteLabel, soundPlaying, onToggle, onMute }: {
  title: string
  muteLabel: string
  soundPlaying: AmbientSoundId | null
  onToggle: (id: AmbientSoundId) => void
  onMute: () => void
}) {
  return (
    <div className="border-t border-line pt-4" role="group" aria-label={title}>
      <span className="mb-3 block text-xs text-ink-300">{title}</span>
      <div className="grid grid-cols-3 gap-3">
        {SOUNDS.map((s) => {
          const on = soundPlaying === s.id
          return (
            <button key={s.id} type="button" onClick={() => onToggle(s.id)} aria-pressed={on} aria-label={s.aria}
              className={cn(tile, on
                ? 'border-rose-400/60 bg-rose-50 text-rose-600'
                : 'border-purple-200 bg-ink-900 text-ink-300 hover:border-purple-300 hover:bg-purple-50/60 hover:text-fg')}>
              <Volume2 className="h-4 w-4" aria-hidden />
              <span>{s.label}</span>
            </button>
          )
        })}
        <button type="button" onClick={onMute} disabled={!soundPlaying} aria-label={muteLabel}
          className={cn(tile, 'border-purple-200 bg-ink-900 text-ink-300 hover:border-purple-300 hover:text-fg')}>
          <VolumeX className="h-4 w-4" aria-hidden />
          <span>Mute</span>
        </button>
      </div>
    </div>
  )
}
