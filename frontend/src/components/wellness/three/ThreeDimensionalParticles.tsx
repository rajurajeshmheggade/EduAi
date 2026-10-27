import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { createRenderer, createSpriteTexture, sizeRenderer, startRenderLoop } from './renderLoop'

export interface ThreeDimensionalParticlesProps {
  isAnalyzing: boolean
  stressLevel: number
  /** 'quantum' (average stress above 70) makes the network drift a little faster. */
  activeMode: 'nebula' | 'quantum'
}

const PARTICLE_COUNT = 1500
const MAX_LINE_SEGMENTS = 450
const LINKED_NODES = 160 // only the first nodes are tested for synaptic filaments (O(n²))
const LINK_DIST_SQ = 18000

/**
 * 3D neural-synapse particle network behind the Wellness page (MindAlign). Fills its positioned parent with a
 * transparent canvas; nodes drift, nearby nodes connect with fading filaments, the camera follows the cursor
 * and a click sends a shockwave through the field. Colours are EduAI indigo / aqua / rose tones for a light page.
 */
export function ThreeDimensionalParticles({ isAnalyzing, stressLevel, activeMode }: ThreeDimensionalParticlesProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const liveRef = useRef({ isAnalyzing, stressLevel, activeMode })
  const renderOnceRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    liveRef.current = { isAnalyzing, stressLevel, activeMode }
    renderOnceRef.current?.()
  }, [isAnalyzing, stressLevel, activeMode])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const renderer = createRenderer()
    if (!renderer) return

    // 1. Scene, perspective camera and renderer sized to the parent
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(60, 1, 1, 3000)
    camera.position.z = 850
    sizeRenderer(renderer, camera, container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight)
    renderer.domElement.style.position = 'absolute'
    renderer.domElement.style.inset = '0'
    renderer.domElement.style.pointerEvents = 'none'
    container.appendChild(renderer.domElement)

    // 2. Neural particle distribution (indigo, aqua, rose, violet and a little amber)
    const positions = new Float32Array(PARTICLE_COUNT * 3)
    const origins = new Float32Array(PARTICLE_COUNT * 3)
    const colors = new Float32Array(PARTICLE_COUNT * 3)
    const phases = new Float32Array(PARTICLE_COUNT)
    const indigo = new THREE.Color('#3e4ae9')
    const aqua = new THREE.Color('#18a0aa')
    const rose = new THREE.Color('#e02966')
    const violet = new THREE.Color('#7c3aed')
    const amber = new THREE.Color('#d97706')
    const tint = new THREE.Color()

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3
      // 3D neural web distribution across depth
      const radius = 180 + Math.pow(Math.random(), 1.4) * 900
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2.0 * Math.random() - 1.0)
      positions[i3] = origins[i3] = radius * Math.sin(phi) * Math.cos(theta)
      positions[i3 + 1] = origins[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta) * 0.75
      positions[i3 + 2] = origins[i3 + 2] = radius * Math.cos(phi)
      phases[i] = Math.random() * Math.PI * 2

      const pick = Math.random()
      if (pick < 0.35) tint.lerpColors(aqua, indigo, Math.random())
      else if (pick < 0.7) tint.lerpColors(rose, violet, Math.random())
      else if (pick < 0.88) tint.lerpColors(violet, aqua, Math.random())
      else tint.lerpColors(amber, rose, Math.random())
      colors[i3] = tint.r
      colors[i3 + 1] = tint.g
      colors[i3 + 2] = tint.b
    }
    const baseColors = colors.slice()

    const geometry = new THREE.BufferGeometry()
    const positionAttr = new THREE.BufferAttribute(positions, 3)
    const colorAttr = new THREE.BufferAttribute(colors, 3)
    geometry.setAttribute('position', positionAttr)
    geometry.setAttribute('color', colorAttr)
    const texture = createSpriteTexture(64)
    const material = new THREE.PointsMaterial({
      size: 20,
      map: texture,
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      sizeAttenuation: true,
    })
    const particles = new THREE.Points(geometry, material)
    scene.add(particles)

    // 3. Synaptic filaments: RGBA vertex colours so they fade by alpha (additive fading would vanish on white)
    const linePositions = new Float32Array(MAX_LINE_SEGMENTS * 2 * 3)
    const lineColors = new Float32Array(MAX_LINE_SEGMENTS * 2 * 4)
    const lineGeometry = new THREE.BufferGeometry()
    const linePosAttr = new THREE.BufferAttribute(linePositions, 3)
    const lineColAttr = new THREE.BufferAttribute(lineColors, 4)
    lineGeometry.setAttribute('position', linePosAttr)
    lineGeometry.setAttribute('color', lineColAttr)
    const lineMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false })
    const lines = new THREE.LineSegments(lineGeometry, lineMaterial)
    scene.add(lines)

    // 4. Cursor parallax + click shockwave
    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 }
    const shockwave = { active: false, radius: 0, center: new THREE.Vector3() }
    const onPointerMove = (e: PointerEvent) => {
      pointer.targetX = ((e.clientX / window.innerWidth) * 2 - 1) * 130
      pointer.targetY = (-(e.clientY / window.innerHeight) * 2 + 1) * 100
    }
    const onClick = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const ray = new THREE.Vector3(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1, 0.5)
      ray.unproject(camera)
      const dir = ray.sub(camera.position).normalize()
      const distance = -camera.position.z / dir.z
      shockwave.center.copy(camera.position).add(dir.multiplyScalar(distance))
      shockwave.radius = 10
      shockwave.active = true
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('click', onClick, { passive: true })

    let wasAnalyzing = false
    const loop = startRenderLoop(container, (elapsed, delta) => {
      const { isAnalyzing: analyzing, activeMode: mode } = liveRef.current
      pointer.x += (pointer.targetX - pointer.x) * 0.04
      pointer.y += (pointer.targetY - pointer.y) * 0.04
      camera.position.x = pointer.x
      camera.position.y = pointer.y
      camera.lookAt(0, 0, 0)

      const activeSpeed = (analyzing ? 2.8 : 1.0) * (mode === 'quantum' ? 1.35 : 1.0)
      particles.rotation.y += 0.0006 * activeSpeed * (delta ? 1 : 0)
      particles.rotation.x = Math.sin(elapsed * 0.2) * 0.04
      lines.rotation.copy(particles.rotation)

      if (shockwave.active) {
        shockwave.radius += 400 * delta
        if (shockwave.radius > 900) shockwave.active = false
      }

      let lineCount = 0
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i3 = i * 3
        const phase = phases[i]
        // 3D neural node drift
        positions[i3] = origins[i3] + Math.sin(elapsed * 0.5 * activeSpeed + phase) * 35
        positions[i3 + 1] = origins[i3 + 1] + Math.cos(elapsed * 0.6 * activeSpeed + phase) * 35
        positions[i3 + 2] = origins[i3 + 2] + Math.sin(elapsed * 0.4 * activeSpeed + phase) * 35

        // Connect nearby nodes with synaptic filaments
        if (i < LINKED_NODES) {
          for (let j = i + 1; j < LINKED_NODES && lineCount < MAX_LINE_SEGMENTS; j++) {
            const j3 = j * 3
            const dx = positions[i3] - positions[j3]
            const dy = positions[i3 + 1] - positions[j3 + 1]
            const dz = positions[i3 + 2] - positions[j3 + 2]
            const distSq = dx * dx + dy * dy + dz * dz
            if (distSq >= LINK_DIST_SQ) continue
            const p6 = lineCount * 6
            const c8 = lineCount * 8
            linePositions[p6] = positions[i3]
            linePositions[p6 + 1] = positions[i3 + 1]
            linePositions[p6 + 2] = positions[i3 + 2]
            linePositions[p6 + 3] = positions[j3]
            linePositions[p6 + 4] = positions[j3 + 1]
            linePositions[p6 + 5] = positions[j3 + 2]
            const alpha = 1.0 - Math.sqrt(distSq) / 134
            lineColors[c8] = indigo.r
            lineColors[c8 + 1] = indigo.g
            lineColors[c8 + 2] = indigo.b
            lineColors[c8 + 3] = alpha
            lineColors[c8 + 4] = rose.r
            lineColors[c8 + 5] = rose.g
            lineColors[c8 + 6] = rose.b
            lineColors[c8 + 7] = alpha
            lineCount++
          }
        }

        // Active analyzing resonance (indigo shimmer)
        if (analyzing) {
          colors[i3] = 0.12 + Math.sin(elapsed * 4 + phase) * 0.08
          colors[i3 + 1] = 0.16
          colors[i3 + 2] = 0.82
        }

        // Shockwave deflection
        if (shockwave.active) {
          const sx = positions[i3] - shockwave.center.x
          const sy = positions[i3 + 1] - shockwave.center.y
          const sz = positions[i3 + 2] - shockwave.center.z
          const dist = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1
          const diff = Math.abs(dist - shockwave.radius)
          if (diff < 80) {
            const push = (1 - diff / 80) * 25
            positions[i3] += (sx / dist) * push
            positions[i3 + 1] += (sy / dist) * push
            positions[i3 + 2] += (sz / dist) * push
          }
        }
      }

      positionAttr.needsUpdate = true
      if (analyzing) colorAttr.needsUpdate = true
      else if (wasAnalyzing) {
        colors.set(baseColors) // restore the palette once the analysis ends
        colorAttr.needsUpdate = true
      }
      wasAnalyzing = analyzing
      lineGeometry.setDrawRange(0, lineCount * 2)
      linePosAttr.needsUpdate = true
      lineColAttr.needsUpdate = true
      renderer.render(scene, camera)
    })
    renderOnceRef.current = loop.renderOnce

    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      sizeRenderer(renderer, camera, container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight)
      loop.renderOnce()
    })
    resizeObserver?.observe(container)

    return () => {
      loop.dispose()
      renderOnceRef.current = null
      resizeObserver?.disconnect()
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('click', onClick)
      renderer.domElement.remove()
      geometry.dispose()
      material.dispose()
      lineGeometry.dispose()
      lineMaterial.dispose()
      texture?.dispose()
      renderer.dispose()
    }
  }, [])

  return <div ref={containerRef} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true" />
}

export default ThreeDimensionalParticles
