/* Number Sprint: one minute of mental maths. The starting level follows the student's knowledge level in maths
   (from their graded EduAI assessments), then adapts: three right in a row steps up, two slips in a row eases back,
   always within one level of where they started. */
import type { KnowledgeLevel, StudentContext } from '@/types/wellness'
import { pickOne, randInt, shuffle, type Rng } from '../rng'

export type Tier = 1 | 2 | 3 | 4
export interface MathsQuestion {
  /** As shown: "7 × 8", "25% of 80", "−6 + 14". */
  text: string
  answer: number
  /** Four choices, one of them the answer. */
  options: number[]
  tier: Tier
}

export const SPRINT_MS = 60_000
export const MIN_ANSWERS_FOR_XP = 3
export const TIER_LABELS: Record<Tier, string> = { 1: 'Warm-up', 2: 'Steady', 3: 'Stretch', 4: 'Challenge' }

const LEVEL_TIER: Partial<Record<KnowledgeLevel, Tier>> = { Foundational: 1, Developing: 2, Proficient: 3, Advanced: 4 }

/** Starting tier for a knowledge level; without graded work, the class grade decides. */
export function tierForKnowledge(level: KnowledgeLevel, grade: number | null): Tier {
  const t = LEVEL_TIER[level]
  if (t) return t
  if (grade === null) return 2
  return grade <= 4 ? 1 : grade <= 7 ? 2 : 3
}

/** The student's maths level if they have graded maths work, else their overall level. */
export function tierForStudent(ctx: Pick<StudentContext, 'knowledge' | 'grade'>): Tier {
  const maths = ctx.knowledge.bySubject.find((s) => /math/i.test(s.subject))
  return tierForKnowledge(maths?.level ?? ctx.knowledge.level, ctx.grade)
}

/** Shows negatives with a true minus sign. */
export const fmt = (n: number): string => (n < 0 ? `−${-n}` : String(n))

type Gen = (rng: Rng) => { text: string; answer: number }

const GENERATORS: Record<Tier, Gen[]> = {
  1: [
    (r) => { const a = randInt(2, 12, r), b = randInt(2, 9, r); return { text: `${a} + ${b}`, answer: a + b } },
    (r) => { const a = randInt(6, 20, r), b = randInt(1, Math.min(9, a), r); return { text: `${a} − ${b}`, answer: a - b } },
    (r) => { const a = randInt(2, 12, r); return { text: `2 × ${a}`, answer: 2 * a } },
  ],
  2: [
    (r) => { const a = randInt(12, 70, r), b = randInt(11, 99 - a, r); return { text: `${a} + ${b}`, answer: a + b } },
    (r) => { const a = randInt(30, 99, r), b = randInt(11, a - 5, r); return { text: `${a} − ${b}`, answer: a - b } },
    (r) => { const a = randInt(2, 10, r), b = randInt(2, 10, r); return { text: `${a} × ${b}`, answer: a * b } },
    (r) => { const b = randInt(2, 10, r), q = randInt(2, 10, r); return { text: `${b * q} ÷ ${b}`, answer: q } },
  ],
  3: [
    (r) => { const a = randInt(11, 15, r), b = randInt(3, 9, r); return { text: `${a} × ${b}`, answer: a * b } },
    (r) => {
      const [p, step] = pickOne([[10, 10], [20, 5], [25, 4], [50, 2]] as const, r)
      const n = step * randInt(3, 30, r)
      return { text: `${p}% of ${n}`, answer: (n * p) / 100 }
    },
    (r) => { const n = randInt(11, 15, r); return { text: `${n}²`, answer: n * n } },
    (r) => { const a = randInt(100, 450, r), b = randInt(25, 250, r); return { text: `${a} + ${b}`, answer: a + b } },
    (r) => { const a = randInt(150, 500, r), b = randInt(25, a - 20, r); return { text: `${a} − ${b}`, answer: a - b } },
  ],
  4: [
    (r) => { const a = -randInt(2, 20, r), b = randInt(3, 25, r); return { text: `${fmt(a)} + ${b}`, answer: a + b } },
    (r) => { const a = randInt(5, 20, r), b = a + randInt(3, 25, r); return { text: `${a} − ${b}`, answer: a - b } },
    (r) => { const n = randInt(16, 25, r); return { text: `${n}²`, answer: n * n } },
    (r) => {
      const [p, step] = pickOne([[15, 20], [30, 10], [75, 4]] as const, r)
      const n = step * randInt(2, 12, r)
      return { text: `${p}% of ${n}`, answer: (n * p) / 100 }
    },
    (r) => { const a = randInt(3, 9, r), b = randInt(4, 12, r), c = randInt(2, 20, r); return { text: `${a} × ${b} − ${c}`, answer: a * b - c } },
    (r) => {
      const d = pickOne([3, 4, 5, 8] as const, r), num = randInt(1, d - 1, r), k = randInt(3, 12, r)
      return { text: `${num}/${d} of ${d * k}`, answer: num * k }
    },
  ],
}

const swapDigits = (n: number): number | null => {
  const s = String(Math.abs(n))
  if (s.length !== 2 || s[0] === s[1]) return null
  return Math.sign(n || 1) * Number(s[1] + s[0])
}

/** Three plausible wrong answers: near misses, place-value slips and swapped digits. */
export function distractors(answer: number, rng: Rng = Math.random, allowNegative = false): number[] {
  const pool = [answer + 1, answer - 1, answer + 2, answer - 2, answer + 10, answer - 10, answer + 3, swapDigits(answer)]
  const ok = (n: number | null): n is number => n !== null && n !== answer && Number.isInteger(n) && (allowNegative || n >= 0)
  const unique = [...new Set(pool.filter(ok))]
  const picked = shuffle(unique, rng).slice(0, 3)
  for (let step = 4; picked.length < 3; step++) if (ok(answer + step) && !picked.includes(answer + step)) picked.push(answer + step)
  return picked
}

export function makeQuestion(tier: Tier, rng: Rng = Math.random): MathsQuestion {
  const { text, answer } = pickOne(GENERATORS[tier], rng)(rng)
  return { text, answer, tier, options: shuffle([answer, ...distractors(answer, rng, tier === 4)], rng) }
}

/** Adaptive step: up after 3 right in a row, down after 2 slips in a row, within one tier of the starting tier. */
export function nextTier(current: Tier, base: Tier, streak: number, slips: number): Tier {
  const top = Math.min(4, base + 1) as Tier
  const bottom = Math.max(1, base - 1) as Tier
  if (streak > 0 && streak % 3 === 0 && current < top) return (current + 1) as Tier
  if (slips >= 2 && current > bottom) return (current - 1) as Tier
  return current
}

/** Ten points per tier, plus a streak bonus of 2 per answer in the streak (up to +10). */
export const sprintPoints = (tier: Tier, streak: number): number => tier * 10 + Math.min(streak, 5) * 2
