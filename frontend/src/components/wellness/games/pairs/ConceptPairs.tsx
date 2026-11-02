import { useEffect, useMemo, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { useWellness } from '@/components/wellness/WellnessContext'
import { cn } from '@/lib/utils'
import type { GameProps } from '../catalog'
import { formatClock, useGameClock } from '../clock'
import { ChoiceChips, GameShell } from '../GameShell'
import { TONES, moveGridFocus } from '../gridKeys'
import { useGameRun } from '../useGameRun'
import { defaultTopic, vocabFor, vocabTopics } from '../vocab'
import { DEFAULT_PAIRS, buildDeck, closeMiss, flipCard, isComplete, isFaceUp, isMatched, newPairsState, pairsScore, totalPairs, type PairCard, type PairsState } from './logic'

const MISS_LOOK_MS = 1200

const CSS = `
@keyframes wl-card-turn { from { transform: scaleX(0.2); opacity: 0.4; } to { transform: scaleX(1); opacity: 1; } }
.wl-card-up { animation: wl-card-turn 0.18s ease-out; }
@media (prefers-reduced-motion: reduce) { .wl-card-up { animation: none; } }
`

function cardLabel(card: PairCard, index: number, s: PairsState): string {
  const kind = card.kind === 'term' ? 'term' : 'meaning'
  if (isMatched(s, card)) return `Card ${index + 1}, matched ${kind}: ${card.text}`
  if (isFaceUp(s, card)) return `Card ${index + 1}, ${kind}: ${card.text}`
  return `Card ${index + 1}, face down`
}

/** Game Zone ▸ Concept Pairs — match terms from the student's own subjects with their meanings. */
export default function ConceptPairs({ info, onExit }: GameProps) {
  const run = useGameRun(info)
  const { context } = useWellness()
  const topics = useMemo(() => vocabTopics(context.subjects), [context.subjects])
  const [topic, setTopic] = useState(() => defaultTopic(topics, context.knowledge.needsSupport))
  const [state, setStateRaw] = useState<PairsState>(() => newPairsState([]))
  // Mirrors the state synchronously, so two quick taps in one frame both see the latest cards
  const stateRef = useRef(state)
  const setState = (s: PairsState) => {
    stateRef.current = s
    setStateRaw(s)
  }
  const clock = useGameClock(run.active)
  const missTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(missTimer.current), [])

  const start = () => {
    window.clearTimeout(missTimer.current)
    const deck = buildDeck(vocabFor(topic, topics), DEFAULT_PAIRS)
    setState(newPairsState(deck))
    clock.reset()
    run.start()
    run.announce(`${deck.length} cards face down. Find each term and its meaning.`)
  }

  const flip = (card: PairCard) => {
    if (!run.active) return
    const { state: next, outcome } = flipCard(stateRef.current, card.id)
    if (outcome === 'ignored') return
    window.clearTimeout(missTimer.current)
    setState(next)
    const kind = card.kind === 'term' ? 'Term' : 'Meaning'
    if (outcome === 'opened') {
      run.play(TONES.tap)
      run.announce(`${kind}: ${card.text}`)
    } else if (outcome === 'match') {
      run.play(TONES.good)
      const found = next.matched.length
      run.announce(`${kind}: ${card.text}. A pair! ${found} of ${totalPairs(next)} found.`)
      if (isComplete(next)) {
        const seconds = clock.read() / 1000
        const label = topics.find((t) => t.id === topic)?.label ?? 'Mixed'
        run.play(TONES.done)
        run.finish({
          score: pairsScore({ pairs: totalPairs(next), misses: next.misses, seconds }),
          completed: true,
          headline: 'Every pair found!',
          details: [`${totalPairs(next)} pairs in ${next.moves} moves`, `Time ${formatClock(seconds * 1000)}`, `Topic: ${label}`],
        })
      }
    } else {
      run.play(TONES.soft)
      run.announce(`${kind}: ${card.text}. Not a pair — they will turn back.`)
      missTimer.current = window.setTimeout(() => setState(closeMiss(stateRef.current)), MISS_LOOK_MS)
    }
  }

  const pairs = totalPairs(state)
  return (
    <GameShell run={run} onExit={onExit} onStart={start}
      hud={[
        { label: 'Pairs', value: `${state.matched.length}/${pairs}` },
        { label: 'Moves', value: state.moves },
        { label: 'Time', value: formatClock(clock.elapsedMs) },
      ]}
      setup={<ChoiceChips label="Cards from" options={topics} value={topic} onChange={setTopic} />}>
      <style>{CSS}</style>
      <ul aria-label="Cards. Use the arrow keys to move between cards." onKeyDown={moveGridFocus}
        className="m-0 grid list-none grid-cols-3 gap-2 p-0 sm:grid-cols-4 sm:gap-3">
        {state.cards.map((card, i) => {
          const up = isFaceUp(state, card)
          const matched = isMatched(state, card)
          return (
            <li key={card.id}>
              <button type="button" data-cell data-autofocus={i === 0 || undefined} onClick={() => flip(card)}
                aria-label={cardLabel(card, i, state)} aria-disabled={matched || undefined}
                className={cn('relative flex h-24 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 p-1.5 text-center sm:h-28 sm:p-2',
                  'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2',
                  matched ? 'border-ok/60 bg-ok/10 text-fg' : up ? 'wl-card-up border-brand-400 bg-ink-900 text-fg shadow-sm'
                    : 'border-transparent bg-gradient-to-br from-indigo-400 to-violet-500 text-white hover:brightness-110')}>
                {up ? (
                  <>
                    <span className={cn('inline-flex items-center gap-1 rounded-full px-1.5 text-[10px] font-semibold uppercase tracking-wide',
                      card.kind === 'term' ? 'bg-brand-500/10 text-brand-600' : 'bg-aqua-500/10 text-aqua-400')} aria-hidden>
                      {matched && <Check className="h-3 w-3" />}{card.kind === 'term' ? 'Term' : 'Meaning'}
                    </span>
                    <span className={cn('break-words leading-tight', card.kind === 'term' ? 'text-sm font-semibold sm:text-base' : 'text-[11px] sm:text-xs')} aria-hidden>
                      {card.text}
                    </span>
                  </>
                ) : (
                  <span aria-hidden className="grid h-10 w-10 place-items-center rounded-full border-2 border-white/40 font-display text-lg font-bold">{i + 1}</span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </GameShell>
  )
}
