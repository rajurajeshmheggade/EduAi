import type { EffectiveAccess, LicenseStatus, VerificationStatus } from '@/services/libraryService'

type Tone = 'brand' | 'ok' | 'warn' | 'bad' | 'aqua' | 'neutral'

export const ACCESS_LABEL: Record<EffectiveAccess, { label: string; tone: Tone; hint: string }> = {
  in_app_file: { label: 'Read in app', tone: 'ok', hint: 'Authorised copy opens in the in-app reader' },
  in_app_embed: { label: 'Read in app', tone: 'ok', hint: 'Embedding permitted by the source' },
  official_link: { label: 'Official link', tone: 'aqua', hint: 'Opens on the official source website' },
  unavailable: { label: 'Unavailable', tone: 'neutral', hint: 'Not available to readers' },
}
export const LICENSE_LABEL: Record<LicenseStatus, { label: string; tone: Tone }> = {
  verified: { label: 'Licence verified', tone: 'ok' },
  permission_required: { label: 'Permission required', tone: 'warn' },
  unknown: { label: 'Licence unknown', tone: 'neutral' },
}
export const VERIFY_LABEL: Record<VerificationStatus, { label: string; tone: Tone }> = {
  verified: { label: 'Verified', tone: 'ok' },
  pending: { label: 'Pending review', tone: 'warn' },
  rejected: { label: 'Rejected', tone: 'bad' },
}

/** Deterministic cover gradient per subject so covers stay recognisable without fetching third-party images. */
const COVERS = [
  'from-indigo-500 to-sky-400', 'from-emerald-500 to-teal-400', 'from-rose-500 to-orange-400', 'from-violet-500 to-fuchsia-400',
  'from-amber-500 to-yellow-400', 'from-cyan-600 to-blue-400', 'from-lime-600 to-green-400', 'from-pink-500 to-rose-400',
]
export function coverClass(subject: string) {
  let h = 0
  for (const ch of subject.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return COVERS[h % COVERS.length]
}

export const LIBRARY_EMPTY_STUDENT = 'No books have been published for your class yet. Please check again later or contact your teacher.'
