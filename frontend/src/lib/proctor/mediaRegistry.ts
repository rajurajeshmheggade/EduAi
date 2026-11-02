/**
 * Ownership of the capture streams (camera, microphone, entire screen) the proctoring code opens. Every stream is
 * opened through a registry, and `closeAll()` stops every track of every stream it handed out — including one whose
 * permission prompt is answered only after the session ended (stopped the moment it arrives) — so ending a proctored
 * session always switches the camera light off. Each track is stopped exactly once. A closed registry opens nothing.
 */
export class MediaClosedError extends Error {
  constructor() {
    super('Proctoring has ended: the camera, microphone and screen sharing are switched off.')
    this.name = 'MediaClosedError'
  }
}

/** The device request failed only because proctoring ended meanwhile (nothing to show the student). */
export const isMediaClosed = (e: unknown) => e instanceof MediaClosedError

export class MediaRegistry {
  private streams = new Set<MediaStream>()
  private closed = false

  get isClosed() { return this.closed }
  /** Streams handed out and still running. */
  get size() { return this.streams.size }

  /** Opens a stream and keeps track of it. When the registry was closed while `open` ran, the stream is stopped at once. */
  async acquire(open: () => Promise<MediaStream>): Promise<MediaStream> {
    if (this.closed) throw new MediaClosedError()
    const stream = await open()
    if (this.closed) {
      stopTracks(stream)
      throw new MediaClosedError()
    }
    this.streams.add(stream)
    return stream
  }

  /** Stops one stream (a camera being replaced, a screen share that was refused). */
  release(stream: MediaStream | null | undefined) {
    if (stream && this.streams.delete(stream)) stopTracks(stream)
  }

  /** Stops every stream handed out, for good. Safe to call more than once. */
  closeAll() {
    this.closed = true
    const all = [...this.streams]
    this.streams.clear()
    all.forEach(stopTracks)
  }
}

function stopTracks(stream: MediaStream) {
  for (const t of stream.getTracks()) t.stop()
}
