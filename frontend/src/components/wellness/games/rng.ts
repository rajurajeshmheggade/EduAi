/* Small random helpers. Every game's logic takes an Rng so tests can pass a seeded one and get the same deck,
   sequence or question every time. */

export type Rng = () => number

/** Deterministic generator (mulberry32) for tests and reproducible rounds. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Integer in [min, max], both inclusive. */
export const randInt = (min: number, max: number, rng: Rng = Math.random): number => min + Math.floor(rng() * (max - min + 1))

export const pickOne = <T>(items: readonly T[], rng: Rng = Math.random): T => items[Math.floor(rng() * items.length)]

/** Fisher–Yates shuffle into a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** `n` distinct items in random order (fewer if the list is shorter). */
export const pickN = <T>(items: readonly T[], n: number, rng: Rng = Math.random): T[] => shuffle(items, rng).slice(0, Math.max(0, n))
