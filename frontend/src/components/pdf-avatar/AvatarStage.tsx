import { Component, lazy, Suspense, type ReactNode } from 'react'
import { AVATAR_MODELS, hasWebGL, loadAvatar3D } from '@/lib/avatars'
import type { AvatarVoice } from '@/services/readAloudService'
import { TeacherAvatar } from './TeacherAvatar'

// three.js + the GLB load only when a 3D avatar is shown (kept out of the classroom's first paint).
const TeacherAvatar3D = lazy(loadAvatar3D)
let webglOk: boolean | null = null              // probed once per page load, only when a 3D model is wanted

/** The teacher's avatar: the 3D model for that gender when there is one and WebGL works, else the 2D avatar
 * (also shown while the model loads and if it fails). `modelUrl`: an already-downloaded model (object URL), or null
 * to use the 2D avatar (the 3D one failed or took too long to load). */
export function AvatarStage({ gender, speaking, label, className, modelUrl }: {
  gender: AvatarVoice
  speaking: boolean
  label: string
  className?: string
  modelUrl?: string | null
}) {
  const url = modelUrl === undefined ? AVATAR_MODELS[gender] : modelUrl
  const flat = <TeacherAvatar gender={gender} speaking={speaking} label={label} className={className} />
  if (!url || !(webglOk ??= hasWebGL())) return flat
  return (
    <Fallback fallback={flat}>
      <Suspense fallback={flat}>
        <TeacherAvatar3D url={url} gender={gender} speaking={speaking} label={label} className={className} />
      </Suspense>
    </Fallback>
  )
}

class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}
