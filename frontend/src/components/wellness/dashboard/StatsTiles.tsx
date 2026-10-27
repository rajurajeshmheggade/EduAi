import { useWellness } from '@/components/wellness/WellnessContext'

function Tile({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div className="glass rounded-2xl px-3 py-4 text-center" title={hint}>
      <span className="mb-1 block text-xs text-ink-500">{label}</span>
      <span className="font-display text-2xl font-extrabold text-gradient sm:text-3xl">{value}</span>
    </div>
  )
}

/** MindAlign's three dashboard widgets: average stress, journal logs and completed breathing cycles. */
export function StatsTiles() {
  const { stats, profile } = useWellness()
  return (
    <section aria-label="Your wellness stats" className="grid grid-cols-3 gap-3 sm:gap-4">
      <Tile label="Avg. Stress" value={stats.avgStress > 0 ? `${stats.avgStress}%` : 'N/A'} hint="Average self-reported stress across your journal entries and check-ins" />
      <Tile label="Journal Logs" value={stats.journalsCount} hint="Journal entries and mood check-ins saved" />
      <Tile label="Mindful Cycles" value={profile.breathCycles} hint="Breathing cycles completed" />
    </section>
  )
}
