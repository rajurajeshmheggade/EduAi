/** 75 -> '1:15' (offset into the test). */
export function fmtOffset(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}
