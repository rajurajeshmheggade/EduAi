import { useCallback, useEffect, useRef, useState } from 'react'
import { readerAudio, readerLipsync } from '@/lib/readerAudio'
import { errorMessage } from '@/services/apiClient'
import { readAloudService, type PageLesson, type ReadAloudPage, type ReadAloudSegment, type ReadAloudVoice, type ReadMode } from '@/services/readAloudService'

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

const idle = (book: string): ReaderState => ({ book, status: 'idle', page: 1, index: 0, total: 0, segment: null, lesson: null, error: null })
const CLIPS_KEPT = 4     // object URLs of synthesised audio kept in memory (current + prefetched)

/**
 * The AI avatar tutor explains (or reads) the open textbook page aloud, part by part: the script and audio come from
 * the read-aloud API (voice = the subject teacher's), the next part is prefetched, and the tutor turns the page when
 * one is finished.
 */
export function useReadAloud(textbookId: string, onTurnPage: (page: number) => void) {
  const [state, setState] = useState<ReaderState>(() => idle(textbookId))
  const [voice, setVoice] = useState<{ book: string; data: ReadAloudVoice | null; error: string | null } | null>(null)
  const [rate, setRateState] = useState(1)
  const [autoTurn, setAutoTurnState] = useState(true)
  const [mode, setModeState] = useState<ReadMode>('explain')

  const run = useRef(0)                  // bumped by every start / stop: stale async steps bail out
  const pos = useRef({ page: 0, index: 0 })
  const status = useRef<ReadStatus>('idle')
  const opts = useRef({ rate: 1, autoTurn: true, mode: 'explain' as ReadMode, onTurnPage })
  const pages = useRef(new Map<string, Promise<ReadAloudPage>>())
  const clips = useRef(new Map<string, Promise<string>>())

  useEffect(() => { opts.current.onTurnPage = onTurnPage }, [onTurnPage])
  useEffect(() => { status.current = state.book === textbookId ? state.status : 'idle' }, [state, textbookId])

  useEffect(() => {
    if (!textbookId) return
    let alive = true
    readAloudService.voice(textbookId)
      .then((data) => alive && setVoice({ book: textbookId, data, error: null }))
      .catch((e) => alive && setVoice({ book: textbookId, data: null, error: errorMessage(e) }))
    return () => { alive = false }
  }, [textbookId])

  // Switching textbook or leaving the classroom silences the tutor and frees its audio.
  useEffect(() => {
    const kept = clips.current
    const runs = run
    return () => {
      runs.current++
      readerAudio().pause()
      for (const c of kept.values()) void c.then((u) => URL.revokeObjectURL(u), () => {})
      kept.clear()
    }
  }, [textbookId])

  const loadPage = useCallback((p: number) => {
    const m = opts.current.mode
    const key = `${textbookId}:${m}:${p}`
    let hit = pages.current.get(key)
    if (!hit) {
      hit = readAloudService.page(textbookId, p, m)
      pages.current.set(key, hit)
      hit.catch(() => pages.current.delete(key))
    }
    return hit
  }, [textbookId])

  const clip = useCallback((p: number, i: number) => {
    const m = opts.current.mode
    const key = `${textbookId}:${m}:${p}:${i}`
    let hit = clips.current.get(key)
    if (!hit) {
      hit = readAloudService.audio(textbookId, p, i, m).then((b) => URL.createObjectURL(b))
      clips.current.set(key, hit)
      hit.catch(() => clips.current.delete(key))
      while (clips.current.size > CLIPS_KEPT) {
        const [oldKey, old] = clips.current.entries().next().value!
        clips.current.delete(oldKey)
        void old.then((u) => { if (readerAudio().src !== u) URL.revokeObjectURL(u) }, () => {})
      }
    }
    return hit
  }, [textbookId])

  const playAt = useCallback(async (startPage: number, startIndex: number) => {
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
      setState((s) => ({ ...s, page: p, index: i, total: data.segments.length, segment: data.segments[i] }))
      const url = await clip(p, i)
      if (token !== run.current) return
      audio.src = url
      audio.playbackRate = opts.current.rate
      readerLipsync().connectAudio(audio)
      await audio.play()
      if (token !== run.current) return
      setState((s) => ({ ...s, status: 'playing' }))
      // Prefetch the next part so there is no gap between parts.
      if (i + 1 < data.segments.length) void clip(p, i + 1).catch(() => {})
      else if (opts.current.autoTurn && p < data.total_pages) {
        void loadPage(p + 1).then((d) => (d.segments.length ? clip(p + 1, 0) : null)).catch(() => {})
      }
    } catch (e) {
      if (token === run.current) setState((s) => ({ ...s, status: 'error', error: errorMessage(e, 'This page could not be read aloud.') }))
    }
  }, [textbookId, loadPage, clip])

  useEffect(() => {
    const audio = readerAudio()
    const ended = () => { void playAt(pos.current.page, pos.current.index + 1) }
    audio.addEventListener('ended', ended)
    return () => audio.removeEventListener('ended', ended)
  }, [playAt])

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
    rate, autoTurn, mode, start, pause, resume, stop, skip, followPage, setRate, setAutoTurn, setMode,
  }
}

export type ReadAloud = ReturnType<typeof useReadAloud>
