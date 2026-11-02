import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Check, Eraser, FlipHorizontal2, Flag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { GameProps } from '../catalog'
import { formatClock, useGameClock } from '../clock'
import { GameShell } from '../GameShell'
import { ROUND, TONES } from '../gridKeys'
import { useGameRun } from '../useGameRun'
import { CANVAS_SIZE, MIN_CALM_MS, SAND_COLORS, SYMMETRIES, calmScore, moveBrush, symmetricSegments, type Pt, type SandColor, type Symmetry } from './logic'

const CENTER: Pt = { x: CANVAS_SIZE / 2, y: CANVAS_SIZE / 2 }
const SAND = '#fdf3e1'
const BRUSHES = [{ id: 'fine', label: 'Fine', width: 4 }, { id: 'broad', label: 'Broad', width: 10 }] as const
type BrushId = (typeof BRUSHES)[number]['id']

/** Smooths the canvas to plain sand with faint guide rings. */
function paintSand(ctx: CanvasRenderingContext2D) {
  ctx.globalAlpha = 1
  ctx.fillStyle = SAND
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
  ctx.strokeStyle = 'rgba(180, 140, 90, 0.18)'
  ctx.lineWidth = 1
  for (let r = 60; r < CANVAS_SIZE / 2; r += 60) {
    ctx.beginPath()
    ctx.arc(CENTER.x, CENTER.y, r, 0, Math.PI * 2)
    ctx.stroke()
  }
}

/** Game Zone ▸ Sand Mandala — a calm, symmetric drawing canvas with no way to fail. */
export default function SandMandala({ info, onExit }: GameProps) {
  const run = useGameRun(info)
  const helpId = useId()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [folds, setFolds] = useState<Symmetry>(8)
  const [mirror, setMirror] = useState(true)
  const [color, setColor] = useState<SandColor>('terracotta')
  const [brush, setBrush] = useState<BrushId>('fine')
  const [strokes, setStrokes] = useState(0)
  const [cursor, setCursor] = useState<Pt>(CENTER)
  const [penDown, setPenDown] = useState(false)
  const lastRef = useRef<Pt | null>(null)
  const pointerRef = useRef<number | null>(null)
  const clock = useGameClock(run.active, { tickMs: 500 })

  const ctx = () => canvasRef.current?.getContext('2d') ?? null

  // A fresh sheet of sand for every round (the canvas mounts when play starts)
  useEffect(() => {
    if (run.phase !== 'playing') return
    const c = ctx()
    if (c) paintSand(c)
  }, [run.phase, run.round])

  const draw = (a: Pt, b: Pt) => {
    const c = ctx()
    if (!c) return
    const hex = SAND_COLORS.find((x) => x.id === color)?.hex ?? '#000'
    const width = BRUSHES.find((x) => x.id === brush)?.width ?? 4
    c.lineCap = 'round'
    c.lineJoin = 'round'
    c.strokeStyle = hex
    for (const [p, q] of symmetricSegments(a, b, CENTER, folds, mirror)) {
      // A soft halo, then the grain line: reads as sand rather than ink
      c.globalAlpha = 0.18
      c.lineWidth = width * 2.4
      c.beginPath()
      c.moveTo(p.x, p.y)
      c.lineTo(q.x, q.y)
      c.stroke()
      c.globalAlpha = 0.85
      c.lineWidth = width
      c.beginPath()
      c.moveTo(p.x, p.y)
      c.lineTo(q.x, q.y)
      c.stroke()
    }
    c.globalAlpha = 1
  }

  const toCanvas = (e: PointerEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / (r.width || 1)) * CANVAS_SIZE, y: ((e.clientY - r.top) / (r.height || 1)) * CANVAS_SIZE }
  }
  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!run.active || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pointerRef.current = e.pointerId
    const p = toCanvas(e)
    lastRef.current = p
    draw(p, p)
  }
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (pointerRef.current !== e.pointerId || !lastRef.current) return
    const p = toCanvas(e)
    draw(lastRef.current, p)
    lastRef.current = p
  }
  const endStroke = () => {
    if (pointerRef.current === null) return
    pointerRef.current = null
    lastRef.current = null
    setStrokes((n) => n + 1)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    if (!run.active) return
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      const next = !penDown
      setPenDown(next)
      if (next) draw(cursor, cursor)
      else setStrokes((n) => n + 1)
      run.announce(next ? 'Brush down: drawing' : 'Brush up')
      return
    }
    const p = moveBrush(cursor, e.key, e.shiftKey)
    if (!p) return
    e.preventDefault()
    if (penDown) draw(cursor, p)
    setCursor(p)
  }

  const smooth = () => {
    const c = ctx()
    if (c) paintSand(c)
    run.play(TONES.breatheOut)
    run.announce('The sand is smooth again.')
  }

  const start = () => {
    setStrokes(0)
    setPenDown(false)
    setCursor(CENTER)
    clock.reset()
    run.start()
  }

  const finish = () => {
    const ms = clock.read()
    const completed = ms >= MIN_CALM_MS
    let picture: string | null = null
    try { if (ctx()) picture = canvasRef.current?.toDataURL('image/png') ?? null } catch { picture = null }
    run.play(TONES.done)
    run.finish({
      score: calmScore(ms),
      completed,
      headline: 'A peaceful pattern',
      details: [
        `Calm time: ${formatClock(ms)}`,
        `Strokes: ${strokes}`,
      ],
      scoreLabel: 'Calm seconds',
      xpNote: `Stay at least ${MIN_CALM_MS / 1000} seconds to earn XP.`,
      extra: picture ? (
        <figure className="m-0 flex flex-col items-center gap-2">
          <img src={picture} alt="Your finished sand mandala" className="h-40 w-40 rounded-full border border-line object-cover shadow-sm" />
          <a href={picture} download="sand-mandala.png" className="text-xs font-medium text-brand-600 underline underline-offset-2">Save picture</a>
        </figure>
      ) : undefined,
    })
  }

  const elapsed = clock.elapsedMs
  return (
    <GameShell run={run} onExit={onExit} onStart={start}
      hud={[
        { label: 'Calm time', value: formatClock(elapsed) },
        { label: 'Strokes', value: strokes },
        { label: 'Symmetry', value: `${folds}${mirror ? ' + mirror' : ''}` },
      ]}>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
        <div className="relative mx-auto aspect-square w-full max-w-[520px]">
          <canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} data-autofocus tabIndex={0}
            role="application" aria-label="Sand mandala canvas" aria-describedby={helpId}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endStroke} onPointerCancel={endStroke}
            onKeyDown={onKeyDown}
            style={{ ...ROUND, touchAction: 'none' }}
            className="peer h-full w-full cursor-crosshair rounded-full border-4 border-amber-200 shadow-inner focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-400/50" />
          {/* Keyboard brush position (shown while the canvas has focus) */}
          <span aria-hidden className={cn('pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-fg/70',
            penDown ? 'bg-fg/40' : 'bg-transparent', 'opacity-0 peer-focus-visible:opacity-100')}
            style={{ left: `${(cursor.x / CANVAS_SIZE) * 100}%`, top: `${(cursor.y / CANVAS_SIZE) * 100}%` }} />
          <p id={helpId} className="sr-only">
            Draw with a mouse, pen or finger; every stroke is repeated around the centre. With the keyboard, arrow keys move the
            brush (hold Shift for small steps) and Space lowers or lifts it.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <div role="group" aria-label="Symmetry" className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-ink-300">Symmetry</span>
            <div className="flex flex-wrap gap-2">
              {SYMMETRIES.map((n) => (
                <Button key={n} size="sm" variant="secondary" aria-pressed={folds === n} onClick={() => setFolds(n)}
                  className={cn(folds === n && 'border-brand-400 bg-brand-500/10 text-brand-600')}>{n}-fold</Button>
              ))}
              <Button size="sm" variant="secondary" aria-pressed={mirror} onClick={() => setMirror((m) => !m)}
                className={cn(mirror && 'border-brand-400 bg-brand-500/10 text-brand-600')}>
                <FlipHorizontal2 className="h-4 w-4" aria-hidden />Mirror
              </Button>
            </div>
          </div>
          <div role="group" aria-label="Sand colour" className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-ink-300">Sand colour</span>
            <div className="flex flex-wrap gap-2">
              {SAND_COLORS.map((c) => (
                <button key={c.id} type="button" aria-pressed={color === c.id} aria-label={c.name} title={c.name} onClick={() => setColor(c.id)}
                  className={cn('grid h-9 w-9 cursor-pointer place-items-center rounded-full border-2 text-white',
                    color === c.id ? 'border-fg ring-2 ring-brand-400 ring-offset-2' : 'border-white')}
                  style={{ ...ROUND, backgroundColor: c.hex }}>
                  {color === c.id && <Check className="h-4 w-4" aria-hidden />}
                </button>
              ))}
            </div>
          </div>
          <div role="group" aria-label="Brush" className="flex flex-wrap gap-2">
            {BRUSHES.map((b) => (
              <Button key={b.id} size="sm" variant="secondary" aria-pressed={brush === b.id} onClick={() => setBrush(b.id)}
                className={cn(brush === b.id && 'border-brand-400 bg-brand-500/10 text-brand-600')}>{b.label} brush</Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <Button size="sm" variant="secondary" onClick={smooth}><Eraser className="h-4 w-4" aria-hidden />Smooth the sand</Button>
            <Button size="sm" onClick={finish}><Flag className="h-4 w-4" aria-hidden />Finish</Button>
          </div>
          <p className="m-0 text-xs text-ink-300">
            {elapsed >= MIN_CALM_MS ? 'Finish whenever you feel ready.' : `Stay ${Math.ceil((MIN_CALM_MS - elapsed) / 1000)} s more to earn XP — no rush.`}
          </p>
        </div>
      </div>
    </GameShell>
  )
}
