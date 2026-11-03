/* Word Forge: rebuild a scrambled subject word from its meaning. Pure board rules for tests. */
import { pickN, shuffle, type Rng } from '../rng'
import type { VocabEntry } from '../vocab'

export interface ForgeWord { answer: string; clue: string }
export interface Tile { id: number; letter: string }
export interface ForgeBoard {
  tiles: Tile[]
  /** Tile ids in the order they were placed into the answer slots. */
  placed: number[]
}

export const FORGE_WORDS = 6
/** Single words of 4–10 letters make good puzzles (multi-word or very long terms are left to Concept Pairs). */
export const WORD_RE = /^[A-Za-z]{4,10}$/

export function pickForgeWords(entries: readonly VocabEntry[], count = FORGE_WORDS, rng: Rng = Math.random): ForgeWord[] {
  const seen = new Set<string>()
  const usable = entries.filter((e) => {
    const w = e.term.trim().toUpperCase()
    if (!WORD_RE.test(w) || seen.has(w)) return false
    seen.add(w)
    return true
  })
  return pickN(usable, count, rng).map((e) => ({ answer: e.term.trim().toUpperCase(), clue: e.def }))
}

/** The word's letters as tiles, shuffled so they do not spell the word (when that is possible). */
export function scramble(word: string, rng: Rng = Math.random): Tile[] {
  const letters = word.toUpperCase().split('')
  let order = letters
  for (let i = 0; i < 12; i++) {
    order = shuffle(letters, rng)
    if (order.join('') !== letters.join('')) break
  }
  return order.map((letter, id) => ({ id, letter }))
}

export const newBoard = (word: string, rng: Rng = Math.random): ForgeBoard => ({ tiles: scramble(word, rng), placed: [] })
export const attempt = (b: ForgeBoard): string => b.placed.map((id) => b.tiles.find((t) => t.id === id)?.letter ?? '').join('')
export const isFull = (b: ForgeBoard): boolean => b.placed.length === b.tiles.length
export const isSolved = (b: ForgeBoard, answer: string): boolean => isFull(b) && attempt(b) === answer.toUpperCase()

export function placeTile(b: ForgeBoard, tileId: number): ForgeBoard {
  if (isFull(b) || b.placed.includes(tileId) || !b.tiles.some((t) => t.id === tileId)) return b
  return { ...b, placed: [...b.placed, tileId] }
}

/** Typing: places the first unused tile showing that letter (no change if there is none). */
export function placeLetter(b: ForgeBoard, letter: string): ForgeBoard {
  const tile = b.tiles.find((t) => t.letter === letter.toUpperCase() && !b.placed.includes(t.id))
  return tile ? placeTile(b, tile.id) : b
}

export const removeLast = (b: ForgeBoard): ForgeBoard => ({ ...b, placed: b.placed.slice(0, -1) })
/** Taking back a slot also frees every letter after it, so the word is always built left to right. */
export const removeFrom = (b: ForgeBoard, slot: number): ForgeBoard => ({ ...b, placed: b.placed.slice(0, Math.max(0, slot)) })

/** Keeps the correct start of the attempt and places the next correct letter. */
export function hint(b: ForgeBoard, answer: string): ForgeBoard {
  const target = answer.toUpperCase()
  const current = attempt(b)
  let keep = 0
  while (keep < current.length && current[keep] === target[keep]) keep++
  if (keep >= target.length) return b
  const trimmed = removeFrom(b, keep)
  return placeLetter(trimmed, target[keep])
}

/** Ten per letter, eight off per hint, never below 5 for a solved word. */
export const wordPoints = (length: number, hints: number): number => Math.max(5, length * 10 - hints * 8)
