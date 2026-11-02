/* Concept Pairs: a term card and its meaning card form a pair. Pure rules (deck, flips, score) for tests. */
import { pickN, shuffle, type Rng } from '../rng'
import type { VocabEntry } from '../vocab'

export interface PairCard {
  id: number
  pairId: number
  kind: 'term' | 'meaning'
  text: string
}

export interface PairsState {
  cards: PairCard[]
  /** Pair ids found so far. */
  matched: number[]
  /** Face-up cards that are not matched (0, 1, or 2 after a miss until the next flip). */
  open: number[]
  /** Completed two-card turns. */
  moves: number
  misses: number
}

export type FlipOutcome = 'ignored' | 'opened' | 'match' | 'miss'

export const DEFAULT_PAIRS = 6

/** Entries with distinct terms and meanings (so every pair has exactly one partner). */
export function distinctEntries(entries: readonly VocabEntry[]): VocabEntry[] {
  const terms = new Set<string>()
  const defs = new Set<string>()
  return entries.filter((e) => {
    const t = e.term.trim().toLowerCase()
    const d = e.def.trim().toLowerCase()
    if (!t || !d || terms.has(t) || defs.has(d)) return false
    terms.add(t)
    defs.add(d)
    return true
  })
}

/** A shuffled deck of `pairs` term/meaning pairs (fewer if the vocabulary is smaller). */
export function buildDeck(entries: readonly VocabEntry[], pairs: number, rng: Rng = Math.random): PairCard[] {
  const chosen = pickN(distinctEntries(entries), pairs, rng)
  const cards = chosen.flatMap((e, pairId) => [
    { pairId, kind: 'term' as const, text: e.term },
    { pairId, kind: 'meaning' as const, text: e.def },
  ])
  return shuffle(cards, rng).map((c, id) => ({ ...c, id }))
}

export const newPairsState = (cards: PairCard[]): PairsState => ({ cards, matched: [], open: [], moves: 0, misses: 0 })

export const isMatched = (s: PairsState, card: PairCard) => s.matched.includes(card.pairId)
export const isFaceUp = (s: PairsState, card: PairCard) => isMatched(s, card) || s.open.includes(card.id)
export const totalPairs = (s: PairsState) => s.cards.length / 2
export const isComplete = (s: PairsState) => s.cards.length > 0 && s.matched.length === totalPairs(s)

/**
 * Flip one card. Two unmatched face-up cards (a miss) turn back down as soon as the next card is tapped, so the
 * student never has to wait for a timer. A term and its meaning that are both up become matched.
 */
export function flipCard(s: PairsState, cardId: number): { state: PairsState; outcome: FlipOutcome } {
  const card = s.cards.find((c) => c.id === cardId)
  // After a miss any tap starts a fresh turn — even on one of the two missed cards, which then stays up alone
  const pending = s.open.length >= 2 ? [] : s.open
  if (!card || isMatched(s, card) || pending.includes(cardId)) return { state: s, outcome: 'ignored' }
  const open = [...pending, cardId]
  if (open.length < 2) return { state: { ...s, open }, outcome: 'opened' }
  const [a, b] = open.map((id) => s.cards.find((c) => c.id === id)!)
  const moves = s.moves + 1
  if (a.pairId === b.pairId && a.kind !== b.kind) {
    return { state: { ...s, open: [], moves, matched: [...s.matched, a.pairId] }, outcome: 'match' }
  }
  return { state: { ...s, open, moves, misses: s.misses + 1 }, outcome: 'miss' }
}

/** Turns a missed pair face down again (after a short look, or on the next flip). */
export const closeMiss = (s: PairsState): PairsState => (s.open.length >= 2 ? { ...s, open: [] } : s)

/**
 * 100 per pair, minus 10 per miss beyond a few free ones (some misses are part of the game), plus up to 60 for
 * speed (one point per second under a minute). Never below 10 per pair found.
 */
export function pairsScore({ pairs, misses, seconds }: { pairs: number; misses: number; seconds: number }): number {
  const freeMisses = Math.ceil(pairs / 2)
  const base = pairs * 100 - Math.max(0, misses - freeMisses) * 10
  const speed = Math.max(0, 60 - Math.floor(seconds))
  return Math.max(pairs * 10, base + speed)
}
