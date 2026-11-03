import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react'
import { CheckCircle2, Loader2, PlayCircle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { MAX_RATE, WatchTracker } from '@/lib/videoProgress'
import { loadYouTubeApi, YT_STATE, type YTPlayer } from '@/lib/youtubeApi'
import type { LabResource, VideoProgress, VideoReport } from '@/services/virtualLabService'

const REPORT_EVERY_MS = 10_000
const TICK_MS = 5_000

/**
 * Plays a lab video inside the app and records which parts were really watched (see lib/videoProgress): an HTML5
 * player streaming the file from its source host, or YouTube's own embedded player (through its IFrame API) for
 * YouTube-licensed items. Progress goes to the server on start, every few seconds while playing, on pause and at the
 * end; the server decides completion, which unlocks Submit. Nothing is downloaded or proxied.
 */
export function TrackedLabVideo({ resource, initial, onReport, height = '62vh' }: {
  resource: LabResource
  /** Progress recorded earlier (restored after a reload). */
  initial: VideoProgress | null
  onReport: (report: VideoReport) => Promise<VideoProgress | null>
  height?: string
}) {
  // One tracker per video, seeded once with what the server already holds.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tracker = useMemo(() => new WatchTracker(initial?.segments ?? [], initial?.duration_seconds ?? 0, initial?.reached_end ?? false), [resource.source_id])
  const [server, setServer] = useState<VideoProgress | null>(initial)
  const [coverage, setCoverage] = useState(() => tracker.coverage)
  const position = useRef(0)
  const playing = useRef(false)
  const lastSent = useRef(0)
  const busy = useRef(false)
  const again = useRef(false)
  const serverDone = useRef(!!initial?.completed)
  const reportRef = useRef(onReport)
  useEffect(() => { reportRef.current = onReport }, [onReport])

  const refresh = useCallback(() => setCoverage(Math.floor(tracker.coverage * 100) / 100), [tracker])

  const send = useCallback(async function send(): Promise<void> {
    if (!tracker.duration) return
    if (busy.current) { again.current = true; return }
    busy.current = true
    lastSent.current = Date.now()
    try {
      const p = await reportRef.current({ resource_id: resource.source_id, duration: tracker.duration, segments: tracker.segments,
        position: position.current, ended: tracker.endedSeen })
      if (p) { setServer(p); serverDone.current = p.completed }
    } catch { /* kept locally and sent again with the next report */ } finally {
      busy.current = false
      if (again.current) { again.current = false; void send() }
    }
  }, [resource.source_id, tracker])

  // While playing: a report every few seconds. After the end: keep reporting until the server has credited it
  // (it credits watched time at real-time speed, so a fast finish may need a moment).
  useEffect(() => {
    const id = window.setInterval(() => {
      if (serverDone.current) return
      if (playing.current ? Date.now() - lastSent.current >= REPORT_EVERY_MS : tracker.complete) void send()
    }, TICK_MS)
    return () => { window.clearInterval(id); if (!serverDone.current && tracker.covered > 0) void send() }
  }, [send, tracker])

  const events = useMemo(() => ({
    duration: (d: number) => { tracker.setDuration(d) },
    play: (t: number) => { tracker.play(t); position.current = t; playing.current = true; void send() },
    time: (t: number, rate: number) => { if (playing.current) { tracker.time(t, rate); position.current = t; refresh() } },
    seek: () => { tracker.seek() },
    resume: (t: number) => { if (playing.current) tracker.play(t) },
    pause: (t: number) => { if (playing.current) tracker.pause(t); position.current = t; playing.current = false; refresh(); void send() },
    end: (d: number) => { tracker.end(d); position.current = tracker.duration; playing.current = false; refresh(); void send() },
  }), [tracker, send, refresh])

  const done = !!server?.completed
  const pct = Math.round(Math.max(coverage, server?.coverage ?? 0) * 100)
  return (
    <div>
      {resource.access.viewer === 'youtube' && resource.access.video_id
        ? <YouTubeTracked videoId={resource.access.video_id} events={events} />
        : <Html5Tracked src={resource.access.src ?? ''} title={resource.name ?? 'Video'} height={height} events={events} />}
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2 text-xs" data-testid="video-progress" aria-live="polite">
        {done ? (
          <span className="flex items-center gap-1.5 font-medium text-ok"><CheckCircle2 className="h-4 w-4" /> Watched to the end</span>
        ) : (
          <>
            <span className="flex items-center gap-1.5 text-ink-300"><PlayCircle className="h-4 w-4 text-brand-600" /> Watched {pct}%</span>
            <Progress value={pct} className="min-w-24 flex-1" />
            <span className="text-ink-500">{tracker.complete ? 'Saving your progress…' : 'Watch to the end to unlock Submit'}</span>
          </>
        )}
      </div>
    </div>
  )
}

type Events = {
  duration: (d: number) => void
  play: (t: number) => void
  time: (t: number, rate: number) => void
  seek: () => void
  resume: (t: number) => void
  pause: (t: number) => void
  end: (d: number) => void
}

function Html5Tracked({ src, title, height, events }: { src: string; title: string; height: string; events: Events }) {
  const [failed, setFailed] = useState(0)
  const v = (e: SyntheticEvent<HTMLVideoElement>) => e.currentTarget
  if (failed % 2 === 1) {
    return (
      <div className="grid place-items-center px-6 py-12 text-center">
        <p className="font-display text-base font-semibold text-fg">This video could not be played</p>
        <p className="mt-1 text-sm text-ink-300">Check your connection and try again. What you watched so far is saved.</p>
        <Button className="mt-4" variant="secondary" onClick={() => setFailed((n) => n + 1)}><RotateCcw className="h-4 w-4" /> Try again</Button>
      </div>
    )
  }
  return (
    <video key={failed} controls preload="metadata" src={src} style={{ maxHeight: height }} className="mx-auto block w-full bg-black" aria-label={title}
      controlsList="nodownload" disablePictureInPicture
      onLoadedMetadata={(e) => events.duration(v(e).duration)} onDurationChange={(e) => events.duration(v(e).duration)}
      onPlay={(e) => events.play(v(e).currentTime)}
      onTimeUpdate={(e) => events.time(v(e).currentTime, v(e).playbackRate)}
      onSeeking={() => events.seek()} onSeeked={(e) => events.resume(v(e).currentTime)}
      onPause={(e) => { if (!v(e).ended) events.pause(v(e).currentTime) }}
      onEnded={(e) => events.end(v(e).duration)}
      onRateChange={(e) => { if (v(e).playbackRate > MAX_RATE) v(e).playbackRate = MAX_RATE }}
      onError={() => setFailed((n) => n + 1)}>
      Your browser cannot play this video.
    </video>
  )
}

function YouTubeTracked({ videoId, events }: { videoId: string; events: Events }) {
  const box = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let dead = false
    let player: YTPlayer | null = null
    let poll: number | undefined
    const stop = () => { window.clearInterval(poll); poll = undefined }
    loadYouTubeApi().then((YT) => {
      if (dead || !box.current) return
      const el = document.createElement('div')
      box.current.replaceChildren(el)
      const p: YTPlayer = new YT.Player(el, {
        videoId, host: 'https://www.youtube-nocookie.com', width: '100%', height: '100%',
        playerVars: { rel: 0, playsinline: 1, modestbranding: 1, origin: window.location.origin },
        events: {
          onReady: () => { if (!dead) { setState('ready'); events.duration(p.getDuration()) } },
          onStateChange: (e) => {
            const t = p.getCurrentTime()
            if (e.data === YT_STATE.PLAYING) {
              events.duration(p.getDuration()); events.play(t); stop()
              poll = window.setInterval(() => events.time(p.getCurrentTime(), p.getPlaybackRate()), 500)
            } else if (e.data === YT_STATE.BUFFERING) {
              // seeking shows up as buffering: count up to here, but never the jump
              events.time(t, p.getPlaybackRate()); events.seek()
            } else if (e.data === YT_STATE.PAUSED) { stop(); events.pause(t) }
            else if (e.data === YT_STATE.ENDED) { stop(); events.end(p.getDuration()) }
          },
          onPlaybackRateChange: (e) => { if (e.data > MAX_RATE) p.setPlaybackRate(MAX_RATE) },
          onError: () => { if (!dead) setState('failed') },
        },
      })
      player = p
    }).catch(() => { if (!dead) setState('failed') })
    return () => { dead = true; stop(); player?.destroy() }
  }, [videoId, attempt, events])

  return (
    <div className="relative w-full bg-black" style={{ paddingTop: '56.25%' }}>
      <div ref={box} className="absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full" />
      {state !== 'ready' && (
        <div className="absolute inset-0 grid place-items-center bg-ink-900 px-6 text-center">
          {state === 'loading' ? <Loader2 className="h-6 w-6 animate-spin text-ink-500" aria-label="Loading video" /> : (
            <div>
              <p className="font-display text-base font-semibold text-fg">The video player could not load</p>
              <p className="mt-1 text-sm text-ink-300">Check your connection and try again. What you watched so far is saved.</p>
              <Button className="mt-4" variant="secondary" onClick={() => { setState('loading'); setAttempt((n) => n + 1) }}><RotateCcw className="h-4 w-4" /> Try again</Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
