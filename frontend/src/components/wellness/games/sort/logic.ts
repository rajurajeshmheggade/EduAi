/* Sort Studio: put each item into the group it belongs to. Built-in sets per subject (no AI call); the student's
   own subjects decide which sets are offered first, and a study-habits set is always available. */
import { shuffle, type Rng } from '../rng'

export interface SortBucket { id: string; label: string }
export interface SortItem { text: string; bucket: string; why?: string }
export interface SortSet {
  id: string
  title: string
  /** Subject names this set suits (matched loosely against the student's subjects). */
  subjects: RegExp
  buckets: SortBucket[]
  items: SortItem[]
}

const b = (id: string, label: string): SortBucket => ({ id, label })
const items = (bucket: string, texts: string[], why?: Record<string, string>): SortItem[] =>
  texts.map((text) => ({ text, bucket, why: why?.[text] }))

export const SORT_SETS: readonly SortSet[] = [
  {
    id: 'matter', title: 'States of matter', subjects: /science|physic|chem|evs/i,
    buckets: [b('solid', 'Solid'), b('liquid', 'Liquid'), b('gas', 'Gas')],
    items: [
      ...items('solid', ['Ice cube', 'Iron nail', 'Brick', 'Salt crystal', 'Wooden spoon', 'Chalk']),
      ...items('liquid', ['Mercury', 'Honey', 'Vinegar', 'Petrol', 'Milk', 'Rainwater'], { Mercury: 'Mercury is a metal that is liquid at room temperature.' }),
      ...items('gas', ['Steam', 'Oxygen', 'Helium', 'Carbon dioxide', 'Neon', 'Water vapour']),
    ],
  },
  {
    id: 'acids', title: 'Acid, base or neutral', subjects: /chem|science/i,
    buckets: [b('acid', 'Acid'), b('base', 'Base'), b('neutral', 'Neutral')],
    items: [
      ...items('acid', ['Lemon juice', 'Vinegar', 'Tamarind', 'Orange juice', 'Curd']),
      ...items('base', ['Soap solution', 'Baking soda solution', 'Lime water', 'Milk of magnesia', 'Washing soda']),
      ...items('neutral', ['Pure water', 'Sugar solution', 'Table salt solution'], { 'Table salt solution': 'Salt of a strong acid and a strong base: neutral.' }),
    ],
  },
  {
    id: 'vectors', title: 'Scalar or vector', subjects: /physic/i,
    buckets: [b('scalar', 'Scalar (size only)'), b('vector', 'Vector (size + direction)')],
    items: [
      ...items('scalar', ['Speed', 'Mass', 'Distance', 'Time', 'Temperature', 'Energy']),
      ...items('vector', ['Velocity', 'Force', 'Displacement', 'Acceleration', 'Momentum', 'Weight'], { Weight: 'Weight is a force, so it has a direction (downwards).' }),
    ],
  },
  {
    id: 'conductors', title: 'Conductor or insulator', subjects: /physic|science/i,
    buckets: [b('conductor', 'Conductor'), b('insulator', 'Insulator')],
    items: [
      ...items('conductor', ['Copper wire', 'Aluminium foil', 'Silver', 'Graphite', 'Iron key', 'Salt water'], { Graphite: 'Graphite is a non-metal that conducts electricity.' }),
      ...items('insulator', ['Rubber', 'Glass', 'Plastic', 'Dry wood', 'Paper', 'Cotton']),
    ],
  },
  {
    id: 'primes', title: 'Prime or composite', subjects: /math/i,
    buckets: [b('prime', 'Prime'), b('composite', 'Composite')],
    items: [
      ...items('prime', ['2', '7', '13', '19', '23', '29', '31', '37']),
      ...items('composite', ['9', '15', '21', '27', '49', '51', '57', '91'], { '51': '51 = 3 × 17', '57': '57 = 3 × 19', '91': '91 = 7 × 13', '49': '49 = 7 × 7' }),
    ],
  },
  {
    id: 'rational', title: 'Rational or irrational', subjects: /math/i,
    buckets: [b('rational', 'Rational'), b('irrational', 'Irrational')],
    items: [
      ...items('rational', ['1/2', '0.75', '√16', '−3', '0.333…', '22/7'], { '22/7': '22/7 is a fraction, so it is rational (π only approximates it).', '√16': '√16 = 4' }),
      ...items('irrational', ['√2', 'π', '√3', '√5', '0.1010010001…'], { '0.1010010001…': 'It never repeats in a pattern, so it is irrational.' }),
    ],
  },
  {
    id: 'speech', title: 'Parts of speech', subjects: /english|grammar|language|literature/i,
    buckets: [b('noun', 'Noun'), b('verb', 'Verb'), b('adjective', 'Adjective')],
    items: [
      ...items('noun', ['River', 'Happiness', 'Teacher', 'Library', 'Courage']),
      ...items('verb', ['Run', 'Write', 'Think', 'Explore', 'Whisper']),
      ...items('adjective', ['Bright', 'Gentle', 'Curious', 'Ancient', 'Brave']),
    ],
  },
  {
    id: 'vertebrates', title: 'Vertebrate or invertebrate', subjects: /bio|science|evs/i,
    buckets: [b('vertebrate', 'Vertebrate (backbone)'), b('invertebrate', 'Invertebrate (no backbone)')],
    items: [
      ...items('vertebrate', ['Frog', 'Shark', 'Sparrow', 'Snake', 'Bat', 'Tortoise'], { Bat: 'Bats are mammals, so they have a backbone.' }),
      ...items('invertebrate', ['Earthworm', 'Octopus', 'Butterfly', 'Jellyfish', 'Snail', 'Starfish', 'Spider']),
    ],
  },
  {
    id: 'resources', title: 'Renewable or non-renewable', subjects: /social|geograph|science|evs|environment/i,
    buckets: [b('renewable', 'Renewable'), b('non-renewable', 'Non-renewable')],
    items: [
      ...items('renewable', ['Solar energy', 'Wind energy', 'Tidal energy', 'Biomass', 'Geothermal heat', 'Hydropower']),
      ...items('non-renewable', ['Coal', 'Petroleum', 'Natural gas', 'Uranium', 'Iron ore'], { Uranium: 'Uranium is mined and cannot be replaced.' }),
    ],
  },
  {
    id: 'devices', title: 'Input, output or storage', subjects: /computer|informatics|\bit\b|coding/i,
    buckets: [b('input', 'Input'), b('output', 'Output'), b('storage', 'Storage')],
    items: [
      ...items('input', ['Keyboard', 'Mouse', 'Scanner', 'Microphone', 'Webcam']),
      ...items('output', ['Monitor', 'Printer', 'Speaker', 'Projector', 'Headphones']),
      ...items('storage', ['Hard disk', 'Pen drive', 'SSD', 'Memory card']),
    ],
  },
  {
    id: 'habits', title: 'Recharges you or drains you', subjects: /$^/,
    buckets: [b('recharge', 'Recharges you'), b('drain', 'Drains you')],
    items: [
      ...items('recharge', ['A short walk', 'A glass of water', '8 hours of sleep', 'Stretching', 'Talking to a friend', 'A 5-minute break']),
      ...items('drain', ['Scrolling late at night', 'Skipping breakfast', 'Cramming all night', 'Comparing marks', 'Studying while multitasking']),
    ],
  },
]

export const SORT_ROUND = 10

/** Sets for a student: the ones that suit their subjects first, then the rest, with the habits set last. */
export function setsForSubjects(subjects: readonly string[]): SortSet[] {
  const suits = (s: SortSet) => subjects.some((name) => s.subjects.test(name))
  const habits = SORT_SETS.filter((s) => s.id === 'habits')
  const rest = SORT_SETS.filter((s) => s.id !== 'habits')
  return [...rest.filter(suits), ...rest.filter((s) => !suits(s)), ...habits]
}

/** A round of `count` items, spread as evenly as the set allows across its groups, in random order. */
export function buildSortRound(set: SortSet, count = SORT_ROUND, rng: Rng = Math.random): SortItem[] {
  const pools = set.buckets.map((bucket) => shuffle(set.items.filter((i) => i.bucket === bucket.id), rng))
  const picked: SortItem[] = []
  for (let round = 0; picked.length < count && pools.some((p) => p.length > round); round++) {
    for (const pool of pools) if (pool[round] && picked.length < count) picked.push(pool[round])
  }
  return shuffle(picked, rng)
}

export const judgeSort = (item: SortItem, bucketId: string): boolean => item.bucket === bucketId

/** 10 per correct item, +2 per item in the current streak (up to +10). */
export const sortPoints = (streak: number): number => 10 + Math.min(streak, 5) * 2

export const bucketLabel = (set: SortSet, id: string): string => set.buckets.find((x) => x.id === id)?.label ?? id
