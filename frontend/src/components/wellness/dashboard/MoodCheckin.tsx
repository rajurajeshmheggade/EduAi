import { useState } from 'react'
import { Activity, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { celebrate, useWellness } from '@/components/wellness/WellnessContext'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/services/apiClient'
import { wellnessService } from '@/services/wellnessService'

const MOODS = [
  { value: 1, emoji: '😞', label: 'Overwhelmed' },
  { value: 2, emoji: '😐', label: 'Tensed' },
  { value: 3, emoji: '🙂', label: 'Neutral' },
  { value: 4, emoji: '😇', label: 'Focused' },
  { value: 5, emoji: '🚀', label: 'Confident' },
] as const

/** Daily Mood Check-In: pick one of five moods and save it as a quick journal log (+15 XP, server-side). */
export function MoodCheckin({ onSaved }: { onSaved: () => void }) {
  const { setStats, applyXp } = useWellness()
  const [mood, setMood] = useState(3)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const r = await wellnessService.checkin(mood)
      setStats(r.stats)
      applyXp(r.xpResult, 'Mood Check-in')
      celebrate({ particleCount: 50, spread: 50, colors: ['#2dd4bf', '#8b5cf6'] })
      onSaved()
    } catch (e) {
      toast(errorMessage(e, 'Could not save your check-in'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="glass flex flex-col gap-5 rounded-2xl p-5 md:p-6" aria-labelledby="checkin-title">
      <div className="flex items-center justify-between gap-2">
        <h3 id="checkin-title" className="flex items-center gap-2 text-lg font-semibold">
          <Activity className="h-[22px] w-[22px] text-rose-500" aria-hidden /> Daily Mood Check-In
        </h3>
        <span className="rounded-full border border-rose-400/30 bg-rose-400/10 px-2.5 py-0.5 text-xs font-semibold text-rose-700">+15 XP</span>
      </div>
      <p id="checkin-help" className="text-sm leading-relaxed text-ink-500">
        Select the emoji that matches your preparation mindset right now to plot your stress trends:
      </p>

      <div role="group" aria-labelledby="checkin-title" aria-describedby="checkin-help" className="flex justify-around gap-1">
        {MOODS.map((m) => {
          const on = mood === m.value
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => setMood(m.value)}
              aria-pressed={on}
              aria-label={`Mood: ${m.label}`}
              title={m.label}
              className={cn(
                'flex min-w-14 cursor-pointer flex-col items-center gap-1 rounded-2xl border px-1.5 py-2 transition-all duration-200',
                on ? 'border-rose-400/40 bg-rose-400/10' : 'border-transparent hover:bg-ink-800',
              )}
            >
              <span aria-hidden className={cn('text-4xl leading-none transition-transform duration-200 sm:text-[2.5rem]', on ? 'scale-110' : 'opacity-45 grayscale-[30%]')}>{m.emoji}</span>
              <span className={cn('text-[11px] font-medium', on ? 'text-rose-700' : 'text-ink-500')}>{m.label}</span>
            </button>
          )
        })}
      </div>

      <Button
        onClick={() => void save()}
        disabled={busy}
        className="w-full max-w-60 self-center from-purple-600 via-brand-500 to-rose-500"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}Save My State
      </Button>
    </section>
  )
}
