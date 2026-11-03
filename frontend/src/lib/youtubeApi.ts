/**
 * YouTube's IFrame Player API, loaded once on demand. YouTube-licensed items may only be shown through YouTube's own
 * embedded player; the API lets the page see that player's state (playing / paused / ended, current time) so Virtual
 * Labs can tell whether a video was really watched. The app sets no Content-Security-Policy on these pages, so the
 * script from www.youtube.com is allowed (ExamView's strict CSP does not apply here).
 */

export interface YTPlayer {
  getCurrentTime(): number
  getDuration(): number
  getPlaybackRate(): number
  setPlaybackRate(rate: number): void
  destroy(): void
}

export interface YTNamespace {
  Player: new (el: HTMLElement, opts: {
    videoId: string
    host?: string
    width?: string | number
    height?: string | number
    playerVars?: Record<string, string | number>
    events?: {
      onReady?: (e: { target: YTPlayer }) => void
      onStateChange?: (e: { data: number; target: YTPlayer }) => void
      onPlaybackRateChange?: (e: { data: number; target: YTPlayer }) => void
      onError?: (e: { data: number }) => void
    }
  }) => YTPlayer
}

/** YT.PlayerState values. */
export const YT_STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const

declare global {
  interface Window { YT?: YTNamespace & { loaded?: number }; onYouTubeIframeAPIReady?: () => void }
}

let loading: Promise<YTNamespace> | null = null

export function loadYouTubeApi(timeoutMs = 15_000): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (loading) return loading
  loading = new Promise<YTNamespace>((resolve, reject) => {
    const fail = (why: string) => { loading = null; reject(new Error(why)) }
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => { previous?.(); if (window.YT?.Player) resolve(window.YT); else fail('YouTube player unavailable') }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    script.onerror = () => { script.remove(); fail('The YouTube player could not be loaded') }
    document.head.appendChild(script)
    window.setTimeout(() => { if (!window.YT?.Player) fail('The YouTube player took too long to load') }, timeoutMs)
  })
  return loading
}
