import { useCallback, useEffect, useRef } from 'react'
import { Play, Square, Volume2, VolumeX, Wind } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { AmbientSoundControls } from '@/components/wellness/audio/AmbientSoundControls'
import { useAmbientSound } from '@/components/wellness/audio/ambientAudio'
import { useWellness } from '@/components/wellness/WellnessContext'
import { cn } from '@/lib/utils'
import { BreathingBubble, VoiceCaption } from './BreathingBubble'
import { BREATH_MODES, BREATH_MODE_KEYS } from './modes'
import { useActivityXp } from './useActivityXp'
import { useBreathingGuide } from './useBreathingGuide'
import { useReducedMotion } from './useReducedMotion'

const ROSE_BTN = 'from-rose-400 to-rose-600 shadow-[0_10px_28px_-12px_rgb(225_29_72/0.55)]'
const ACTIVE_CHIP = 'border-rose-400/70 bg-rose-50 text-rose-600 hover:border-rose-400/70 hover:bg-rose-50'

/** Wellness ▸ Breathing — MindAlign's guided Box (4-4-4-4) and 4-7-8 breathing with a spoken, captioned guide. */
export function BreathingTab() {
  const { alert, meta, refresh } = useWellness()
  const { report, settled } = useActivityXp()
  const reducedMotion = useReducedMotion()
  // Optional background sound under the voice (same synthesised sounds as the Focus timer)
  const { soundPlaying, toggleSound, stopSound } = useAmbientSound()
  // Cycles reported since the profile (and its server-side breathCycles count) was last refreshed
  const unsyncedRef = useRef(0)

  const guide = useBreathingGuide((mode) => {
    unsyncedRef.current++
    report('breathing_cycle', 'Breathing Cycle Done', mode.name)
  })

  // Once the reported cycles are saved, reload the profile so the Dashboard's cycle count is current
  const syncProfile = useCallback(() => {
    if (!unsyncedRef.current) return
    unsyncedRef.current = 0
    void settled().then(refresh).catch(() => {})
  }, [settled, refresh])
  // ...also when the student leaves the tab mid-session
  useEffect(() => syncProfile, [syncProfile])

  const xpEach = meta?.xpRules?.breathing_cycle ?? 30
  const voiceActive = guide.voiceSupported && guide.voiceOn
  const phaseText = guide.isBreathing ? guide.step.action : guide.isPlaying ? 'Get ready' : ''

  const handleStartStop = () => {
    if (!guide.isPlaying) {
      guide.start()
      return
    }
    const done = guide.stop()
    alert(
      'Breathing Stopped',
      `Session ended. You completed ${done} cycles this turn! Short breathing patterns help oxygenate the cortex for better study concentration.`,
    )
    syncProfile()
  }

  return (
    <Card className="mx-auto flex w-full max-w-[600px] flex-col gap-6 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wind className="h-6 w-6 text-rose-400" aria-hidden />
          <h2 className="font-display text-lg font-semibold text-fg">Mindful Breathing</h2>
        </div>
        <div className="flex gap-2" role="group" aria-label="Breathing pattern">
          {BREATH_MODE_KEYS.map((key) => (
            <Button key={key} size="sm" variant="secondary" onClick={() => guide.changeMode(key)} disabled={guide.isPlaying}
              aria-pressed={guide.modeKey === key} aria-label={BREATH_MODES[key].aria}
              className={cn(guide.modeKey === key && ACTIVE_CHIP)}>
              {BREATH_MODES[key].short}
            </Button>
          ))}
        </div>
      </div>

      <p className="text-sm leading-relaxed text-ink-300">{guide.mode.description}</p>

      <BreathingBubble step={guide.step} isPlaying={guide.isPlaying} isBreathing={guide.isBreathing}
        secondsRemaining={guide.secondsRemaining} reducedMotion={reducedMotion} />

      {/* With the voice guide on, the captions are announced; otherwise the phase changes are */}
      <VoiceCaption text={guide.caption} speaking={guide.isSpeaking}
        visible={voiceActive && (guide.isPlaying || guide.isSpeaking)} />
      <p className="sr-only" aria-live="polite">{voiceActive ? '' : phaseText}</p>

      <div className="flex flex-col gap-2 text-center text-sm">
        {guide.isPlaying ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="text-ink-300">Cycles Completed:</span>
            <strong className="text-lg tabular-nums text-rose-500">{guide.cycles}</strong>
            <Badge tone="ok">+{xpEach} XP each!</Badge>
          </div>
        ) : (
          <span className="text-ink-300">Click begin to start breathing guide</span>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button onClick={handleStartStop} variant={guide.isPlaying ? 'secondary' : 'default'}
          className={cn('w-full max-w-60', !guide.isPlaying && ROSE_BTN)}>
          {guide.isPlaying
            ? <><Square className="h-4 w-4" aria-hidden />Stop Session</>
            : <><Play className="h-4 w-4" aria-hidden />Begin Breathing</>}
        </Button>
        {guide.voiceSupported && (
          <Button variant="secondary" onClick={guide.toggleVoice} aria-pressed={guide.voiceOn}
            title={guide.voiceOn ? 'Turn off the spoken breathing guide' : 'Turn on the spoken breathing guide'}
            className={cn(guide.voiceOn && 'border-rose-400/70')}>
            {guide.voiceOn ? <Volume2 className="h-4 w-4" aria-hidden /> : <VolumeX className="h-4 w-4" aria-hidden />}
            {/* The state is announced by aria-pressed, so the accessible name stays "Voice guide" */}
            <span>Voice guide <span aria-hidden>{guide.voiceOn ? 'on' : 'off'}</span></span>
          </Button>
        )}
      </div>

      {/* Background audio synthesiser controls (the same sounds as the Focus timer) */}
      <AmbientSoundControls title="Calming Synthesized Audio" muteLabel="Mute background audio"
        soundPlaying={soundPlaying} onToggle={toggleSound} onMute={stopSound} />
    </Card>
  )
}
