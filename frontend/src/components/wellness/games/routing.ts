/* Game Zone URL handling, kept tiny (no icons, no game code) so the Wellness page can import it eagerly. */

export const GAME_IDS = [
  'stress-buster',
  'concept-pairs',
  'breath-bloom',
  'number-sprint',
  'word-forge',
  'lantern-trail',
  'sort-studio',
  'steady-signal',
  'sand-mandala',
] as const
export type GameId = (typeof GAME_IDS)[number]

export const GAME_ZONE_TAB = 'games'
/** Old links (?tab=stress-buster) open the Game Zone with the balloon game selected. */
export const LEGACY_GAME_TABS: Readonly<Record<string, GameId>> = { 'stress-buster': 'stress-buster' }

export const isGameId = (v: unknown): v is GameId => typeof v === 'string' && (GAME_IDS as readonly string[]).includes(v)

/** The game a Wellness URL asks for: `?tab=games&game=<id>`, or a legacy `?tab=stress-buster`. */
export function requestedGame(params: URLSearchParams): GameId | null {
  const tab = params.get('tab') ?? ''
  if (Object.hasOwn(LEGACY_GAME_TABS, tab)) return LEGACY_GAME_TABS[tab]
  const game = params.get('game')
  return tab === GAME_ZONE_TAB && isGameId(game) ? game : null
}

/** Search params with the Game Zone open on `game` (or on the picker for null), other params kept. */
export function gameZoneParams(params: URLSearchParams, game: GameId | null): URLSearchParams {
  const next = new URLSearchParams(params)
  next.set('tab', GAME_ZONE_TAB)
  if (game) next.set('game', game)
  else next.delete('game')
  return next
}
