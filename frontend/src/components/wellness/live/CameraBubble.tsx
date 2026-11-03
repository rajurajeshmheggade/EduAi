import { lazy, Suspense, type RefObject } from 'react'
import { cn } from '@/lib/utils'

// three.js stays in its own chunk: the bubble renders immediately and the particles stream in
const Visualizer = lazy(() => import('../three/DimensionalAnalysisVisualizer'))

/** Round webcam preview (mirrored, local only). Without a camera it shows the 3D particle matrix instead. */
export function CameraBubble({ videoRef, cameraActive, listening, speaking, busy }: {
  videoRef: RefObject<HTMLVideoElement | null>
  cameraActive: boolean
  listening: boolean
  speaking: boolean
  /** Listening, answering or speaking: the particles pulse. */
  busy: boolean
}) {
  return (
    <div
      className={cn(
        'relative grid h-[200px] w-[200px] shrink-0 place-items-center overflow-hidden rounded-full border-[3px] bg-gradient-to-br from-ink-800 to-purple-500/[0.07] transition-all duration-300',
        listening
          ? 'border-rose-400 shadow-[0_0_30px_hsl(340_75%_52%/0.35)]'
          : speaking
            ? 'border-purple-500 shadow-[0_0_30px_hsl(271_91%_65%/0.35)]'
            : 'border-purple-500/20 shadow-[0_8px_32px_-10px_hsl(222_40%_20%/0.3)]',
      )}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={cn('h-full w-full -scale-x-100 object-cover', !cameraActive && 'hidden')}
        aria-label="Student live webcam view"
      />
      {!cameraActive && (
        <div className="absolute inset-0 animate-pulse [animation-duration:2.4s]" aria-hidden="true">
          <Suspense fallback={<div className="h-full w-full rounded-full bg-purple-500/10" />}>
            <Visualizer isAnalyzing={busy} compact bare />
          </Suspense>
        </div>
      )}
    </div>
  )
}
