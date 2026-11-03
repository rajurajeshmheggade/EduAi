import { useCallback, useEffect, useRef, useState } from 'react'
import { readerAudio, readerLipsync } from '@/lib/readerAudio'
import { RequestCache } from '@/lib/requestCache'
import { errorMessage } from '@/services/apiClient'
import {
  readAloudService, type PageLesson, type ReadAloudPage, type ReadAloudSegment, type ReadAloudVoice, type Readiness, type ReadMode,
} from '@/services/readAloudService'

export type ReadStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'done' | 'error'

interface ReaderState {
  book: string
  status: ReadStatus
  page: number
  index: number                      // part being spoken
  total: number                      // parts on that page
  segment: ReadAloudSegment | null   // part being spoken (caption, quote, key point)
  lesson: PageLesson | null          // the AI teacher's notes for that page (explain mode)
  error: string | null
}

/** How ready the open page and the next one are to be explained: script + first spoken part on this device. */
export interface PageReady {
  book: string
  mode: ReadMode
  page: number
  status: Readiness
  next: { page: number; status: Readiness } | null
}

const idle = (book: string): ReaderState => ({ book, status: 'idle', page: 1, index: 0, total: 0, segment: null, lesson: null, error: null })
const PAGES_KEPT = 6     // page scripts kept in memory
const CLIPS_KEPT = 8     // object URLs of synthesised audio kept (current page's next parts, next page's first part)
/** A page has to stay open this long before it is prepared, so flipping through pages costs nothing. */
export const PREFETCH_DELAY_MS = 300

const pageKey = (mode: ReadMode, page: number) => `${mode}:${page}`
const keyPage = (key: string) => Number(key.split(':')[1])

/**
 * The AI avatar tutor explains (or reads) the open textbook page aloud, part by part: the script and audio come from
 * the read-aloud API (voice = the subject teacher's) and the tutor turns the page when one is finished.
 *
 * As soon as a page is open (`viewPage`, even while the tutor is silent) its script and first part are fetched, then
 * the next page's, so pressing Explain or turning the page starts at once; the server's pipeline prepares further
 * pages in the background. Requests live in bounded caches; when the student jumps elsewhere, unfinished requests
 * for pages they left are cancelled.
 */
export function useReadAloud(textbookId: string, onTurnPage: (page: number) => void, viewPage?: number) {
  const [state, setState] = useState<ReaderState>(() => idle(textbookId))
  const [voice, setVoice] = useState<{ book: string; data: ReadAloudVoice | null; error: string | null } | null>(null)
  const [rate, setRateState] = useState(1)
  const [autoTurn, setAutoTurnState] = useState(true)
  const [mode, setModeState] = useState<ReadMode>('explain')
  const [ready, setReady] = useState<PageReady | null>(null)

  const run = useRef(0)                  // bumped by every start / stop: stale async steps bail out
  const pos = useRef({ page: 0, index: 0 })
  const status = useRef<ReadStatus>('idle')
  const opts = useRef({ rate: 1, autoTurn: true, mode: 'explain' as ReadMode, onTurnPage })
  const voiceReq = useRef<{ book: string; promise: Promise<ReadAloudVoice> } | null>(null)
  const [pages] = useState(() => new RequestCache<ReadAloudPage>(PAGES_KEPT))
  const [clips] = useState(() => new RequestCache<string>(CLIPS_KEPT, (u) => { if (readerAudio().src !== u) URL.revokeObjectURL(u) }))

  useEffect(() => { opts.current.onTurnPage = onTurnPage }, [onTurnPage])
  useEffect(() => { status.current = state.book === textbookId ? state.status : 'idle' }, [state, textbookId])

  /** The teacher's voice for this book (one request, shared by the tutor and the classroom's readiness check). */
  const whenVoice = useCallback(() => {
    if (voiceReq.current?.book !== textbookId) {
      const promise = readAloudService.voice(textbookId)
      promise.catch(() => { if (voiceReq.current?.promise === promise) voiceReq.current = null })   // retry next time
      voiceReq.current = { book: textbookId, promise }
    }
    return voiceReq.current.promise
  }, [textbookId])

  useEffect(() => {
    if (!textbookId) return
    let alive = true
    whenVoice()
      .then((data) => alive && setVoice({ book: textbookId, data, error: null }))
      .catch((e) => alive && setVoice({ book: textbookId, data: null, error: errorMessage(e) }))
    return () => { alive = false }
  }, [textbookId, whenVoice])

  // Switching textbook or leaving the classroom silences the tutor, cancels its requests and frees its audio.
  useEffect(() => {
    const runs = run
    return () => {
      runs.current++
      readerAudio().pause()
      pages.clear()
      clips.clear()
    }
  }, [textbookId, pages, clips])

  /** `ahead`: fetched before the reader gets there (the server keeps their pipeline where it is). */
  const loadPage = useCallback((p: number, ahead = false) => {
    const m = opts.current.mode
    return pages.get(pageKey(m, p), (signal) => readAloudService.page(textbookId, p, m, { signal, prefetch: ahead }))
  }, [textbookId, pages])

  const clip = useCallback((p: number, i: number, version?: string | null) => {
    const m = opts.current.mode
    return clips.get(`${pageKey(m, p)}:${i}:${version ?? ''}`, (signal) =>
      readAloudService.audio(textbookId, p, i, m, { signal, version }).then((b) => URL.createObjectURL(b)))
  }, [textbookId, clips])

  /** Script and first part of `page` (shared with playback, so nothing is fetched twice). */
  const preload = useCallback(async (p: number, ahead = false) => {
    const data = await loadPage(p, ahead)
    if (data.segments.length) await clip(p, 0, data.version)
    return data
  }, [loadPage, clip])

  const playAt = useCallback(async function play(startPage: number, startIndex: number, refreshed = false): Promise<void> {
    const token = ++run.current
    const audio = readerAudio()
    audio.pause()
    let p = startPage
    let i = startIndex
    pos.current = { page: p, index: i }
    setState((s) => ({ ...s, book: textbookId, status: 'loading', page: p, index: i, error: null,
                       ...(s.page !== p ? { segment: null, lesson: null } : {}) }))
    try {
      let data = await loadPage(p)
      if (token !== run.current) return
      setState((s) => ({ ...s, lesson: data.lesson }))
      while (i >= data.segments.length) {            // page finished (or has nothing to say)
        if (!opts.current.autoTurn || p >= data.total_pages) {
          if (token === run.current) setState((s) => ({ ...s, status: 'done', total: data.segments.length, segment: null }))
          return
        }
        p += 1
        i = 0
        pos.current = { page: p, index: 0 }
        opts.current.onTurnPage(p)
        setState((s) => ({ ...s, page: p, index: 0, segment: null, lesson: null }))
        data = await loadPage(p)
        if (token !== run.current) return
        setState((s) => ({ ...s, lesson: data.lesson }))
      }
      const url = await clip(p, i, data.version)
      if (token !== run.current) return
      audio.src = url
      audio.playbackRate = opts.current.rate
      readerLipsync().connectAudio(audio)
      await audio.play()
      if (token !== run.current) return
      // Caption, highlighted words and the teacher's-notes marker change only once this part is audible.
      setState((s) => ({ ...s, status: 'playing', page: p, index: i, total: data.segments.length, segment: data.segments[i] }))
      // Prefetch the next part so there is no gap between parts.
      if (i + 1 < data.segments.length) void clip(p, i + 1, data.version).catch(() => {})
      else if (opts.current.autoTurn && p < data.total_pages) void preload(p + 1, true).catch(() => {})
    } catch (e) {
      if (token !== run.current) return
      if ((e as { status?: number }).status === 409 && !refreshed) {
        pages.delete(pageKey(opts.current.mode, p))   // the lesson was replaced meanwhile: continue with the new one
        return play(p, i, true)
      }
      setState((s) => ({ ...s, status: 'error', error: errorMessage(e, 'This page could not be read aloud.') }))
    }
  }, [textbookId, loadPage, clip, preload, pages])

  useEffect(() => {
    const audio = readerAudio()
    const ended = () => { void playAt(pos.current.page, pos.current.index + 1) }
    audio.addEventListener('ended', ended)
    return () => audio.removeEventListener('ended', ended)
  }, [playAt])

  // Prepare the open page and the next one, whether or not the tutor is speaking.
  useEffect(() => {
    if (!textbookId || !viewPage) return
    const ctl = new AbortController()
    const m = mode
    const mark = (patch: Partial<Pick<PageReady, 'status' | 'next'>>, from?: 'server') => {
      if (ctl.signal.aborted) return
      setReady((r) => {
        const base: PageReady = r && r.book === textbookId && r.mode === m && r.page === viewPage ? r
          : { book: textbookId, mode: m, page: viewPage, status: 'queued', next: null }
        if (from === 'server') {                     // the server's view never overrides what this device knows
          return { ...base, status: base.status === 'ready' || base.status === 'failed' ? base.status : patch.status ?? base.status,
                   next: base.next && (base.next.status === 'ready' || base.next.status === 'failed') ? base.next : patch.next ?? base.next }
        }
        return { ...base, ...patch }
      })
    }
    const timer = window.setTimeout(async () => {
      // Requests for pages the reader left are cancelled (the page being spoken is kept).
      const keep = new Set([viewPage, viewPage + 1, pos.current.page, pos.current.page + 1])
      const keepKey = (k: string) => k.startsWith(`${m}:`) && keep.has(keyPage(k))
      pages.retain(keepKey)
      clips.retain(keepKey)
      mark({ status: 'preparing' })
      readAloudService.prepare(textbookId, viewPage, m, { signal: ctl.signal })
        .then((st) => {
          const [cur, nxt] = st.pages
          const show = (s: Readiness): Readiness => (s === 'idle' ? 'queued' : s)
          mark({ status: cur ? show(cur.status) : undefined, next: nxt ? { page: nxt.page, status: show(nxt.status) } : null }, 'server')
        })
        .catch(() => {})
      try {
        const data = await preload(viewPage)
        mark({ status: 'ready' })
        if (ctl.signal.aborted || viewPage >= data.total_pages) return
        mark({ next: { page: viewPage + 1, status: 'preparing' } })
        try {
          await preload(viewPage + 1, true)
          mark({ next: { page: viewPage + 1, status: 'ready' } })
        } catch {
          mark({ next: { page: viewPage + 1, status: 'failed' } })
        }
      } catch {
        mark({ status: 'failed' })
      }
    }, PREFETCH_DELAY_MS)
    return () => { window.clearTimeout(timer); ctl.abort() }
  }, [textbookId, viewPage, mode, pages, clips, preload])

  /** Called from the click handler: the click is the user gesture that lets the browser start audio. */
  const start = useCallback((page: number) => { readerLipsync(); void playAt(page, 0) }, [playAt])
  const pause = useCallback(() => {
    readerAudio().pause()
    setState((s) => (s.status === 'playing' ? { ...s, status: 'paused' } : s))
  }, [])
  const resume = useCallback(() => {
    readerLipsync()
    readerAudio().play()
      .then(() => setState((s) => ({ ...s, status: 'playing' })))
      .catch((e) => setState((s) => ({ ...s, status: 'error', error: errorMessage(e) })))
  }, [])
  const stop = useCallback(() => {
    run.current++
    readerAudio().pause()
    pos.current = { page: 0, index: 0 }
    setState(idle(textbookId))
  }, [textbookId])
  const skip = useCallback((delta: number) => { void playAt(pos.current.page, Math.max(0, pos.current.index + delta)) }, [playAt])

  /** The student opened another page: keep teaching there if the tutor was speaking, otherwise just reset. */
  const followPage = useCallback((page: number) => {
    if (page === pos.current.page || status.current === 'idle') return
    if (status.current === 'playing' || status.current === 'loading') void playAt(page, 0)
    else stop()
  }, [playAt, stop])

  const setRate = useCallback((r: number) => {
    opts.current.rate = r
    readerAudio().playbackRate = r
    setRateState(r)
  }, [])
  const setAutoTurn = useCallback((on: boolean) => {
    opts.current.autoTurn = on
    setAutoTurnState(on)
  }, [])
  const setMode = useCallback((m: ReadMode) => {
    opts.current.mode = m
    setModeState(m)
    stop()
  }, [stop])

  const s = state.book === textbookId ? state : idle(textbookId)
  const v = voice?.book === textbookId ? voice : null
  return {
    ...s,
    text: s.segment?.text ?? null,
    reading: s.status === 'playing' || s.status === 'paused' || s.status === 'loading',
    voice: v?.data ?? null,
    voiceError: v?.error ?? null,
    voiceLoading: !v,
    ready: ready && ready.book === textbookId && ready.mode === mode && ready.page === viewPage ? ready : null,
    rate, autoTurn, mode, start, pause, resume, stop, skip, followPage, setRate, setAutoTurn, setMode,
    loadScript: loadPage, preload, whenVoice,
  }
}

export type ReadAloud = ReturnType<typeof useReadAloud>
