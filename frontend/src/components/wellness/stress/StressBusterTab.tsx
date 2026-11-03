import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Gamepad2, Heart, Play, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAudioContext } from '@/components/wellness/audio/ambientAudio'
import { playPopSound } from '@/components/wellness/audio/sfx'
import { useActivityXp } from '@/components/wellness/breathing/useActivityXp'
import { useReducedMotion } from '@/components/wellness/breathing/useReducedMotion'
import { celebrate, useWellness } from '@/components/wellness/WellnessContext'
import { cn } from '@/lib/utils'
import { AFFIRMATIONS, POINTS_PER_POP, QUEST_TARGET, pick, stressThoughts } from './content'
import { useBalloonField, type Balloon } from './useBalloonField'

const CSS = `
@keyframes wl-balloon-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
@keyframes wl-balloon-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes wl-slide-up { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
.wl-balloon-float { animation: wl-balloon-float 3s ease-in-out infinite; }
.wl-balloon-still { animation: wl-balloon-in 0.4s ease-out both; }
.wl-affirm { animation: wl-slide-up 0.2s ease-out; }
@media (prefers-reduced-motion: reduce) { .wl-balloon-float, .wl-affirm { animation: none; } }
`
const ROSE_BTN = 'from-rose-400 to-rose-600 shadow-[0_10px_28px_-12px_rgb(225_29_72/0.55)]'

const BalloonButton = memo(function BalloonButton({ balloon: b, reducedMotion, register, onPop }: {
  balloon: Balloon
  reducedMotion: boolean
  register: (id: number, el: HTMLElement | null) => void
  onPop: (b: Balloon, el: HTMLElement) => void
}) {
  return (
    // Positioned by the animation loop (transform); the inner button carries the gentle bob
    <div ref={(el) => register(b.id, el)} className="absolute left-0 top-0 will-change-transform"
      style={{ transform: `translate3d(${b.x}px, ${b.y0}px, 0)` }}>
      <button type="button" onClick={(e) => onPop(b, e.currentTarget)} aria-label={`Pop stress balloon: ${b.text}`}
        className={cn('relative flex cursor-pointer select-none items-center justify-center border-0 p-2 text-center font-bold leading-tight text-white',
          '[text-shadow:0_1px_2px_rgb(15_23_42/0.4)] hover:brightness-110',
          reducedMotion ? 'wl-balloon-still' : 'wl-balloon-float')}
        style={{
          width: b.size,
          height: b.size * 1.2,
          borderRadius: '50% 50% 50% 50% / 40% 40% 60% 60%',
          background: `radial-gradient(circle at 30% 25%, ${b.color.light} 0%, ${b.color.deep} 48%)`,
          boxShadow: `inset -10px -10px 20px rgb(15 23 42 / 0.18), 0 10px 20px ${b.color.deep}33`,
          fontSize: b.size < 90 ? '0.7rem' : '0.8rem',
        }}>
        {b.text}
        {/* Balloon string */}
        <span aria-hidden className="absolute -bottom-3 left-1/2 h-3.5 w-0.5 -translate-x-1/2 bg-ink-500/40" />
      </button>
    </div>
  )
})

/** Wellness ▸ Stress Buster — MindAlign's Zen arcade: pop floating study worries, read affirmations, finish the quest. */
export function StressBusterTab() {
  const { context, alert, meta } = useWellness()
  const thoughts = useMemo(() => stressThoughts(context), [context])
  const { report } = useActivityXp()
  const reducedMotion = useReducedMotion()
  // One AudioContext for every pop, created by the Start click and closed when the tab unmounts
  const audio = useAudioContext()
  const arenaRef = useRef<HTMLDivElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [score, setScore] = useState(0)
  const [poppedCount, setPoppedCount] = useState(0)
  const [affirmation, setAffirmation] = useState('')
  const poppedRef = useRef(0)
  const field = useBalloonField({ playing: isPlaying, thoughts, reducedMotion, arenaRef })

  // The Start button disappears when the game begins, so keyboard focus moves into the play area
  useEffect(() => {
    if (isPlaying) arenaRef.current?.focus({ preventScroll: true })
  }, [isPlaying])

  const startGame = () => {
    audio.ensure() // unlocks the pop sound inside the click
    field.clear()
    poppedRef.current = 0
    setScore(0)
    setPoppedCount(0)
    setAffirmation('')
    setIsPlaying(true)
  }

  const endGame = (completed: boolean) => {
    setIsPlaying(false)
    field.clear()
    if (!completed) return
    report('stress_quest', 'Stress Buster Quest Completed')
    celebrate({ particleCount: 150, spread: 80, origin: { y: 0.6 } })
    alert(
      `🎉 Quest Completed! (+${meta?.xpRules?.stress_quest ?? 50} XP)`,
      `Incredible stress busting! You popped ${QUEST_TARGET} stress thoughts and transformed them into active positive affirmations. Keep carrying this peaceful study mindset!`,
    )
  }

  const popBalloon = (b: Balloon, el: HTMLElement | null) => {
    if (!isPlaying || poppedRef.current >= QUEST_TARGET) return
    const ctx = audio.current()
    if (ctx) playPopSound(ctx)
    // Sparkle confetti where the balloon was (celebrate() skips it with reduced motion)
    if (el) {
      const r = el.getBoundingClientRect()
      const origin = { x: (r.left + r.right) / 2 / window.innerWidth, y: (r.top + r.bottom) / 2 / window.innerHeight }
      celebrate({ particleCount: 20, spread: 40, origin })
    }
    field.remove([b.id])
    setScore((s) => s + POINTS_PER_POP)
    const popped = ++poppedRef.current
    setPoppedCount(popped)
    report('balloon_pop', 'Stress Buster Balloon Popped', b.text)
    setAffirmation(`"${b.text}" popped! ➔ ${pick(AFFIRMATIONS)}`)
    if (popped >= QUEST_TARGET) endGame(true)
  }

  // Stable handler for the memoised balloons (they then never re-render while they float)
  const popRef = useRef(popBalloon)
  useEffect(() => { popRef.current = popBalloon })
  const onPop = useCallback((b: Balloon, el: HTMLElement) => popRef.current(b, el), [])

  // Keyboard: Enter / Space in the play area pops the balloon closest to escaping (balloons are also Tab-able buttons)
  const onArenaKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!isPlaying || e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
    e.preventDefault()
    const b = field.mostUrgent()
    if (b) popBalloon(b, field.elementOf(b.id))
  }

  return (
    <Card className="flex h-[620px] flex-col gap-6 p-5 sm:p-6">
      <style>{CSS}</style>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Gamepad2 className="h-6 w-6 text-rose-400" aria-hidden />
          <h2 className="font-display text-lg font-semibold text-fg">Zen Stress Buster</h2>
        </div>
        <div className="flex items-center gap-4 text-sm text-ink-300">
          <span>Score: <strong className="tabular-nums text-rose-500">{score}</strong></span>
          <span>Busted: <strong className="tabular-nums text-purple-600">{poppedCount}/{QUEST_TARGET}</strong></span>
        </div>
      </div>

      <p className="m-0 text-sm leading-relaxed text-ink-300">
        <b className="text-fg">Zen Arcade:</b> Float up study stresses. Tap/Click to pop them, converting stress into positive cognitive
        affirmations. Bust {QUEST_TARGET} stressors to complete the quest!
      </p>

      {/* Game playing window */}
      <div ref={arenaRef} tabIndex={isPlaying ? 0 : -1} onKeyDown={onArenaKeyDown}
        role={isPlaying ? 'group' : undefined}
        aria-label={isPlaying ? 'Stress balloons. Press Enter or Space to pop the highest balloon, or Tab to a balloon.' : undefined}
        className={cn('relative flex flex-1 items-center justify-center overflow-hidden rounded-xl border border-line',
          'bg-gradient-to-b from-sky-50 via-purple-50/50 to-rose-50/70',
          isPlaying ? 'cursor-crosshair' : 'cursor-default')}>
        {!isPlaying ? (
          <div className="z-10 flex flex-col items-center gap-4 p-8 text-center">
            <div className="grid h-[60px] w-[60px] place-items-center rounded-full bg-rose-100">
              <Heart className="h-8 w-8 text-rose-400" aria-hidden />
            </div>
            <h3 className="font-display text-base font-semibold text-fg">Ready to Bust Some Stress?</h3>
            <p className="max-w-[300px] text-xs leading-snug text-ink-300">
              Floating balloons carry stressful thoughts customized for your {context.gradeLabel} subjects. Pop them to earn XP and read positive affirmations.
            </p>
            <Button onClick={startGame} className={ROSE_BTN}><Play className="h-4 w-4" aria-hidden />Start Stress Buster</Button>
          </div>
        ) : (
          field.balloons.map((b) => (
            <BalloonButton key={b.id} balloon={b} reducedMotion={reducedMotion} register={field.register} onPop={onPop} />
          ))
        )}
      </div>

      {/* Affirmation bar (the live region stays mounted so each new affirmation is announced) */}
      <div aria-live="polite">
        {affirmation && (
          <div className="wl-affirm flex items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3">
            <Sparkles className="h-4 w-4 shrink-0 text-rose-400" aria-hidden />
            <span className="text-sm font-medium leading-snug text-rose-700">{affirmation}</span>
          </div>
        )}
      </div>
    </Card>
  )
}
