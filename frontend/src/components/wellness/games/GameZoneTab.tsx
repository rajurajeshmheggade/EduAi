import { lazy, Suspense, useEffect, useState, type ComponentType, type LazyExoticComponent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Clock, Gamepad2, Play, Trophy } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useWellness } from '@/components/wellness/WellnessContext'
import { cn } from '@/lib/utils'
import { readBests } from './bestScores'
import { GAMES, SKILLS, SKILL_ORDER, gameById, gamesFor, type GameId, type GameProps, type GameSkill } from './catalog'
import { SkillTags } from './GameShell'
import { GAME_ZONE_TAB, gameZoneParams, requestedGame } from './routing'

// Each game is its own chunk, downloaded only when the student opens it
const GAME_COMPONENTS: Record<GameId, LazyExoticComponent<ComponentType<GameProps>>> = {
  'stress-buster': lazy(() => import('./StressBusterGame')),
  'concept-pairs': lazy(() => import('./pairs/ConceptPairs')),
  'breath-bloom': lazy(() => import('./bloom/BreathBloom')),
  'number-sprint': lazy(() => import('./sprint/NumberSprint')),
  'word-forge': lazy(() => import('./forge/WordForge')),
  'lantern-trail': lazy(() => import('./lantern/LanternTrail')),
  'sort-studio': lazy(() => import('./sort/SortStudio')),
  'steady-signal': lazy(() => import('./signal/SteadySignal')),
  'sand-mandala': lazy(() => import('./mandala/SandMandala')),
}

/**
 * Wellness ▸ Game Zone — a picker of short brain-break games (calm, focus, memory, recall) and the chosen game.
 * The open game lives in the URL (`?tab=games&game=<id>`); the old `?tab=stress-buster` opens the balloon game.
 */
export function GameZoneTab() {
  const [params, setParams] = useSearchParams()
  const gameId = requestedGame(params)
  const info = gameById(gameId)
  const [lastGame, setLastGame] = useState<GameId | null>(null)

  // Rewrite a legacy ?tab=stress-buster link to the Game Zone URL (same screen, canonical address)
  const legacy = params.get('tab') !== GAME_ZONE_TAB && gameId !== null
  useEffect(() => {
    if (legacy) setParams((p) => gameZoneParams(p, gameId), { replace: true })
  }, [legacy, gameId, setParams])

  const open = (id: GameId) => setParams((p) => gameZoneParams(p, id), { replace: true })
  const exit = () => {
    setLastGame(gameId)
    setParams((p) => gameZoneParams(p, null), { replace: true })
  }

  if (info) {
    const Game = GAME_COMPONENTS[info.id]
    return (
      <Suspense fallback={<div className="skeleton h-96 rounded-2xl" aria-label={`Loading ${info.name}`} />}>
        <Game key={info.id} info={info} onExit={exit} />
      </Suspense>
    )
  }
  return <GamePicker onOpen={open} returnTo={lastGame} />
}

function GamePicker({ onOpen, returnTo }: { onOpen: (id: GameId) => void; returnTo: GameId | null }) {
  const { me, meta } = useWellness()
  const [skill, setSkill] = useState<GameSkill | null>(null)
  const bests = readBests(me.student.code)
  const games = gamesFor(skill)
  const xp = meta?.xpRules?.game_complete ?? 25

  // Coming back from a game puts focus on that game's Play button
  useEffect(() => {
    if (returnTo) document.getElementById(`game-zone-play-${returnTo}`)?.focus({ preventScroll: true })
  }, [returnTo])

  return (
    <section aria-labelledby="game-zone-title" className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-rose-100 to-purple-100">
              <Gamepad2 className="h-6 w-6 text-rose-400" aria-hidden />
            </span>
            <div>
              <h2 id="game-zone-title" className="font-display text-lg font-semibold text-fg">Game Zone</h2>
              <p className="m-0 text-sm text-ink-300">
                Short brain breaks for between study sessions — {GAMES.length} games, 1–5 minutes each. Finish a game for +{xp} XP.
              </p>
            </div>
          </div>
        </div>
        <div role="group" aria-label="Show games that train" className="flex flex-wrap gap-2">
          {[null, ...SKILL_ORDER].map((s) => {
            const on = skill === s
            const Icon = s ? SKILLS[s].icon : Gamepad2
            return (
              <button key={s ?? 'all'} type="button" aria-pressed={on} onClick={() => setSkill(s)} title={s ? SKILLS[s].hint : 'Every game'}
                className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  on ? 'border-brand-400 bg-brand-500/10 text-brand-600' : 'border-line bg-ink-900 text-ink-300 hover:border-line-strong hover:text-fg')}>
                <Icon className="h-3.5 w-3.5" aria-hidden />{s ? SKILLS[s].label : 'All games'}
              </button>
            )
          })}
        </div>
      </Card>

      <ul aria-label="Games" className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
        {games.map((g) => {
          const Icon = g.icon
          const best = bests[g.id]
          return (
            <li key={g.id}>
              <article className="glass group relative flex h-full flex-col overflow-hidden rounded-2xl transition hover:-translate-y-0.5 hover:shadow-glow focus-within:ring-2 focus-within:ring-brand-400 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
                <div aria-hidden className={cn('relative grid h-24 place-items-center overflow-hidden bg-gradient-to-br', g.art)}>
                  <span className="absolute -left-4 -top-6 h-20 w-20 rounded-full bg-white/40" />
                  <span className="absolute -bottom-8 right-6 h-24 w-24 rounded-full bg-white/30" />
                  <Icon className="relative h-10 w-10 text-fg/70" />
                </div>
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-display text-base font-semibold text-fg">{g.name}</h3>
                    {best ? <Badge tone="brand"><Trophy className="h-3 w-3" aria-hidden />Best {best}</Badge>
                      : g.xp === 'stress_quest' ? <Badge>Classic</Badge> : null}
                  </div>
                  <p className="m-0 text-sm text-ink-300">{g.blurb}</p>
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-2 text-xs text-ink-500">
                    <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden />{g.duration}</span>
                    <SkillTags trains={g.trains} />
                  </div>
                  {/* The Play button's hit area covers the whole card */}
                  <Button id={`game-zone-play-${g.id}`} onClick={() => onOpen(g.id)} aria-label={`Play ${g.name}`}
                    className="mt-2 w-full after:absolute after:inset-0 after:content-['']">
                    <Play className="h-4 w-4" aria-hidden />Play
                  </Button>
                </div>
              </article>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
