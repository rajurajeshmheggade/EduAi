import { describe, expect, it } from 'vitest'
import {
  BLOOM_BREATHS, BLOOM_PATTERN, GRACE_MS, bloomLengthMs, bloomMoment, bloomScore, breathHarmony, breathPoints, newHarmony, orbScale,
  overallHarmony, petalFor, sampleHarmony, type Harmony,
} from './bloom/logic'
import { GAMES, gameById, gamesFor } from './catalog'
import { formatClock, holdClock, newClock, readClock, remainingMs, runClock } from './clock'
import { FORGE_WORDS, attempt, hint, isFull, isSolved, newBoard, pickForgeWords, placeLetter, placeTile, removeFrom, removeLast, scramble, wordPoints } from './forge/logic'
import { MAX_LENGTH, START_LENGTH, extendSequence, judgeEcho, playbackTiming, startSequence, trailScore } from './lantern/logic'
import { CANVAS_SIZE, SYMMETRIES, calmScore, mirrorPoint, moveBrush, rotatePoint, symmetricSegments } from './mandala/logic'
import { DEFAULT_PAIRS, buildDeck, closeMiss, distinctEntries, flipCard, isComplete, isFaceUp, newPairsState, pairsScore, type PairsState } from './pairs/logic'
import { pickN, seededRng, shuffle } from './rng'
import { GAME_IDS, gameZoneParams, isGameId, requestedGame } from './routing'
import { SHAPE_NAMES, STREAM_LENGTH, TARGET_RATIO, averageReaction, buildStream, judgeSignal, newTally, signalAccuracy, signalScore, stimulusTiming, tallySignal } from './signal/logic'
import { SORT_ROUND, SORT_SETS, bucketLabel, buildSortRound, judgeSort, setsForSubjects, sortPoints } from './sort/logic'
import { MIN_ANSWERS_FOR_XP, SPRINT_MS, distractors, fmt, makeQuestion, nextTier, sprintPoints, tierForKnowledge, tierForStudent, type Tier } from './sprint/logic'
import { GENERAL_PACK, MIXED_TOPIC, VOCAB_PACKS, defaultTopic, packForSubject, vocabFor, vocabTopics } from './vocab'

const params = (q: string) => new URLSearchParams(q)

describe('Game Zone catalogue & routing', () => {
  it('lists the balloon game plus at least six new games, each fully described', () => {
    expect(GAMES.map((g) => g.id)).toEqual([...GAME_IDS])
    const fresh = GAMES.filter((g) => g.xp === 'game_complete')
    expect(fresh.length).toBeGreaterThanOrEqual(6)
    for (const g of GAMES) {
      expect(g.name && g.blurb && g.duration).toBeTruthy()
      expect(g.trains.length).toBeGreaterThan(0)
      expect(g.howTo.length).toBeGreaterThan(0)
    }
    expect(gameById('stress-buster')?.xp).toBe('stress_quest')
    expect(gamesFor('calm').every((g) => g.trains.includes('calm'))).toBe(true)
    expect(gamesFor(null)).toHaveLength(GAMES.length)
  })

  it('reads the open game from the URL, with the legacy stress-buster tab as an alias', () => {
    expect(requestedGame(params('tab=games'))).toBeNull()
    expect(requestedGame(params('tab=games&game=word-forge'))).toBe('word-forge')
    expect(requestedGame(params('tab=games&game=nope'))).toBeNull()
    expect(requestedGame(params('tab=journal&game=word-forge'))).toBeNull()
    expect(requestedGame(params('tab=stress-buster'))).toBe('stress-buster')
    expect(requestedGame(params('tab=toString'))).toBeNull()
    expect(isGameId('lantern-trail') && !isGameId('2048')).toBe(true)
    expect(gameZoneParams(params('tab=stress-buster&x=1'), 'stress-buster').toString()).toBe('tab=games&x=1&game=stress-buster')
    expect(gameZoneParams(params('tab=games&game=word-forge'), null).toString()).toBe('tab=games')
  })
})

describe('random helpers', () => {
  it('are deterministic with a seed and shuffle without losing items', () => {
    const a = shuffle([1, 2, 3, 4, 5, 6], seededRng(7))
    expect(shuffle([1, 2, 3, 4, 5, 6], seededRng(7))).toEqual(a)
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6])
    expect(new Set(pickN([1, 2, 3, 4, 5], 3, seededRng(1))).size).toBe(3)
    expect(pickN([1, 2], 5)).toHaveLength(2)
  })
})

describe('subject vocabulary', () => {
  it('offers the student’s own subjects, a mixed deck and a general pack', () => {
    const topics = vocabTopics(['Mathematics', 'Physics', 'Social Science', 'Computer Science', 'Hindi'])
    expect(topics.map((t) => t.id)).toEqual(['maths', 'physics', 'social', 'computer', MIXED_TOPIC, GENERAL_PACK.id])
    expect(topics[2].label).toBe('Social Science')
    expect(packForSubject('Environmental Science')?.id).toBe('science')
    expect(packForSubject('Chemistry II')?.id).toBe('chemistry')
    expect(vocabTopics(['Hindi', 'Sanskrit']).map((t) => t.id)).toEqual(['maths', 'science', 'english', MIXED_TOPIC, 'general'])
    expect(vocabTopics([]).length).toBeGreaterThan(1)
  })

  it('builds topics without duplicate terms and short enough for a phone card', () => {
    const topics = vocabTopics(['Science', 'Biology'])
    const mixed = vocabFor(MIXED_TOPIC, topics)
    expect(new Set(mixed.map((e) => e.term.toLowerCase())).size).toBe(mixed.length)
    expect(mixed.some((e) => e.term === 'Habitat')).toBe(true) // in both packs, kept once
    expect(vocabFor('unknown')).toEqual([...GENERAL_PACK.entries])
    for (const pack of [...VOCAB_PACKS, GENERAL_PACK]) {
      expect(pack.entries.length).toBeGreaterThanOrEqual(12)
      for (const e of pack.entries) expect(e.def.length).toBeLessThanOrEqual(40)
    }
    expect(defaultTopic(topics, 'Biology')).toBe('biology')
    expect(defaultTopic(topics, null)).toBe(topics[0].id)
  })
})

describe('Concept Pairs', () => {
  const entries = VOCAB_PACKS[0].entries

  it('deals every pair as a term card and a meaning card, reproducibly', () => {
    const deck = buildDeck(entries, DEFAULT_PAIRS, seededRng(3))
    expect(deck).toHaveLength(DEFAULT_PAIRS * 2)
    expect(deck.map((c) => c.id)).toEqual([...Array(12).keys()])
    for (let p = 0; p < DEFAULT_PAIRS; p++) {
      expect(deck.filter((c) => c.pairId === p).map((c) => c.kind).sort()).toEqual(['meaning', 'term'])
    }
    expect(buildDeck(entries, DEFAULT_PAIRS, seededRng(3))).toEqual(deck)
    expect(buildDeck(entries.slice(0, 2), DEFAULT_PAIRS)).toHaveLength(4)
    expect(distinctEntries([{ term: 'A', def: 'x' }, { term: 'a', def: 'y' }, { term: 'B', def: 'X' }])).toHaveLength(1)
  })

  it('matches a term with its meaning, turns a miss back on the next flip, and ignores repeat taps', () => {
    const deck = buildDeck(entries, 2, seededRng(9))
    let s: PairsState = newPairsState(deck)
    const [t0, m0] = [deck.find((c) => c.pairId === 0 && c.kind === 'term')!, deck.find((c) => c.pairId === 0 && c.kind === 'meaning')!]
    const t1 = deck.find((c) => c.pairId === 1 && c.kind === 'term')!

    let r = flipCard(s, t0.id)
    expect(r.outcome).toBe('opened')
    expect(flipCard(r.state, t0.id).outcome).toBe('ignored')
    r = flipCard(r.state, t1.id)
    expect(r.outcome).toBe('miss')
    expect(r.state.open).toHaveLength(2)
    expect(closeMiss(r.state).open).toEqual([])
    r = flipCard(r.state, t0.id) // a third flip closes the miss and opens the new card
    expect(r.outcome).toBe('opened')
    expect(r.state.open).toEqual([t0.id])
    r = flipCard(r.state, m0.id)
    expect(r.outcome).toBe('match')
    s = r.state
    expect(s.matched).toEqual([0])
    expect(isFaceUp(s, t0) && isFaceUp(s, m0)).toBe(true)
    expect(flipCard(s, m0.id).outcome).toBe('ignored')
    expect(s.moves).toBe(2)
    expect(s.misses).toBe(1)
    expect(isComplete(s)).toBe(false)
    s = flipCard(flipCard(s, t1.id).state, deck.find((c) => c.pairId === 1 && c.kind === 'meaning')!.id).state
    expect(isComplete(s)).toBe(true)
  })

  it('scores pairs, forgives a few misses and rewards speed', () => {
    expect(pairsScore({ pairs: 6, misses: 0, seconds: 30 })).toBe(630)
    expect(pairsScore({ pairs: 6, misses: 3, seconds: 90 })).toBe(600)
    expect(pairsScore({ pairs: 6, misses: 8, seconds: 90 })).toBe(550)
    expect(pairsScore({ pairs: 6, misses: 200, seconds: 900 })).toBe(60)
  })
})

describe('Breath Bloom', () => {
  const total = bloomLengthMs()

  it('follows a 4 s in / 6 s out guide for six breaths', () => {
    expect(total).toBe(60_000)
    expect(bloomMoment(0)).toMatchObject({ breath: 0, phase: 'in', progress: 0 })
    expect(bloomMoment(3999).phase).toBe('in')
    expect(bloomMoment(4000)).toMatchObject({ breath: 0, phase: 'out', phaseElapsedMs: 0 })
    expect(bloomMoment(7000).progress).toBeCloseTo(0.5)
    expect(bloomMoment(10_000)).toMatchObject({ breath: 1, phase: 'in' })
    expect(bloomMoment(total).done).toBe(true)
    expect(orbScale(bloomMoment(0))).toBeCloseTo(0.72)
    expect(orbScale(bloomMoment(4000))).toBeCloseTo(1.12)
  })

  /** Simulates a minute of play in 50 ms ticks with a holding strategy. */
  const play = (holding: (t: number) => boolean): Harmony => {
    let h = newHarmony()
    for (let t = 50; t <= total; t += 50) h = sampleHarmony(h, bloomMoment(t - 25), holding(t - 25), 50)
    return h
  }

  it('opens full petals for breathing in rhythm, even with a human reaction delay', () => {
    const lagged = play((t) => { const m = bloomMoment(t - 400); return m.phase === 'in' && t >= 400 })
    for (let b = 0; b < BLOOM_BREATHS; b++) expect(petalFor(breathHarmony(lagged, b))).toBe('bloom')
    expect(bloomScore(lagged)).toBeGreaterThan(550)
    expect(overallHarmony(lagged)).toBeGreaterThanOrEqual(95)
  })

  it('gives buds and almost no score for idling or holding the whole time', () => {
    for (const idle of [play(() => false), play(() => true)]) {
      for (let b = 0; b < BLOOM_BREATHS; b++) expect(petalFor(breathHarmony(idle, b))).toBe('bud')
      expect(bloomScore(idle)).toBeLessThan(BLOOM_BREATHS * 20)
    }
  })

  it('counts the first moments of each phase whatever the input (grace)', () => {
    const m = bloomMoment(BLOOM_PATTERN.inhaleMs + GRACE_MS - 1)
    const h = sampleHarmony(newHarmony(), m, true, 100)
    expect(h.outMatched[0]).toBe(100)
    expect(sampleHarmony(newHarmony(), bloomMoment(total + 5), true, 100)).toEqual(newHarmony())
    expect(breathPoints(0.5)).toBe(0)
    expect(breathPoints(1)).toBe(100)
  })
})

describe('Number Sprint', () => {
  /** Independent evaluation of a question's text. */
  const evaluate = (text: string): number => {
    const t = text.replace(/−/g, '-')
    let m = t.match(/^(\d+)% of (\d+)$/)
    if (m) return (Number(m[1]) * Number(m[2])) / 100
    m = t.match(/^(\d+)\/(\d+) of (\d+)$/)
    if (m) return (Number(m[1]) / Number(m[2])) * Number(m[3])
    m = t.match(/^(\d+)²$/)
    if (m) return Number(m[1]) ** 2
    return Function(`return (${t.replace(/×/g, '*').replace(/÷/g, '/')})`)() as number
  }

  it('picks the starting level from maths results, then the overall level, then the grade', () => {
    expect(tierForKnowledge('Foundational', 10)).toBe(1)
    expect(tierForKnowledge('Advanced', 3)).toBe(4)
    expect(tierForKnowledge('Not yet assessed', 3)).toBe(1)
    expect(tierForKnowledge('Not yet assessed', 6)).toBe(2)
    expect(tierForKnowledge('Not yet assessed', 10)).toBe(3)
    expect(tierForKnowledge('Not yet assessed', null)).toBe(2)
    const knowledge = { level: 'Advanced' as const, avgPct: 90, assessments: 4, strongest: null, needsSupport: null,
      bySubject: [{ subject: 'Mathematics', avgPct: 55, level: 'Developing' as const, assessments: 2 }] }
    expect(tierForStudent({ knowledge, grade: 9 })).toBe(2)
    expect(tierForStudent({ knowledge: { ...knowledge, bySubject: [] }, grade: 9 })).toBe(4)
  })

  it('generates correct questions with four distinct choices at every level', () => {
    const rng = seededRng(42)
    for (const tier of [1, 2, 3, 4] as Tier[]) {
      for (let i = 0; i < 300; i++) {
        const q = makeQuestion(tier, rng)
        expect(evaluate(q.text)).toBe(q.answer)
        expect(Number.isInteger(q.answer)).toBe(true)
        expect(q.options).toHaveLength(4)
        expect(new Set(q.options).size).toBe(4)
        expect(q.options).toContain(q.answer)
        if (tier < 4) expect(Math.min(...q.options)).toBeGreaterThanOrEqual(0)
        if (tier === 1) expect(q.answer).toBeLessThanOrEqual(24)
      }
    }
    expect(distractors(0, seededRng(1))).toHaveLength(3)
    expect(distractors(0, seededRng(1)).every((n) => n > 0)).toBe(true)
    expect(fmt(-7)).toBe('−7')
  })

  it('adapts within one level of the start and scores streaks', () => {
    expect(nextTier(2, 2, 3, 0)).toBe(3)
    expect(nextTier(3, 2, 6, 0)).toBe(3) // never more than one above the start
    expect(nextTier(2, 2, 2, 0)).toBe(2)
    expect(nextTier(2, 2, 0, 2)).toBe(1)
    expect(nextTier(1, 2, 0, 4)).toBe(1)
    expect(nextTier(4, 4, 3, 0)).toBe(4)
    expect(sprintPoints(1, 1)).toBe(12)
    expect(sprintPoints(3, 9)).toBe(40)
    expect(SPRINT_MS).toBe(60_000)
    expect(MIN_ANSWERS_FOR_XP).toBeGreaterThan(0)
  })
})

describe('Word Forge', () => {
  it('uses single words of 4–10 letters, distinct and upper-cased', () => {
    const words = pickForgeWords(VOCAB_PACKS.find((p) => p.id === 'biology')!.entries, 20, seededRng(5))
    expect(words.length).toBeGreaterThanOrEqual(FORGE_WORDS)
    expect(words.every((w) => /^[A-Z]{4,10}$/.test(w.answer) && w.clue)).toBe(true)
    expect(words.some((w) => w.answer === 'PHOTOSYNTHESIS' || w.answer === 'MITOCHONDRIA')).toBe(false)
    expect(new Set(words.map((w) => w.answer)).size).toBe(words.length)
  })

  it('scrambles into a different order of the same letters', () => {
    for (const word of ['FORCE', 'ATOM', 'PARALLEL', 'ALGORITHM']) {
      const tiles = scramble(word, seededRng(word.length))
      expect(tiles.map((t) => t.letter).join('')).not.toBe(word)
      expect(tiles.map((t) => t.letter).sort().join('')).toBe(word.split('').sort().join(''))
    }
    expect(scramble('AAAA').map((t) => t.letter).join('')).toBe('AAAA')
  })

  it('places tiles and typed letters, takes them back, and solves', () => {
    let b = newBoard('LOOP', seededRng(2))
    b = placeLetter(b, 'l')
    b = placeLetter(b, 'o')
    expect(attempt(b)).toBe('LO')
    expect(placeLetter(b, 'z')).toBe(b)
    b = placeLetter(placeLetter(b, 'o'), 'P')
    expect(isFull(b) && isSolved(b, 'loop')).toBe(true)
    expect(placeTile(b, b.tiles[0].id)).toBe(b) // already full
    b = removeLast(b)
    expect(attempt(b)).toBe('LOO')
    expect(attempt(removeFrom(b, 1))).toBe('L')
  })

  it('hints by keeping the right start and placing the next right letter', () => {
    let b = newBoard('FORCE', seededRng(4))
    for (const l of 'FRO') b = placeLetter(b, l)
    b = hint(b, 'FORCE')
    expect(attempt(b)).toBe('FO')
    for (let i = 0; i < 3; i++) b = hint(b, 'FORCE')
    expect(isSolved(b, 'FORCE')).toBe(true)
    expect(hint(b, 'FORCE')).toBe(b)
    expect(wordPoints(5, 0)).toBe(50)
    expect(wordPoints(5, 2)).toBe(34)
    expect(wordPoints(4, 9)).toBe(5)
  })
})

describe('Lantern Trail', () => {
  it('grows a trail without repeating a lantern back to back', () => {
    const rng = seededRng(11)
    let seq = startSequence(rng)
    expect(seq).toHaveLength(START_LENGTH)
    while (seq.length < MAX_LENGTH * 4) seq = extendSequence(seq, rng)
    seq.forEach((v, i) => {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(8)
      if (i) expect(v).not.toBe(seq[i - 1])
    })
    expect(new Set(seq).size).toBe(9)
  })

  it('checks each echo and scores cleared trails', () => {
    const seq = [4, 1, 7]
    expect(judgeEcho(seq, [])).toBe('continue')
    expect(judgeEcho(seq, [4, 1])).toBe('continue')
    expect(judgeEcho(seq, [4, 1, 7])).toBe('complete')
    expect(judgeEcho(seq, [4, 2])).toBe('wrong')
    expect(judgeEcho(seq, [4, 1, 7, 7])).toBe('wrong')
    expect(trailScore([3, 4, 5])).toBe(120)
    expect(playbackTiming(3)).toEqual({ onMs: 620, gapMs: 260 })
    expect(playbackTiming(30).onMs).toBe(340)
    expect(playbackTiming(8).onMs).toBeLessThan(playbackTiming(4).onMs)
  })
})

describe('Sort Studio', () => {
  it('has well-formed sets: valid groups and enough items for a round', () => {
    for (const set of SORT_SETS) {
      const ids = set.buckets.map((b) => b.id)
      expect(set.items.every((i) => ids.includes(i.bucket))).toBe(true)
      expect(set.items.length).toBeGreaterThanOrEqual(SORT_ROUND)
      expect(new Set(set.items.map((i) => i.text)).size).toBe(set.items.length)
    }
  })

  it('orders sets by the student’s subjects and keeps the habits set last', () => {
    const maths = setsForSubjects(['Mathematics'])
    expect(maths.slice(0, 2).map((s) => s.id)).toEqual(['primes', 'rational'])
    expect(maths.at(-1)?.id).toBe('habits')
    expect(setsForSubjects(['English'])[0].id).toBe('speech')
    expect(setsForSubjects([])).toHaveLength(SORT_SETS.length)
  })

  it('deals a balanced round and validates drops', () => {
    const set = SORT_SETS.find((s) => s.id === 'matter')!
    const round = buildSortRound(set, SORT_ROUND, seededRng(8))
    expect(round).toHaveLength(SORT_ROUND)
    expect(new Set(round.map((i) => i.text)).size).toBe(SORT_ROUND)
    const counts = set.buckets.map((b) => round.filter((i) => i.bucket === b.id).length)
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
    const mercury = set.items.find((i) => i.text === 'Mercury')!
    expect(judgeSort(mercury, 'liquid')).toBe(true)
    expect(judgeSort(mercury, 'solid')).toBe(false)
    expect(mercury.why).toMatch(/liquid at room temperature/)
    expect(bucketLabel(set, 'gas')).toBe('Gas')
    expect(sortPoints(1)).toBe(12)
    expect(sortPoints(10)).toBe(20)
  })
})

describe('Steady Signal', () => {
  it('builds a stream with the right number of targets and no long target runs', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const stream = buildStream('star', STREAM_LENGTH, seededRng(seed))
      expect(stream).toHaveLength(STREAM_LENGTH)
      expect(stream.filter((s) => s.isTarget)).toHaveLength(Math.round(STREAM_LENGTH * TARGET_RATIO))
      stream.forEach((s, i) => {
        expect(s.isTarget).toBe(s.shape === 'star')
        if (i >= 2) expect(s.isTarget && stream[i - 1].isTarget && stream[i - 2].isTarget).toBe(false)
        if (i && !s.isTarget) expect(s.shape).not.toBe(stream[i - 1].shape)
      })
    }
    expect(Object.keys(SHAPE_NAMES)).toHaveLength(8)
  })

  it('times, judges and scores responses', () => {
    expect(stimulusTiming(0)).toEqual({ showMs: 1000, gapMs: 500 })
    expect(stimulusTiming(STREAM_LENGTH - 1).showMs).toBe(700)
    for (let i = 0; i < STREAM_LENGTH; i++) expect(stimulusTiming(i).gapMs).toBeGreaterThanOrEqual(500)
    expect([judgeSignal(true, true), judgeSignal(true, false), judgeSignal(false, true), judgeSignal(false, false)])
      .toEqual(['hit', 'miss', 'false-alarm', 'correct-rejection'])
    let t = newTally()
    t = tallySignal(t, 'hit', 420)
    t = tallySignal(t, 'hit', 610)
    t = tallySignal(t, 'false-alarm')
    t = tallySignal(t, 'correct-rejection')
    t = tallySignal(t, 'miss')
    expect(signalScore(t)).toBe(20 + 3 + 2 - 5)
    expect(signalAccuracy(t)).toBe(60)
    expect(averageReaction(t)).toBe(515)
    expect(averageReaction(newTally())).toBeNull()
    expect(signalScore(tallySignal(newTally(), 'false-alarm'))).toBe(0)
  })
})

describe('Sand Mandala', () => {
  const c = { x: CANVAS_SIZE / 2, y: CANVAS_SIZE / 2 }
  it('repeats each stroke around the centre and mirrors it', () => {
    const a = { x: 300, y: 100 }
    const b = { x: 320, y: 120 }
    expect(symmetricSegments(a, b, c, 8, false)).toHaveLength(8)
    const segs = symmetricSegments(a, b, c, 6, true)
    expect(segs).toHaveLength(12)
    const dist = (p: { x: number; y: number }) => Math.hypot(p.x - c.x, p.y - c.y)
    for (const [p] of segs) expect(dist(p)).toBeCloseTo(dist(a))
    const quarter = rotatePoint(a, c, Math.PI / 2)
    expect(quarter.x).toBeCloseTo(500)
    expect(quarter.y).toBeCloseTo(300)
    expect(mirrorPoint({ x: 100, y: 50 }, c)).toEqual({ x: 500, y: 50 })
    expect(SYMMETRIES).toContain(8)
  })

  it('moves the keyboard brush within the canvas', () => {
    expect(moveBrush(c, 'ArrowUp', false)).toEqual({ x: 300, y: 288 })
    expect(moveBrush(c, 'ArrowRight', true)).toEqual({ x: 304, y: 300 })
    expect(moveBrush({ x: 2, y: 0 }, 'ArrowLeft', false)).toEqual({ x: 0, y: 0 })
    expect(moveBrush(c, 'a', false)).toBeNull()
    expect(calmScore(61_900)).toBe(61)
  })
})

describe('pausable clock', () => {
  it('only advances while running', () => {
    let k = runClock(newClock(), 1000)
    expect(readClock(k, 1500)).toBe(500)
    k = holdClock(k, 2000)
    expect(readClock(k, 9000)).toBe(1000) // paused: time stands still
    k = runClock(k, 9000)
    expect(readClock(k, 9250)).toBe(1250)
    expect(runClock(k, 9999)).toBe(k)
    expect(remainingMs(k, 1000, 9250)).toBe(0)
    expect(remainingMs(holdClock(k, 9100), 60_000, 0)).toBe(58_900)
    expect(formatClock(65_000)).toBe('1:05')
    expect(formatClock(59_001)).toBe('1:00')
    expect(formatClock(-5)).toBe('0:00')
  })
})
