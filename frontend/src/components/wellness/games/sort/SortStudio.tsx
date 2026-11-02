import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { Check, GripVertical, X } from 'lucide-react'
import { useWellness } from '@/components/wellness/WellnessContext'
import { cn } from '@/lib/utils'
import type { GameProps } from '../catalog'
import { ChoiceChips, GameShell } from '../GameShell'
import { TONES, isPlainKey } from '../gridKeys'
import { useGameRun } from '../useGameRun'
import { SORT_ROUND, bucketLabel, buildSortRound, judgeSort, setsForSubjects, sortPoints, type SortItem, type SortSet } from './logic'

interface SortState {
  set: SortSet
  items: SortItem[]
  index: number
  correct: number
  streak: number
  bestStreak: number
  score: number
  placed: Record<string, string[]>
  misses: SortItem[]
  feedback: { right: boolean; text: string } | null
}

const fresh = (set: SortSet, items: SortItem[] = []): SortState =>
  ({ set, items, index: 0, correct: 0, streak: 0, bestStreak: 0, score: 0, placed: {}, misses: [], feedback: null })

/** Game Zone ▸ Sort Studio — drag (or tap, or key) each item into the right group. */
export default function SortStudio({ info, onExit }: GameProps) {
  const run = useGameRun(info)
  const { context } = useWellness()
  const sets = useMemo(() => setsForSubjects(context.subjects), [context.subjects])
  const [setId, setSetId] = useState(sets[0].id)
  const [s, setS] = useState<SortState>(() => fresh(sets[0]))
  const sRef = useRef(s)
  const update = (next: SortState) => {
    sRef.current = next
    setS(next)
  }
  const cardRef = useRef<HTMLDivElement>(null)
  const bucketEls = useRef(new Map<string, HTMLElement>())
  const drag = useRef<{ pointer: number; x0: number; y0: number } | null>(null)
  const [hover, setHover] = useState<string | null>(null)

  const start = () => {
    const set = sets.find((x) => x.id === setId) ?? sets[0]
    const round = buildSortRound(set, SORT_ROUND)
    update(fresh(set, round))
    run.start()
    run.announce(`${set.title}. First item: ${round[0]?.text}. Press a group's number or choose it.`)
  }

  const choose = (bucketId: string) => {
    const cur = sRef.current
    const item = cur.items[cur.index]
    if (!run.active || !item) return
    const right = judgeSort(item, bucketId)
    const streak = right ? cur.streak + 1 : 0
    const where = bucketLabel(cur.set, item.bucket)
    const feedback = right
      ? { right, text: `${item.text} → ${where}` }
      : { right, text: `${item.text} goes in ${where}.${item.why ? ` ${item.why}` : ''}` }
    const next: SortState = {
      ...cur,
      index: cur.index + 1,
      correct: cur.correct + (right ? 1 : 0),
      streak,
      bestStreak: Math.max(cur.bestStreak, streak),
      score: cur.score + (right ? sortPoints(streak) : 0),
      placed: { ...cur.placed, [item.bucket]: [...(cur.placed[item.bucket] ?? []), item.text] },
      misses: right ? cur.misses : [...cur.misses, item],
      feedback,
    }
    update(next)
    run.play(right ? TONES.good : TONES.soft)
    const upcoming = next.items[next.index]
    if (!upcoming) {
      run.play(TONES.done)
      run.finish({
        score: next.score,
        completed: true,
        headline: next.correct === next.items.length ? 'A perfect sort!' : next.correct >= next.items.length * 0.7 ? 'Nicely sorted!' : 'Good practice!',
        details: [
          `${next.correct} of ${next.items.length} sorted correctly`,
          `Longest streak: ${next.bestStreak}`,
          ...(next.misses.length ? [`To review: ${next.misses.slice(0, 3).map((m) => `${m.text} → ${bucketLabel(next.set, m.bucket)}`).join(', ')}`] : []),
        ],
      })
      return
    }
    run.announce(`${right ? 'Correct' : 'Not quite'}: ${feedback.text} Next: ${upcoming.text}.`)
  }

  // Keys 1–3 drop the card into a group
  const chooseRef = useRef(choose)
  useEffect(() => { chooseRef.current = choose })
  useEffect(() => {
    if (!run.active) return
    const onKey = (e: KeyboardEvent) => {
      const bucket = sRef.current.set.buckets[Number(e.key) - 1]
      if (!bucket || !isPlainKey(e)) return
      e.preventDefault()
      chooseRef.current(bucket.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run.active])

  // Dragging with a mouse, pen or finger (pointer events), dropped on whichever group is under the pointer
  const bucketAt = (x: number, y: number): string | null => {
    for (const [id, el] of bucketEls.current) {
      const r = el.getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id
    }
    return null
  }
  const resetCard = () => {
    drag.current = null
    setHover(null)
    if (cardRef.current) cardRef.current.style.transform = ''
  }
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!run.active || (e.pointerType === 'mouse' && e.button !== 0)) return
    drag.current = { pointer: e.pointerId, x0: e.clientX, y0: e.clientY }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointer !== e.pointerId || !cardRef.current) return
    const dx = e.clientX - d.x0
    const dy = e.clientY - d.y0
    cardRef.current.style.transform = `translate(${dx}px, ${dy}px)${run.reducedMotion ? '' : ` rotate(${Math.max(-8, Math.min(8, dx / 25))}deg)`}`
    setHover(bucketAt(e.clientX, e.clientY))
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointer !== e.pointerId) return
    const target = bucketAt(e.clientX, e.clientY)
    resetCard()
    if (target) choose(target)
  }

  const item = s.items[s.index]
  const cols = s.set.buckets.length === 3 ? 'grid-cols-3' : 'grid-cols-2'
  return (
    <GameShell run={run} onExit={onExit} onStart={start}
      hud={[
        { label: 'Item', value: `${Math.min(s.index + 1, s.items.length)}/${s.items.length}` },
        { label: 'Score', value: s.score },
        { label: 'Correct', value: s.correct },
      ]}
      setup={<ChoiceChips label="Sort" options={sets.map((x) => ({ id: x.id, label: x.title }))} value={setId} onChange={setSetId} />}>
      <div className="flex flex-col items-center gap-4 rounded-xl bg-gradient-to-b from-lime-50 to-teal-50/60 px-3 py-5">
        <p className="m-0 text-sm font-semibold text-fg">{s.set.title}</p>
        <div className="flex min-h-20 items-center justify-center">
          {item && (
            <div ref={cardRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={resetCard}
              style={{ touchAction: 'none' }}
              className="flex cursor-grab touch-none select-none items-center gap-2 rounded-xl border-2 border-teal-300 bg-ink-900 px-5 py-3 font-display text-lg font-semibold text-fg shadow-md active:cursor-grabbing">
              <GripVertical className="h-4 w-4 text-ink-500" aria-hidden />
              <span><span className="sr-only">Item to sort: </span>{item.text}</span>
            </div>
          )}
        </div>
        <div className={cn('grid w-full max-w-xl gap-2 sm:gap-3', cols)} role="group" aria-label="Groups. Drag the item here, tap a group, or press its number.">
          {s.set.buckets.map((bucket, i) => (
            <button key={bucket.id} type="button" data-autofocus={i === 0 || undefined} onClick={() => choose(bucket.id)}
              ref={(el) => { if (el) bucketEls.current.set(bucket.id, el); else bucketEls.current.delete(bucket.id) }}
              aria-label={`${bucket.label}, key ${i + 1}`}
              className={cn('flex min-h-32 cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-2 text-center transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2',
                hover === bucket.id ? 'border-solid border-teal-500 bg-teal-50' : 'border-line-strong bg-ink-900/70 hover:border-teal-400')}>
              <span className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                <span aria-hidden className="rounded border border-line px-1 text-[10px] text-ink-500">{i + 1}</span>{bucket.label}
              </span>
              <span aria-hidden className="flex flex-wrap justify-center gap-1">
                {(s.placed[bucket.id] ?? []).slice(-4).map((t) => (
                  <span key={t} className="rounded-full bg-teal-100/80 px-2 py-0.5 text-[10px] font-medium text-teal-900">{t}</span>
                ))}
              </span>
            </button>
          ))}
        </div>
        <p className="m-0 min-h-10 max-w-xl text-center text-sm" aria-hidden>
          {s.feedback && (
            <span className={cn('inline-flex items-start gap-1 font-medium', s.feedback.right ? 'text-ok' : 'text-ink-300')}>
              {s.feedback.right ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <X className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>{s.feedback.right ? 'Correct: ' : 'Not quite: '}{s.feedback.text}</span>
            </span>
          )}
        </p>
      </div>
    </GameShell>
  )
}
