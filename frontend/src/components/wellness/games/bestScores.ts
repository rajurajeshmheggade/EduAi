/* Personal best per game, kept in this browser per student (higher is always better). Storage can be missing or
   blocked (private mode, quota, embedded views), so every access is guarded and a failure only means no best is shown. */

const KEY_PREFIX = 'eduai.gamezone.best.'
const MUTE_KEY = 'eduai.gamezone.muted'

export type BestScores = Partial<Record<string, number>>

const keyFor = (student: string) => `${KEY_PREFIX}${student || 'anon'}`

export function readBests(student: string): BestScores {
  try {
    const raw = window.localStorage.getItem(keyFor(student))
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object') return {}
    const out: BestScores = {}
    for (const [game, score] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof score === 'number' && Number.isFinite(score) && score >= 0) out[game] = score
    }
    return out
  } catch {
    return {}
  }
}

/** Stores the score if it beats the student's best for the game. */
export function recordScore(student: string, game: string, score: number): { best: number; isNewBest: boolean } {
  const bests = readBests(student)
  const previous = bests[game]
  const value = Math.max(0, Math.round(score))
  const isNewBest = previous === undefined ? value > 0 : value > previous
  if (!isNewBest) return { best: previous ?? 0, isNewBest: false }
  try {
    window.localStorage.setItem(keyFor(student), JSON.stringify({ ...bests, [game]: value }))
  } catch { /* storage unavailable: the best is still shown for this round */ }
  return { best: value, isNewBest: true }
}

export function readMuted(): boolean {
  try { return window.localStorage.getItem(MUTE_KEY) === '1' } catch { return false }
}

export function writeMuted(muted: boolean): void {
  try { window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0') } catch { /* not remembered, still applied */ }
}
