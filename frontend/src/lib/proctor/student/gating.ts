/**
 * Pre-exam gating (pure, unit-tested): which checks a module requires, and whether the student may begin.
 * The server re-checks the acknowledgement and the mandatory results on /start, so this is the UI's copy of the rule.
 */
import type { ClientRules } from '@/services/proctoringService'

export type CheckKey = 'camera' | 'microphone' | 'detector' | 'face'
export type CheckStatus = 'pending' | 'running' | 'pass' | 'fail'
export interface CheckState { status: CheckStatus; detail?: string }
export type Checks = Record<CheckKey, CheckState>

export type Step = 'rules' | 'devices'

export const CHECK_LABEL: Record<CheckKey, string> = {
  camera: 'Camera connected', microphone: 'Microphone connected', detector: 'On-device detection ready', face: 'Face visible and well lit',
}

/** Mandatory checks for these rules, in the order they run. */
export function requiredChecks(r: Pick<ClientRules, 'camera_required' | 'mic_required'>): CheckKey[] {
  return [...(r.camera_required ? ['camera', 'detector', 'face'] as CheckKey[] : []), ...(r.mic_required ? ['microphone'] as CheckKey[] : [])]
}

export const initialChecks = (): Checks => ({ camera: { status: 'pending' }, microphone: { status: 'pending' }, detector: { status: 'pending' }, face: { status: 'pending' } })

/** The rules step can only be left with the acknowledgement ticked. */
export const canLeaveRules = (acknowledged: boolean) => acknowledged

export interface BeginState { ready: boolean; blocking: { key: CheckKey | 'ack' | 'fullscreen'; message: string }[] }

/** May the student press "Begin"? Every mandatory check must pass; full screen is entered by that click itself. */
export function beginState(r: Pick<ClientRules, 'camera_required' | 'mic_required' | 'fullscreen_required'>, acknowledged: boolean, checks: Checks,
  fullscreenSupported: boolean): BeginState {
  const blocking: BeginState['blocking'] = []
  if (!acknowledged) blocking.push({ key: 'ack', message: 'Acknowledge the examination rules' })
  for (const k of requiredChecks(r)) {
    if (checks[k].status !== 'pass') blocking.push({ key: k, message: `${CHECK_LABEL[k]}${checks[k].status === 'fail' ? ' — failed' : ' — waiting'}` })
  }
  if (r.fullscreen_required && !fullscreenSupported) blocking.push({ key: 'fullscreen', message: 'This browser cannot open full screen — use Chrome, Edge, Firefox or Safari' })
  return { ready: blocking.length === 0, blocking }
}

/** What /start receives: the device's own report of the mandatory checks. */
export function startChecks(checks: Checks, fullscreen: boolean) {
  return { camera: checks.camera.status === 'pass', face: checks.face.status === 'pass', microphone: checks.microphone.status === 'pass',
    fullscreen, lighting: checks.face.status === 'pass' }
}

/** One frame of the face check: 3 good frames in a row pass it. */
export function faceVerdict(r: { faces: number; luma: { mean: number; std: number } }, dark: (l: { mean: number; std: number }) => boolean):
  { ok: boolean; hint: string } {
  if (dark(r.luma)) return { ok: false, hint: 'It is too dark or the camera is covered — add light in front of you' }
  if (r.faces === 0) return { ok: false, hint: 'We cannot see your face — sit in front of the camera' }
  if (r.faces > 1) return { ok: false, hint: 'Only you should be in view of the camera' }
  return { ok: true, hint: 'Face visible' }
}
