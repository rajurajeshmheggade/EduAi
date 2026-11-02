/** Desktop Chromium only: screen-count detection, keyboard lock and entire-screen sharing are Chromium features. */
export function browserGate(): string | null {
  const uad = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[]; mobile: boolean } }).userAgentData
  const chromium = uad ? uad.brands.some((b) => /Chromium|Google Chrome|Microsoft Edge/.test(b.brand)) : /Chrome\/|Edg\//.test(navigator.userAgent)
  if (uad?.mobile || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return 'Admission tests run on a desktop or laptop, not a phone or tablet.'
  if (!chromium || /Firefox|FxiOS/.test(navigator.userAgent)) return 'Use a recent Google Chrome or Microsoft Edge: screen-count detection, keyboard lock and entire-screen sharing need them.'
  if (!window.isSecureContext) return 'Open EduAI over https to use the camera and screen sharing.'
  if (!navigator.mediaDevices?.getDisplayMedia) return 'This browser cannot share the screen.'
  return null
}
