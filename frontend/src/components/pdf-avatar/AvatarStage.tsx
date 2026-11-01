import { Component, lazy, Suspense, useState, type ReactNode } from 'react'
import { AVATAR_MODELS, hasWebGL } from '@/lib/avatars'
import type { AvatarVoice } from '@/services/readAloudService'
import { TeacherAvatar } from './TeacherAvatar'

// three.js + the GLB load only when a 3D avatar is shown (kept out of the classroom's first paint).
const TeacherAvatar3D = lazy(() => import('./TeacherAvatar3D'))

/** The teacher's avatar: the 3D model for that gender when there is one and WebGL works, else the 2D avatar
 * (also shown while the model loads and if it fails). */
export function AvatarStage({ gender, speaking, label, className }: {
  gender: AvatarVoice
  speaking: boolean
  label: string
  className?: string
}) {
  const url = AVATAR_MODELS[gender]
  const [webgl] = useState(() => (url ? hasWebGL() : false))
  const flat = <TeacherAvatar gender={gender} speaking={speaking} label={label} className={className} />
  if (!url || !webgl) return flat
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
