import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { activeLipsync, readerAudio } from '@/lib/readerAudio'
import { jawGain, VISEME_SHAPES } from '@/lib/visemes'

const VISEMES = Object.keys(VISEME_SHAPES)
const VOWELS = new Set(['viseme_aa', 'viseme_E', 'viseme_I', 'viseme_O', 'viseme_U'])

/**
 * The teacher's 3D avatar (Ready Player Me GLB), framed head-and-shoulders. Every frame the 15 Oculus viseme morph
 * targets on the head and teeth are blended towards wawa-lipsync's current viseme, scaled by loudness, and the face is
 * kept alive with ARKit shapes (blinks, a light smile, brows) plus small head, eye and breathing motion.
 */
export default function TeacherAvatar3D({ url, speaking, label, gender, className }: {
  url: string
  speaking: boolean
  label: string
  gender: string
  className?: string
}) {
  return (
    <div className={className} role="img" aria-label={label} data-avatar={gender} data-avatar-kind="3d">
      <Canvas dpr={[1, 2]} gl={{ antialias: true, alpha: true }} camera={{ fov: 22, near: 0.05, far: 10, position: [0, 1.53, 1.2] }}>
        <ambientLight intensity={0.55} />
        <hemisphereLight args={['#ffffff', '#c4b5fd', 0.55]} />
        <directionalLight position={[0.8, 2.2, 2.0]} intensity={1.9} />
        <directionalLight position={[-1.6, 1.6, 1.2]} intensity={0.55} color="#bae6fd" />
        <directionalLight position={[0, 2.2, -1.5]} intensity={0.9} color="#fde68a" />
        <Teacher url={url} speaking={speaking} />
      </Canvas>
    </div>
  )
}

type MorphMesh = THREE.Mesh & { morphTargetDictionary: Record<string, number>; morphTargetInfluences: number[] }

function Teacher({ url, speaking }: { url: string; speaking: boolean }) {
  const gltf = useLoader(GLTFLoader, url)
  const camera = useThree((s) => s.camera)
  const speakingRef = useRef(speaking)
  useEffect(() => { speakingRef.current = speaking }, [speaking])

  const rig = useMemo(() => {
    const scene = gltf.scene
    const meshes: MorphMesh[] = []
    scene.traverse((o) => {
      const m = o as MorphMesh
      if (m.isMesh) {
        m.frustumCulled = false
        if (m.morphTargetDictionary && m.morphTargetInfluences) meshes.push(m)
      }
    })
    const bone = (n: string) => scene.getObjectByName(n) ?? null
    return {
      scene, meshes,
      head: bone('Head'), neck: bone('Neck'), spine: bone('Spine2'),
      eyes: [bone('LeftEye'), bone('RightEye')].filter(Boolean) as THREE.Object3D[],
      arms: [[bone('LeftArm'), bone('LeftForeArm'), 1], [bone('RightArm'), bone('RightForeArm'), -1]] as const,
    }
  }, [gltf])

  // Pose and frame once: arms relaxed beside the body (the model ships in an A-pose), camera on head and shoulders.
  const base = useMemo(() => {
    rig.scene.updateMatrixWorld(true)
    for (const [arm, fore, side] of rig.arms) if (arm && fore) hangArm(arm, fore, side)
    rig.scene.updateMatrixWorld(true)
    return {
      head: rig.head?.rotation.clone() ?? new THREE.Euler(),
      neck: rig.neck?.rotation.clone() ?? new THREE.Euler(),
      spine: rig.spine?.rotation.clone() ?? new THREE.Euler(),
      eyes: rig.eyes.map((e) => e.rotation.clone()),
    }
  }, [rig])

  useEffect(() => {
    const p = new THREE.Vector3()
    rig.head?.getWorldPosition(p)
    camera.position.set(p.x, p.y - 0.03, p.z + 1.15)
    camera.lookAt(p.x, p.y - 0.035, p.z)
    camera.updateProjectionMatrix()
  }, [rig, camera])

  const live = useRef({ vol: 0, blink: 0, blinkUntil: 0, nextBlink: 1.5, look: [0, 0], nextLook: 2, still: false })
  const pose = useRef({ rig, base })               // three.js objects are animated in place, outside React renders
  useEffect(() => { pose.current = { rig, base } }, [rig, base])
  useEffect(() => { live.current.still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false }, [])

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    const L = live.current
    const { rig, base } = pose.current
    const k = (rate: number) => 1 - Math.pow(1 - rate, Math.min(dt, 0.1) * 60)   // frame-rate independent easing
    const set = (name: string, target: number, rate: number) => {
      for (const m of rig.meshes) {
        const i = m.morphTargetDictionary[name]
        if (i !== undefined) m.morphTargetInfluences[i] += (target - m.morphTargetInfluences[i]) * k(rate)
      }
    }

    const lip = speakingRef.current ? activeLipsync() : null
    const talking = !!lip && !readerAudio().paused
    let viseme = 'viseme_sil'
    let vol = 0
    if (talking) {
      lip.processAudio()
      viseme = lip.viseme
      vol = lip.features?.volume ?? 0
    }
    L.vol += (vol - L.vol) * k(0.3)
    const vowel = VOWELS.has(viseme)
    const gain = talking ? jawGain(L.vol) : 0
    for (const v of VISEMES) {
      const on = v === viseme && v !== 'viseme_sil'
      set(v, on ? gain * (vowel ? 1 : 0.85) : 0, on ? (vowel ? 0.32 : 0.5) : (vowel ? 0.18 : 0.28))
    }

    if (t > L.nextBlink) { L.blinkUntil = t + 0.11; L.nextBlink = t + 2.2 + Math.random() * 3.8 }
    const blink = t < L.blinkUntil ? 1 : 0
    set('eyeBlinkLeft', blink, 0.7)
    set('eyeBlinkRight', blink, 0.7)
    set('mouthSmileLeft', talking ? 0.1 : 0.22, 0.08)
    set('mouthSmileRight', talking ? 0.1 : 0.22, 0.08)
    set('browInnerUp', talking ? Math.min(0.45, L.vol * 1.1) : 0.06, 0.12)

    if (L.still) return
    const talk = talking ? L.vol : 0
    if (rig.head) {
      rig.head.rotation.set(
        base.head.x + Math.sin(t * 3.1) * talk * 0.06 + Math.sin(t * 0.9) * 0.012,
        base.head.y + Math.sin(t * 0.55) * 0.05 + Math.sin(t * 2.3) * talk * 0.05,
        base.head.z + Math.sin(t * 0.8) * 0.02,
      )
    }
    if (rig.spine) rig.spine.rotation.x = base.spine.x + Math.sin(t * 1.6) * 0.008     // breathing
    if (t > L.nextLook) { L.look = [(Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.12]; L.nextLook = t + 1.5 + Math.random() * 2.5 }
    rig.eyes.forEach((e, i) => {
      e.rotation.x += (base.eyes[i].x + L.look[0] - e.rotation.x) * k(0.25)
      e.rotation.y += (base.eyes[i].y + L.look[1] - e.rotation.y) * k(0.25)
    })
  })

  return <primitive object={rig.scene} />
}

/** Rotates the upper arm (in world space) so it hangs down beside the body with a slight outward angle. */
function hangArm(arm: THREE.Object3D, fore: THREE.Object3D, side: number) {
  const a = arm.getWorldPosition(new THREE.Vector3())
  const b = fore.getWorldPosition(new THREE.Vector3())
  const from = b.sub(a).normalize()
  const to = new THREE.Vector3(side * 0.2, -1, 0.04).normalize()
  const delta = new THREE.Quaternion().setFromUnitVectors(from, to)
  const parent = arm.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion()
  const world = delta.multiply(arm.getWorldQuaternion(new THREE.Quaternion()))
  arm.quaternion.copy(parent.invert().multiply(world))
  arm.updateMatrixWorld(true)
}
