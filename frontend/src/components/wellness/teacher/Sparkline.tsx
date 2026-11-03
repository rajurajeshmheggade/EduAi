const W = 76
const H = 26
const PAD = 4

/** 7-entry mood sparkline (0–100 scale, oldest → latest) with the latest point marked. */
export function Sparkline({ values }: { values: number[] }) {
  const v = values.slice(-7)
  if (v.length < 2) return <span className="text-xs text-ink-500" title="Not enough entries for a trend">—</span>
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / (v.length - 1)
  const y = (m: number) => PAD + (1 - Math.min(100, Math.max(0, m)) / 100) * (H - PAD * 2)
  const pts = v.map((m, i) => `${x(i).toFixed(1)},${y(m).toFixed(1)}`).join(' ')
  const last = v[v.length - 1]
  const label = `Mood trend over last ${v.length} entries: ${v.join(', ')}; latest ${last}`
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="block overflow-visible">
      <title>{label}</title>
      <line x1={PAD} x2={W - PAD} y1={y(50)} y2={y(50)} className="stroke-line" strokeWidth={1} />
      <polyline points={pts} fill="none" className="stroke-brand-500" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(v.length - 1)} cy={y(last)} r={3.5} className="fill-brand-500 stroke-ink-900" strokeWidth={2} />
    </svg>
  )
}
