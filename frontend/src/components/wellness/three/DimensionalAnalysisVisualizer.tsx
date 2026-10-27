import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { BrainCircuit } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { JournalAnalysis } from '@/types/wellness'
import { createRenderer, createSpriteTexture, sizeRenderer, startRenderLoop, type RenderLoop } from './renderLoop'

export interface DimensionalAnalysisVisualizerProps {
  isAnalyzing: boolean
  analysisResult?: JournalAnalysis | null
  compact?: boolean
  /** Canvas only, filling its parent (no card, header or telemetry) — used inside Aura Live's camera bubble. */
  bare?: boolean
}

const TELEMETRY_MESSAGES = [
  'Vectorizing cognitive reflection...',
  'Deconstructing emotional frequency...',
  'Cross-referencing academic pressure indicators...',
  'Calculating neural sentiment matrix...',
  'Synthesizing personalized coping algorithms...',
]

/** Mood palette tuned for a near-white page: EduAI indigo/aqua when calm, amber/violet mid, rose/pink when low. */
function moodPalette(moodScore: number) {
  if (moodScore >= 70) return { a: '#3e4ae9', b: '#9333ea', core: '#18a0aa' }
  if (moodScore >= 45) return { a: '#d97706', b: '#7c3aed', core: '#7c3aed' }
  return { a: '#e02966', b: '#db2777', core: '#7c3aed' }
}

/**
 * 3D particle visualizer for AI analysis states (MindAlign). A torus-knot particle matrix that breathes calmly,
 * pulses rapidly while an analysis runs, and is tinted by the latest mood score. Drag the pointer to tilt it.
 */
export function DimensionalAnalysisVisualizer({ isAnalyzing, analysisResult = null, compact = false, bare = false }: DimensionalAnalysisVisualizerProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const analyzingRef = useRef(isAnalyzing)
  const loopRef = useRef<RenderLoop | null>(null)
  const [telemetryStep, setTelemetryStep] = useState(0)
  const moodScore = analysisResult?.mood_score ?? 60
  const canvasHeight = compact ? 180 : 260

  // The scene reads the analyzing flag live, so toggling it never rebuilds WebGL
  useEffect(() => {
    analyzingRef.current = isAnalyzing
    loopRef.current?.renderOnce()
  }, [isAnalyzing])

  // Rotate telemetry text while analyzing
  useEffect(() => {
    if (!isAnalyzing || bare) return
    const id = window.setInterval(() => setTelemetryStep((s) => (s + 1) % TELEMETRY_MESSAGES.length), 1100)
    return () => window.clearInterval(id)
  }, [isAnalyzing, bare])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const renderer = createRenderer()
    if (!renderer) return
    const measure = () => ({ w: mount.clientWidth || 400, h: bare ? mount.clientHeight || canvasHeight : canvasHeight })

    // 1. Scene & camera
    const scene = new THREE.Scene()
    const { w, h } = measure()
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 1000)
    camera.position.z = 240
    sizeRenderer(renderer, camera, w, h)
    mount.appendChild(renderer.domElement)

    // 2. Torus-knot particle cloud
    const texture = createSpriteTexture(32)
    const PARTICLE_COUNT = compact ? 450 : 800
    const positions = new Float32Array(PARTICLE_COUNT * 3)
    const colors = new Float32Array(PARTICLE_COUNT * 3)
    const origins = new Float32Array(PARTICLE_COUNT * 3)
    const frequencies = new Float32Array(PARTICLE_COUNT)
    const palette = moodPalette(moodScore)
    const colorA = new THREE.Color(palette.a)
    const colorB = new THREE.Color(palette.b)
    const mixed = new THREE.Color()
    const p = 2
    const q = 3
    const R = compact ? 55 : 75
    const r = compact ? 22 : 32

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3
      const u = (i / PARTICLE_COUNT) * Math.PI * 2 * p
      // Torus knot formula with radial fuzz
      const quOverP = (q / p) * u
      const rMod = R + r * Math.cos(quOverP) + (Math.random() - 0.5) * 12
      const x = rMod * Math.cos(u)
      const y = rMod * Math.sin(u)
      const z = -r * Math.sin(quOverP) + (Math.random() - 0.5) * 12
      positions[i3] = origins[i3] = x
      positions[i3 + 1] = origins[i3 + 1] = y
      positions[i3 + 2] = origins[i3 + 2] = z
      frequencies[i] = 1.0 + Math.random() * 2.5
      mixed.lerpColors(colorA, colorB, (Math.sin(u * 2) + 1) * 0.5)
      colors[i3] = mixed.r
      colors[i3 + 1] = mixed.g
      colors[i3 + 2] = mixed.b
    }

    const geometry = new THREE.BufferGeometry()
    const positionAttr = new THREE.BufferAttribute(positions, 3)
    geometry.setAttribute('position', positionAttr)
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const material = new THREE.PointsMaterial({
      size: compact ? 12 : 16,
      map: texture,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    })
    const particles = new THREE.Points(geometry, material)
    scene.add(particles)

    // 3. Inner wireframe core
    const coreGeo = new THREE.SphereGeometry(compact ? 14 : 22, 16, 16)
    const coreMat = new THREE.MeshBasicMaterial({ color: palette.core, wireframe: true, transparent: true, opacity: 0.45 })
    const core = new THREE.Mesh(coreGeo, coreMat)
    scene.add(core)

    // 4. Pointer tilt
    let targetRotX = 0
    let targetRotY = 0
    const onPointerMove = (e: PointerEvent) => {
      const rect = mount.getBoundingClientRect()
      targetRotY = (((e.clientX - rect.left) / rect.width) * 2 - 1) * 0.8
      targetRotX = -(((e.clientY - rect.top) / rect.height) * 2 - 1) * 0.8
    }
    mount.addEventListener('pointermove', onPointerMove, { passive: true })

    const loop = startRenderLoop(mount, (elapsed) => {
      const analyzing = analyzingRef.current
      particles.rotation.y += (targetRotY + 0.35 * elapsed - particles.rotation.y) * 0.05
      particles.rotation.x += (targetRotX + Math.sin(elapsed * 0.5) * 0.2 - particles.rotation.x) * 0.05
      core.rotation.y -= 0.02
      core.rotation.z += 0.015

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i3 = i * 3
        const ox = origins[i3]
        const oy = origins[i3 + 1]
        const oz = origins[i3 + 2]
        const freq = frequencies[i]
        if (analyzing) {
          // Rapid quantum pulse during analysis
          const pulse = Math.sin(elapsed * 6 * freq) * 16
          positions[i3] = ox + (ox / R) * pulse
          positions[i3 + 1] = oy + (oy / R) * pulse
          positions[i3 + 2] = oz + (oz / r) * pulse
        } else {
          // Harmonious breathing undulation
          const breathe = Math.sin(elapsed * 1.5 + freq) * 4
          positions[i3] = ox + breathe
          positions[i3 + 1] = oy + breathe
          positions[i3 + 2] = oz + breathe
        }
      }
      positionAttr.needsUpdate = true
      const coreScale = 1.0 + Math.sin(elapsed * (analyzing ? 8 : 2)) * 0.12
      core.scale.set(coreScale, coreScale, coreScale)
      renderer.render(scene, camera)
    })
    loopRef.current = loop

    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      const next = measure()
      sizeRenderer(renderer, camera, next.w, next.h)
      loop.renderOnce()
    })
    resizeObserver?.observe(mount)

    return () => {
      loop.dispose()
      loopRef.current = null
      resizeObserver?.disconnect()
      mount.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.remove()
      geometry.dispose()
      material.dispose()
      coreGeo.dispose()
      coreMat.dispose()
      texture?.dispose()
      renderer.dispose()
    }
  }, [compact, bare, moodScore, canvasHeight])

  if (bare) return <div ref={mountRef} className="h-full w-full" aria-hidden="true" />

  return (
    <div
      role="group"
      aria-label="3D Dimensional Analysis Engine"
      className={cn(
        'relative overflow-hidden rounded-2xl border bg-gradient-to-br from-ink-900 via-ink-900 to-purple-500/[0.06] transition-all duration-400',
        compact ? 'p-3' : 'p-5',
        isAnalyzing
          ? 'border-rose-400/60 shadow-[0_0_30px_hsl(340_75%_52%/0.18),inset_0_0_20px_hsl(262_83%_58%/0.08)]'
          : 'border-purple-500/25 shadow-[0_8px_32px_-12px_hsl(222_40%_20%/0.25)]',
      )}
    >
      {/* Header bar */}
      <div className="relative z-[2] mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BrainCircuit className={cn('h-[18px] w-[18px]', isAnalyzing ? 'animate-spin text-rose-400' : 'text-purple-500')} aria-hidden />
          <span className="font-display text-[0.85rem] font-bold tracking-[0.02em] text-fg">
            {isAnalyzing ? 'Dimensional Particle Analyzer' : 'Quantum Emotion Matrix (3D)'}
          </span>
        </div>
        <span
          className={cn(
            'rounded-full border px-2.5 py-0.5 text-[0.68rem] font-medium',
            isAnalyzing ? 'border-rose-400/50 bg-rose-400/10 text-rose-400' : 'border-purple-500/40 bg-purple-500/10 text-purple-600',
          )}
        >
          {isAnalyzing ? 'Processing 3D Vectors...' : analysisResult ? `Aura Score: ${analysisResult.mood_score}/100` : 'Interactive 3D'}
        </span>
      </div>

      {/* 3D WebGL canvas viewport */}
      <div ref={mountRef} className="relative w-full" style={{ height: canvasHeight }} aria-hidden="true" />

      {/* Live telemetry overlay during AI analysis */}
      {isAnalyzing && (
        <div className="absolute inset-x-4 bottom-4 z-[3] flex items-center justify-between gap-2 rounded-lg border border-rose-400/30 bg-ink-900/90 px-3.5 py-2.5 backdrop-blur-md animate-fade-up">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-rose-400 shadow-[0_0_6px_var(--color-rose-400)]" />
            <span className="truncate font-mono text-[0.78rem] text-fg">{TELEMETRY_MESSAGES[telemetryStep]}</span>
          </div>
          <span className="shrink-0 text-[0.72rem] font-semibold text-rose-400">AI Sentiment Analysis</span>
        </div>
      )}
    </div>
  )
}

export default DimensionalAnalysisVisualizer
