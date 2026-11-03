/* Shared three.js plumbing for the Wellness visuals: a transparent renderer with a capped pixel ratio, a soft
   sprite texture, and a render loop that sleeps while the page is hidden or the canvas is off-screen and renders
   a single static frame when the student prefers reduced motion. */
import * as THREE from 'three'

export const MAX_PIXEL_RATIO = 1.5
/** Upper bound on drawn pixels (CSS area x ratio^2), so a page-sized background stays cheap on big screens. */
const PIXEL_BUDGET = 4_000_000

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Transparent WebGL renderer, or null when WebGL is unavailable (the visual is then simply omitted). */
export function createRenderer(): THREE.WebGLRenderer | null {
  try {
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' })
    renderer.setClearColor(0x000000, 0)
    const canvas = renderer.domElement
    canvas.setAttribute('aria-hidden', 'true')
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    return renderer
  } catch (err) {
    console.warn('WebGL is unavailable, skipping the 3D visual:', err)
    return null
  }
}

/** Size the drawing buffer for a CSS box (the canvas itself is styled to fill its parent). */
export function sizeRenderer(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, width: number, height: number) {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO, Math.sqrt(PIXEL_BUDGET / (w * h)))
  renderer.setPixelRatio(Math.max(0.5, ratio))
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}

/** Soft round sprite: white with an alpha falloff, so per-vertex colours tint it (reads on a light page). */
export function createSpriteTexture(size = 64): THREE.CanvasTexture | null {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const c = size / 2
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c)
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
  gradient.addColorStop(0.35, 'rgba(255, 255, 255, 0.85)')
  gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.3)')
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export interface RenderLoop {
  /** Draw one frame now when the loop is asleep (after a resize, or a prop change under reduced motion). */
  renderOnce(): void
  dispose(): void
}

/**
 * Runs `frame(elapsedSeconds, deltaSeconds)` on requestAnimationFrame only while the document is visible and
 * `target` intersects the viewport. Elapsed time pauses while asleep, so motion resumes where it stopped.
 * With prefers-reduced-motion one static frame is drawn instead of animating.
 */
export function startRenderLoop(target: Element, frame: (elapsed: number, delta: number) => void): RenderLoop {
  const reduced = prefersReducedMotion()
  let raf = 0
  let last = 0
  let elapsed = 0
  let visible = !document.hidden
  let onScreen = true
  let disposed = false

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick)
    const delta = last ? Math.min((now - last) / 1000, 0.1) : 0
    last = now
    elapsed += delta
    frame(elapsed, delta)
  }
  const update = () => {
    const run = !disposed && !reduced && visible && onScreen
    if (run && !raf) {
      last = 0
      raf = requestAnimationFrame(tick)
    } else if (!run && raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
  }
  const onVisibility = () => {
    visible = !document.hidden
    update()
  }
  document.addEventListener('visibilitychange', onVisibility)
  const observer = typeof IntersectionObserver === 'undefined'
    ? null
    : new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1]
      if (entry) onScreen = entry.isIntersecting
      update()
    })
  observer?.observe(target)

  frame(0, 0) // first (or, with reduced motion, the only) frame
  update()

  return {
    renderOnce: () => { if (!raf && !disposed) frame(elapsed, 0) },
    dispose: () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      document.removeEventListener('visibilitychange', onVisibility)
      observer?.disconnect()
    },
  }
}
