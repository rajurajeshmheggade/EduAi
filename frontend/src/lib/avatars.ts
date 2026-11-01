import type { AvatarVoice } from '@/services/readAloudService'

/**
 * 3D teacher avatars (Ready Player Me GLB with Oculus viseme + ARKit morph targets), served from public/avatars.
 * A gender without a model uses the 2D illustrated avatar. To add one, drop the .glb into public/avatars and set it here.
 */
export const AVATAR_MODELS: Record<AvatarVoice, string | null> = {
  female: '/avatars/teacher-female.glb',
  male: null,
}

export function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}
