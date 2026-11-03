import { useEffect, useState } from 'react'
import { ProctorMedia } from './media'

/**
 * A ProctorMedia owned by the calling component: every camera / microphone / screen stream, the audio analyser and the
 * detection worker are switched off when it unmounts. React's StrictMode (development only) unmounts and remounts a
 * new component once; a stopped ProctorMedia never reopens a device, so the remount gets a fresh one.
 */
export function useProctorMedia(): ProctorMedia {
  const [media, setMedia] = useState(() => new ProctorMedia())
  useEffect(() => {
    if (media.closed) {
      queueMicrotask(() => setMedia(new ProctorMedia()))
      return
    }
    return () => media.stop()
  }, [media])
  return media
}
