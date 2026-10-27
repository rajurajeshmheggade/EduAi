import { useCallback, useRef, useState } from 'react'

/** Local webcam preview for Aura Live. Video never leaves the page — it is only shown in the bubble. */
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [active, setActive] = useState(false)

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setActive(false)
  }, [])

  /** Must follow a user gesture. `stillWanted` is checked after the permission prompt, so a session closed
      meanwhile never leaves the camera running. Resolves whether the preview is on. */
  const start = useCallback(async (stillWanted: () => boolean): Promise<boolean> => {
    if (!navigator.mediaDevices?.getUserMedia) return false
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 320, facingMode: 'user' }, audio: false })
      if (!stillWanted()) {
        stream.getTracks().forEach((t) => t.stop())
        return false
      }
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
      // Camera unplugged or permission revoked mid-session: fall back to the visualizer
      stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (streamRef.current === stream) stop() })
      setActive(true)
      return true
    } catch (err) {
      console.error('Failed to open camera', err)
      setActive(false)
      return false
    }
  }, [stop])

  return { videoRef, active, start, stop }
}
