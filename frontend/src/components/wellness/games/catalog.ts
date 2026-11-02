/* Game Zone catalogue: what the picker shows. Metadata only — each game's code is its own lazily-loaded chunk
   (see GameZoneTab), so opening the Wellness page or the picker never downloads a game. */
import type { GameId } from './routing'
import { Brain, Calculator, Crosshair, Flower2, Gamepad2, Hammer, Lamp, Layers, Palette, Shapes, Sparkles, Wind, type LucideIcon } from 'lucide-react'

export type GameSkill = 'calm' | 'focus' | 'memory' | 'recall'

export type { GameId } from './routing'

export interface GameInfo {
  id: GameId
  name: string
  /** One line for the picker card. */
  blurb: string
  /** Typical length, shown on the card. */
  duration: string
  trains: readonly GameSkill[]
  icon: LucideIcon
  /** Card artwork gradient (decorative; the card text carries every cue). */
  art: string
  /** How to play, shown on the game's start screen. */
  howTo: readonly string[]
  /** The balloon game awards its own quest XP; every other game awards `game_complete` when a round is finished. */
  xp: 'game_complete' | 'stress_quest'
}

export const SKILLS: Record<GameSkill, { label: string; icon: LucideIcon; hint: string }> = {
  calm: { label: 'Calm', icon: Wind, hint: 'Slows breathing and settles the mind' },
  focus: { label: 'Focus', icon: Crosshair, hint: 'Trains steady attention' },
  memory: { label: 'Memory', icon: Brain, hint: 'Exercises short-term memory' },
  recall: { label: 'Recall', icon: Sparkles, hint: 'Brings back what you have studied' },
}
export const SKILL_ORDER: readonly GameSkill[] = ['calm', 'focus', 'memory', 'recall']

export const GAMES: readonly GameInfo[] = [
  {
    id: 'stress-buster', name: 'Stress Buster', icon: Gamepad2, duration: '1–2 min', trains: ['calm'], xp: 'stress_quest',
    blurb: 'Pop floating study worries and swap them for kind affirmations.',
    art: 'from-rose-200 via-purple-100 to-sky-100',
    howTo: ['Tap or click a balloon to pop it.', 'Press Enter or Space to pop the highest one.', 'Pop 10 to finish the quest.'],
  },
  {
    id: 'concept-pairs', name: 'Concept Pairs', icon: Layers, duration: '2–3 min', trains: ['memory', 'recall'], xp: 'game_complete',
    blurb: 'Flip cards to match terms from your subjects with their meanings.',
    art: 'from-indigo-200 via-violet-100 to-fuchsia-100',
    howTo: [
      'Every term card has a matching meaning card.',
      'Flip two cards at a time. A term and its meaning stay face up.',
      'Use the arrow keys to move between cards and Enter or Space to flip.',
    ],
  },
  {
    id: 'breath-bloom', name: 'Breath Bloom', icon: Flower2, duration: '1 min', trains: ['calm', 'focus'], xp: 'game_complete',
    blurb: 'Hold to breathe in, let go to breathe out, and grow a flower.',
    art: 'from-emerald-100 via-teal-100 to-sky-100',
    howTo: [
      'Press and hold the orb (or hold Space) while it says Breathe in — about 4 seconds.',
      'Let go while it says Breathe out — about 6 seconds.',
      'Each calm breath opens a petal. Six breaths make the flower.',
    ],
  },
  {
    id: 'number-sprint', name: 'Number Sprint', icon: Calculator, duration: '1 min', trains: ['focus', 'recall'], xp: 'game_complete',
    blurb: 'Sixty seconds of mental maths that follows your level.',
    art: 'from-amber-100 via-orange-100 to-rose-100',
    howTo: [
      'Pick the right answer before the minute is up.',
      'Press 1, 2, 3 or 4 for the options, or tap them.',
      'Get three right in a row and the questions step up; a slip eases them back.',
    ],
  },
  {
    id: 'word-forge', name: 'Word Forge', icon: Hammer, duration: '2–4 min', trains: ['recall'], xp: 'game_complete',
    blurb: 'Rebuild scrambled subject words from their meanings.',
    art: 'from-sky-100 via-cyan-100 to-emerald-100',
    howTo: [
      'Read the meaning, then tap the letters in order to build the word.',
      'Or just type it. Backspace takes the last letter back.',
      'Stuck? A hint places the next letter for you.',
    ],
  },
  {
    id: 'lantern-trail', name: 'Lantern Trail', icon: Lamp, duration: '2–3 min', trains: ['memory', 'focus'], xp: 'game_complete',
    blurb: 'Watch the lanterns glow, then light them in the same order.',
    art: 'from-amber-100 via-yellow-50 to-indigo-100',
    howTo: [
      'Watch (and listen) as the lanterns glow one after another.',
      'Then light them in the same order — tap them or press their number keys 1–9.',
      'Each round adds one lantern. You have three sparks for slips.',
    ],
  },
  {
    id: 'sort-studio', name: 'Sort Studio', icon: Shapes, duration: '2 min', trains: ['recall', 'focus'], xp: 'game_complete',
    blurb: 'Drag each item into the right group — matter, numbers, words and more.',
    art: 'from-lime-100 via-emerald-50 to-teal-100',
    howTo: [
      'Drag the card into the group it belongs to.',
      'Or tap a group, or press its number key.',
      'A wrong drop shows the right group so you learn as you go.',
    ],
  },
  {
    id: 'steady-signal', name: 'Steady Signal', icon: Crosshair, duration: '1 min', trains: ['focus'], xp: 'game_complete',
    blurb: 'Respond only when the target shape appears. Let the rest pass.',
    art: 'from-cyan-100 via-sky-100 to-indigo-100',
    howTo: [
      'Shapes appear one at a time in the window.',
      'Press Space or tap “Now” only when your target shape shows.',
      'Let every other shape pass — staying still is the skill.',
    ],
  },
  {
    id: 'sand-mandala', name: 'Sand Mandala', icon: Palette, duration: '1–5 min', trains: ['calm'], xp: 'game_complete',
    blurb: 'Draw mirrored patterns in soft sand. Nothing to win or lose.',
    art: 'from-orange-50 via-amber-100 to-rose-100',
    howTo: [
      'Draw with your finger or mouse; every stroke is mirrored around the centre.',
      'Keyboard: arrow keys move the brush, Space lifts or lowers it.',
      'Stay a little while (45 seconds or more), then press Finish when you feel ready.',
    ],
  },
]

export const gameById = (id: string | null | undefined): GameInfo | undefined => GAMES.find((g) => g.id === id)

/** Picker filter: games that train a skill (all games for null). */
export const gamesFor = (skill: GameSkill | null): readonly GameInfo[] => (skill ? GAMES.filter((g) => g.trains.includes(skill)) : GAMES)

/** What every lazily-loaded game component receives from the Game Zone. */
export interface GameProps {
  info: GameInfo
  /** Back to the picker. */
  onExit: () => void
}
