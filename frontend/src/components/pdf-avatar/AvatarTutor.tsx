import { useState } from 'react'
import { BookOpenText, CheckCircle2, ChevronDown, CircleAlert, Clock3, GraduationCap, Loader2, Pause, Play, SkipBack, SkipForward, Square, Volume2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/field'
import { cn } from '@/lib/utils'
import type { Readiness, ReadMode } from '@/services/readAloudService'
import { AvatarStage } from './AvatarStage'
import type { ReadAloud } from './useReadAloud'

const SPEEDS = [0.75, 1, 1.25, 1.5]
const MODES: { id: ReadMode; label: string; icon: typeof GraduationCap }[] = [
  { id: 'explain', label: 'Teacher explains', icon: GraduationCap },
  { id: 'read', label: 'Word for word', icon: BookOpenText },
]

/**
 * Avatar tutor pane of the AI Classroom: the subject teacher's avatar explains the open textbook page like a teacher
 * (key points, terms, recap, a question) — or reads it word for word — with lip-sync, captions and the teacher's notes.
 */
export function AvatarTutor({ reader, page, modelUrl }: {
  reader: ReadAloud
  page: number
  /** Preloaded 3D model (object URL), or null to use the 2D avatar; omitted = load it here. */
  modelUrl?: string | null
}) {
  const { status, voice, mode, lesson } = reader
  const name = voice?.teacher?.name ?? 'Your teacher'
  const gender = voice?.voice ?? 'female'
  const playing = status === 'playing'
  const busy = status === 'loading'
  const explain = mode === 'explain'
  const point = reader.segment?.point ?? null
  const [details, setDetails] = useState(false)

  const toggle = () => {
    if (playing) reader.pause()
    else if (status === 'paused') reader.resume()
    else reader.start(page)
  }

  const caption = reader.voiceError
    ? `The avatar tutor is not available: ${reader.voiceError}`
    : reader.reading && reader.text
      ? reader.text
      : busy
        ? explain ? `Preparing the explanation of page ${reader.page}…` : `Preparing page ${reader.page}…`
        : status === 'done'
          ? `That's all for page ${reader.page}. Press “${explain ? 'Explain page' : 'Read page'}” to hear it again, or open another page.`
          : explain
            ? `I'm ${name}'s AI avatar. Press “Explain page” and I'll explain page ${page} to you: the key points, important words and a quick recap.`
            : `I'm ${name}'s AI avatar. Press “Read page” and I'll read page ${page} to you word for word.`

  return (
    <div className="relative flex h-full flex-col gap-3 overflow-hidden p-4 sm:flex-row sm:items-start">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_40%,hsl(258_90%_60%/0.12),transparent_55%)]" />
      <div className="relative shrink-0 self-center sm:self-start">
        <AvatarStage
          gender={gender}
          modelUrl={modelUrl}
          speaking={playing}
          label={`${name}'s avatar${playing ? ', speaking' : ''}`}
          className={cn('h-52 w-40 overflow-hidden rounded-2xl ring-1 ring-line',
            gender === 'male' ? 'bg-gradient-to-b from-indigo-100 to-white' : 'bg-gradient-to-b from-pink-100 via-violet-50 to-white')}
        />
        {playing && <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-fg/75 px-2 py-0.5 text-[10px] font-medium text-white">Speaking</span>}
      </div>

      <div className="relative min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-display font-semibold text-fg" id="avatar-teacher-name">{reader.voiceLoading ? '…' : name}</p>
          {voice && (
            <Badge tone="brand" title={voice.engine}>
              <Volume2 className="h-3 w-3" /> {gender === 'male' ? 'Male voice' : 'Female voice'}
            </Badge>
          )}
          {reader.reading && <Badge tone="aqua">{explain ? 'Explaining' : 'Reading'} page {reader.page}</Badge>}
        </div>

        <div role="group" aria-label="What the tutor does" className="inline-flex rounded-lg border border-line bg-ink-800 p-0.5">
          {MODES.map((m) => (
            <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => mode !== m.id && reader.setMode(m.id)}
              className={cn('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                mode === m.id ? 'bg-ink-900 text-fg shadow-sm ring-1 ring-line' : 'text-ink-300 hover:text-fg')}>
              <m.icon className="h-3.5 w-3.5" /> {m.label}
            </button>
          ))}
        </div>

        <p id="avatar-caption" className={cn('line-clamp-3 min-h-[3.75rem] text-sm leading-5', reader.reading ? 'text-fg' : 'text-ink-300')}>
          {caption}
        </p>

        {reader.reading && reader.total > 0 && (
          <div className="space-y-1" aria-hidden="true">
            <div className="h-1 overflow-hidden rounded-full bg-ink-700">
              <div className="h-full rounded-full bg-gradient-to-r from-brand-400 to-aqua-400 transition-[width] duration-300"
                style={{ width: `${((reader.index + 1) / reader.total) * 100}%` }} />
            </div>
            <p className="text-xs text-ink-500">Page {reader.page} · part {reader.index + 1} of {reader.total}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="icon" variant="ghost" aria-label="Previous part" onClick={() => reader.skip(-1)} disabled={!reader.reading}>
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button size="sm" id="read-aloud-toggle" onClick={toggle} disabled={busy || !voice}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {busy ? 'Preparing…' : playing ? 'Pause' : status === 'paused' ? 'Resume' : explain ? 'Explain page' : 'Read page'}
          </Button>
          <Button size="icon" variant="ghost" aria-label="Next part" onClick={() => reader.skip(1)} disabled={!reader.reading}>
            <SkipForward className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Stop" onClick={reader.stop} disabled={status === 'idle'}>
            <Square className="h-3.5 w-3.5" />
          </Button>
          <Select aria-label="Speaking speed" className="h-8 w-[4.5rem] px-2 text-xs" value={reader.rate} onChange={(e) => reader.setRate(Number(e.target.value))}>
            {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
          </Select>
          <label className="ml-1 flex items-center gap-1.5 text-xs text-ink-300">
            <input type="checkbox" className="accent-brand-500" checked={reader.autoTurn} onChange={(e) => reader.setAutoTurn(e.target.checked)} />
            Continue to next page
          </label>
        </div>
        {status === 'error' && reader.error && <p role="alert" className="text-xs text-bad">{reader.error}</p>}
        {reader.ready && !reader.voiceError && (
          <div className="flex flex-wrap gap-x-3 gap-y-1" aria-live="polite" id="tutor-readiness">
            {!reader.reading && <ReadyChip status={reader.ready.status} label={`page ${reader.ready.page}`} />}
            {reader.ready.next && <ReadyChip status={reader.ready.next.status} label={`next page (${reader.ready.next.page})`} />}
          </div>
        )}

        {explain && lesson && lesson.key_points.length > 0 && (
          <section aria-labelledby="tutor-notes-h" className="rounded-lg border border-line bg-ink-900/70 p-2.5">
            <div className="mb-1 flex items-center gap-2">
              <h3 id="tutor-notes-h" className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-ink-500">
                Teacher's notes · {lesson.title || `page ${reader.page}`}
              </h3>
              <button type="button" aria-expanded={details} onClick={() => setDetails((d) => !d)}
                className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-brand-300 hover:underline">
                {details ? 'Hide details' : 'Show details'} <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', details && 'rotate-180')} />
              </button>
            </div>
            <ol className={cn('space-y-0.5 overflow-y-auto pr-1 text-xs', details ? 'max-h-48' : 'max-h-24')}>
              {lesson.key_points.map((k, i) => (
                <li key={i} aria-current={point === i ? 'true' : undefined}
                  className={cn('flex gap-2 rounded-md px-1.5 py-0.5', point === i ? 'bg-brand-500/10 text-fg' : 'text-ink-300')}>
                  <span className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full bg-brand-500/15 text-[10px] font-semibold text-brand-300">{i + 1}</span>
                  <span className={cn(!details && 'truncate')}>
                    <b className="font-medium text-fg">{k.heading || `Point ${i + 1}`}</b>{details ? ` — ${k.explanation}` : ''}
                  </span>
                </li>
              ))}
              {lesson.terms.length > 0 && (
                <li className="px-1.5 pt-1 text-ink-500">
                  <b className="font-medium text-ink-300">Words to remember:</b> {lesson.terms.map((t) => t.term).join(', ')}
                </li>
              )}
            </ol>
          </section>
        )}
      </div>
    </div>
  )
}

const READY: Record<Readiness, { icon: typeof Clock3; text: (what: string) => string; cls: string }> = {
  ready: { icon: CheckCircle2, text: (w) => `${w[0].toUpperCase()}${w.slice(1)} ready`, cls: 'text-ok' },
  preparing: { icon: Loader2, text: (w) => `Preparing ${w}…`, cls: 'text-ink-300' },
  queued: { icon: Clock3, text: (w) => `${w[0].toUpperCase()}${w.slice(1)} queued`, cls: 'text-ink-500' },
  idle: { icon: Clock3, text: (w) => `${w[0].toUpperCase()}${w.slice(1)} queued`, cls: 'text-ink-500' },
  failed: { icon: CircleAlert, text: (w) => `Couldn't prepare ${w} yet`, cls: 'text-warn' },
}

/** How far the open / next page has been prepared (script + first spoken part), so Next feels instant. */
function ReadyChip({ status, label }: { status: Readiness; label: string }) {
  const r = READY[status]
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px]', r.cls)} data-ready={status}>
      <r.icon className={cn('h-3 w-3', status === 'preparing' && 'animate-spin')} aria-hidden /> {r.text(label)}
    </span>
  )
}
