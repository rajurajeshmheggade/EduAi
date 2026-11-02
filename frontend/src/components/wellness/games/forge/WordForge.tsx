import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Delete, Lightbulb, SkipForward, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWellness } from '@/components/wellness/WellnessContext'
import { cn } from '@/lib/utils'
import type { GameProps } from '../catalog'
import { ChoiceChips, GameShell } from '../GameShell'
import { TONES, isPlainKey } from '../gridKeys'
import { useGameRun } from '../useGameRun'
import { defaultTopic, vocabFor, vocabTopics } from '../vocab'
import { FORGE_WORDS, attempt, hint, isFull, isSolved, newBoard, pickForgeWords, placeLetter, placeTile, removeFrom, removeLast, wordPoints, type ForgeBoard, type ForgeWord } from './logic'

interface ForgeState {
  words: ForgeWord[]
  index: number
  board: ForgeBoard
  hints: number
  totalHints: number
  solved: number
  score: number
  status: { kind: 'solved' | 'skipped' | 'wrong'; text: string } | null
}

const EMPTY: ForgeState = { words: [], index: 0, board: { tiles: [], placed: [] }, hints: 0, totalHints: 0, solved: 0, score: 0, status: null }

/** Game Zone ▸ Word Forge — unscramble subject words from their meanings. */
export default function WordForge({ info, onExit }: GameProps) {
  const run = useGameRun(info)
  const { context } = useWellness()
  const topics = useMemo(() => vocabTopics(context.subjects), [context.subjects])
  const [topic, setTopic] = useState(() => defaultTopic(topics, context.knowledge.needsSupport))
  const [s, setS] = useState<ForgeState>(EMPTY)
  const sRef = useRef(s)
  const update = (next: ForgeState) => {
    sRef.current = next
    setS(next)
  }

  const start = () => {
    const words = pickForgeWords(vocabFor(topic, topics), FORGE_WORDS)
    update({ ...EMPTY, words, board: newBoard(words[0]?.answer ?? '') })
    run.start()
    if (words[0]) run.announce(`Meaning: ${words[0].clue}. ${words[0].answer.length} letters. Type the word or pick the letters.`)
  }

  /** Moves on to the next word, or ends the round after the last one. */
  const advance = (cur: ForgeState, status: ForgeState['status'], gained: number, solved: boolean) => {
    const score = cur.score + gained
    const solvedCount = cur.solved + (solved ? 1 : 0)
    const index = cur.index + 1
    if (index >= cur.words.length) {
      update({ ...cur, score, solved: solvedCount, status })
      run.play(TONES.done)
      run.finish({
        score,
        completed: true,
        headline: solvedCount === cur.words.length ? 'Every word forged!' : solvedCount >= cur.words.length / 2 ? 'Great recall!' : 'Good practice!',
        details: [`Solved ${solvedCount} of ${cur.words.length} words`, `Hints used: ${cur.totalHints}`],
      })
      return
    }
    const next = cur.words[index]
    update({ ...cur, index, board: newBoard(next.answer), hints: 0, score, solved: solvedCount, status })
    run.announce(`${status?.text ?? ''} Next meaning: ${next.clue}. ${next.answer.length} letters.`)
  }

  /** Applies a board change and checks a full board. */
  const change = (board: ForgeBoard, extra: Partial<ForgeState> = {}) => {
    if (!run.active) return
    const cur = { ...sRef.current, ...extra, board }
    const word = cur.words[cur.index]
    if (!word) return
    if (isSolved(board, word.answer)) {
      const gained = wordPoints(word.answer.length, cur.hints)
      run.play(TONES.good)
      advance(cur, { kind: 'solved', text: `Solved: ${word.answer} (+${gained}).` }, gained, true)
    } else if (isFull(board)) {
      run.play(TONES.soft)
      update({ ...cur, status: { kind: 'wrong', text: 'Not quite — take a letter back or use a hint.' } })
      run.announce(`${attempt(board)} is not it. Take a letter back or use a hint.`)
    } else {
      run.play(TONES.tap)
      update({ ...cur, status: cur.status?.kind === 'wrong' ? null : cur.status })
    }
  }

  const giveHint = () => {
    const cur = sRef.current
    const word = cur.words[cur.index]
    if (!word) return
    change(hint(cur.board, word.answer), { hints: cur.hints + 1, totalHints: cur.totalHints + 1 })
  }
  const skip = () => {
    if (!run.active) return
    const cur = sRef.current
    const word = cur.words[cur.index]
    if (!word) return
    run.play(TONES.soft)
    advance(cur, { kind: 'skipped', text: `Skipped: the word was ${word.answer}.` }, 0, false)
  }

  // Typing builds the word; Backspace takes the last letter back
  const changeRef = useRef(change)
  useEffect(() => { changeRef.current = change })
  useEffect(() => {
    if (!run.active) return
    const onKey = (e: KeyboardEvent) => {
      if (!isPlainKey(e)) return
      const b = sRef.current.board
      if (e.key === 'Backspace') {
        e.preventDefault()
        changeRef.current(removeLast(b))
      } else if (/^[a-z]$/i.test(e.key)) {
        e.preventDefault()
        changeRef.current(placeLetter(b, e.key))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run.active])

  const word = s.words[s.index]
  const placedLetters = attempt(s.board).split('')
  const wrong = s.status?.kind === 'wrong'
  return (
    <GameShell run={run} onExit={onExit} onStart={start}
      hud={[
        { label: 'Word', value: `${Math.min(s.index + 1, s.words.length)}/${s.words.length}` },
        { label: 'Score', value: s.score },
        { label: 'Hints', value: s.totalHints },
      ]}
      setup={<ChoiceChips label="Words from" options={topics} value={topic} onChange={setTopic} />}>
      {word && (
        <div className="flex flex-col items-center gap-4 rounded-xl bg-gradient-to-b from-sky-50 to-emerald-50/60 px-3 py-5 text-center">
          <div>
            <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Meaning · {word.answer.length} letters</p>
            <p className="m-0 mt-1 font-display text-lg font-semibold text-fg sm:text-xl">{word.clue}</p>
          </div>

          <ol aria-label={`Your word so far: ${placedLetters.join(' ') || 'empty'}`} className="m-0 flex list-none flex-wrap justify-center gap-1.5 p-0">
            {s.board.tiles.map((_, slot) => {
              const letter = placedLetters[slot]
              return (
                <li key={slot}>
                  {letter ? (
                    <button type="button" onClick={() => change(removeFrom(s.board, slot))} aria-label={`Take back ${letter} and the letters after it`}
                      className={cn('grid h-11 w-9 cursor-pointer place-items-center rounded-lg border-2 bg-ink-900 font-display text-xl font-bold text-fg sm:h-12 sm:w-10',
                        wrong ? 'border-dashed border-amber-400' : 'border-brand-400')}>
                      {letter}
                    </button>
                  ) : (
                    <span aria-hidden className="grid h-11 w-9 place-items-center rounded-lg border-2 border-dashed border-line-strong bg-ink-900/60 sm:h-12 sm:w-10" />
                  )}
                </li>
              )
            })}
          </ol>

          <div role="group" aria-label="Letters to place. You can also type them." className="flex flex-wrap justify-center gap-2">
            {s.board.tiles.map((t, i) => {
              const used = s.board.placed.includes(t.id)
              return (
                // aria-disabled rather than disabled, so keyboard focus stays put after placing a letter
                <button key={t.id} type="button" data-autofocus={i === 0 || undefined} aria-disabled={used || undefined}
                  onClick={() => { if (!used) change(placeTile(s.board, t.id)) }} aria-label={`Letter ${t.letter}${used ? ', placed' : ''}`}
                  className={cn('grid h-12 w-12 cursor-pointer place-items-center rounded-xl border-2 font-display text-xl font-bold shadow-sm transition',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2',
                    used ? 'cursor-default border-dashed border-line bg-transparent text-ink-500/40 shadow-none' : 'border-sky-300 bg-ink-900 text-fg hover:-translate-y-0.5 hover:border-sky-400')}>
                  {t.letter}
                </button>
              )
            })}
          </div>

          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => change(removeLast(s.board))} disabled={!s.board.placed.length}>
              <Delete className="h-4 w-4" aria-hidden />Undo letter
            </Button>
            <Button variant="secondary" size="sm" onClick={giveHint}><Lightbulb className="h-4 w-4" aria-hidden />Hint</Button>
            <Button variant="ghost" size="sm" onClick={skip}><SkipForward className="h-4 w-4" aria-hidden />Skip word</Button>
          </div>

          <p className="m-0 min-h-6 text-sm" aria-hidden>
            {s.status && (
              <span className={cn('inline-flex items-center gap-1 font-medium', s.status.kind === 'solved' ? 'text-ok' : 'text-ink-300')}>
                {s.status.kind === 'solved' ? <Check className="h-4 w-4" /> : s.status.kind === 'wrong' ? <X className="h-4 w-4" /> : <SkipForward className="h-4 w-4" />}
                {s.status.text}
              </span>
            )}
          </p>
        </div>
      )}
    </GameShell>
  )
}
