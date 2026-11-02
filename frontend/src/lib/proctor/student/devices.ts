/**
 * Camera / microphone choice for the student pre-exam check: device lists from enumerateDevices, keeping the
 * student's choice across `devicechange`, and plain-language help when the browser refuses a device.
 */

export type DeviceKind = 'videoinput' | 'audioinput'
export interface DeviceOption { id: string; label: string }

/** Options for one kind, with readable fallbacks ("Camera 2") when labels are hidden before permission is granted. */
export function deviceOptions(devices: Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'>[], kind: DeviceKind): DeviceOption[] {
  const noun = kind === 'videoinput' ? 'Camera' : 'Microphone'
  const seen = new Set<string>()
  const out: DeviceOption[] = []
  for (const d of devices) {
    // "default" / "communications" are Chromium aliases of a real device listed separately.
    if (d.kind !== kind || !d.deviceId || d.deviceId === 'default' || d.deviceId === 'communications' || seen.has(d.deviceId)) continue
    seen.add(d.deviceId)
    out.push({ id: d.deviceId, label: d.label.trim() || `${noun} ${out.length + 1}` })
  }
  return out
}

/**
 * The device to use: the student's choice while it is still connected, else what is running now, else the first one.
 * `lost` is true when the chosen device disappeared (unplugged), so the UI can say so instead of silently switching.
 */
export function pickDevice(options: DeviceOption[], chosen: string | null, current: string | null): { id: string | null; lost: boolean } {
  if (chosen && options.some((o) => o.id === chosen)) return { id: chosen, lost: false }
  if (current && options.some((o) => o.id === current)) return { id: current, lost: !!chosen && chosen !== current }
  return { id: options[0]?.id ?? null, lost: !!chosen }
}

export async function listDevices(kind: DeviceKind): Promise<DeviceOption[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  return deviceOptions(await navigator.mediaDevices.enumerateDevices(), kind)
}

export type MediaProblem = 'denied' | 'not_found' | 'in_use' | 'insecure' | 'unsupported' | 'unknown'
export interface MediaHelp { problem: MediaProblem; title: string; steps: string[] }

/** What went wrong with getUserMedia, and how a student can fix it in their browser. */
export function mediaErrorHelp(error: unknown, kind: 'camera' | 'microphone', secure = typeof window === 'undefined' || window.isSecureContext): MediaHelp {
  const name = (error as { name?: string } | null)?.name ?? ''
  const Kind = kind === 'camera' ? 'Camera' : 'Microphone'
  if (!secure) {
    return { problem: 'insecure', title: `${Kind} needs a secure (https) page`, steps: ['Open EduAI with an https:// address, or ask your teacher for the correct link.'] }
  }
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return {
      problem: 'denied', title: `${Kind} permission was blocked`,
      steps: [
        `Click the camera / lock icon at the left of the address bar and set ${kind} to “Allow”.`,
        `On a Mac, also check System Settings → Privacy & Security → ${Kind} and allow your browser.`,
        `On Windows, check Settings → Privacy & security → ${Kind} → “Let desktop apps access your ${kind}”.`,
        'Then click “Try again”. You may need to reload the page.',
      ],
    }
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return { problem: 'not_found', title: `No ${kind} found`, steps: [`Connect a ${kind} (or switch on the built-in one), then click “Try again”.`, 'If you chose a device from the list, pick another one.'] }
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return { problem: 'in_use', title: `The ${kind} is busy or not responding`, steps: [`Close other apps that may be using the ${kind} (video calls, other browser tabs).`, 'Unplug and reconnect an external device, then click “Try again”.'] }
  }
  if (name === 'TypeError' || name === 'NotSupportedError') {
    return { problem: 'unsupported', title: `This browser cannot use the ${kind} here`, steps: ['Use a recent version of Chrome, Edge, Firefox or Safari.'] }
  }
  return { problem: 'unknown', title: `The ${kind} could not start`, steps: ['Check that it is connected and allowed for this site, then click “Try again”.'] }
}

/** Speech-band level in dB (ProctorMedia.micDb) -> 0..1 for a level meter. */
export const micLevel = (db: number | null) => (db === null || !Number.isFinite(db) ? 0 : Math.max(0, Math.min(1, (db + 90) / 60)))
