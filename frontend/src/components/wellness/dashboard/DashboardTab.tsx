import { useCallback, useEffect, useState } from 'react'
import { toast } from '@/components/ui/toast'
import { AcademicProfileCard } from '@/components/wellness/AcademicProfile'
import { FocusMode } from '@/components/wellness/focus/FocusMode'
import { useWellness } from '@/components/wellness/WellnessContext'
import { errorMessage } from '@/services/apiClient'
import { wellnessService } from '@/services/wellnessService'
import type { DailyTips } from '@/types/wellness'
import { CopingToolkit } from './CopingToolkit'
import { MoodCheckin } from './MoodCheckin'
import { MoodTrend } from './MoodTrend'
import { StatsTiles } from './StatsTiles'
import { TipsCards } from './TipsCards'
import { ZenQuiz } from './ZenQuiz'

/** MindAlign's initial tips — shown if the server cannot be reached. */
const FALLBACK_TIPS: DailyTips = {
  focus_tip: 'Tackle the topics your teachers stressed most in short active-revision intervals.',
  relaxation_tip: 'Roll your shoulders back, close your eyes, and take three box breathing steps.',
  affirmation: 'I am taking charge of my wellness step-by-step.',
}

/** Wellness ▸ Dashboard (MindAlign `activeTab === 'dashboard'`): AI tips, stats, mood trend, daily check-in,
    Zen Brain quiz, the student's learning profile and Focus Mode. XP, stats and the quiz answer are all decided server-side. */
export function DashboardTab() {
  const { context, applyXp } = useWellness()
  const [tips, setTips] = useState<DailyTips | null>(null)
  const [refreshingTips, setRefreshingTips] = useState(false)

  /** Server caches tips per day + latest journal, so a refresh after a check-in costs one AI call at most.
      On failure keep whatever is on screen (e.g. rate-limited), or MindAlign's defaults on first load. */
  const fetchTips = useCallback(() => wellnessService.tips()
    .then(setTips)
    .catch(() => setTips((t) => t ?? FALLBACK_TIPS))
    .finally(() => setRefreshingTips(false)), [])
  useEffect(() => { void fetchTips() }, [fetchTips])
  const refreshTips = () => { setRefreshingTips(true); void fetchTips() }

  const onFocusComplete = useCallback(() => {
    wellnessService.activity('pomodoro')
      .then((r) => applyXp(r, 'Focus Session Complete'))
      .catch((e: unknown) => toast(errorMessage(e, 'Could not record your focus session'), 'error'))
  }, [applyXp])

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <div className="flex min-w-0 flex-col gap-6 lg:col-span-8">
        <TipsCards tips={tips} refreshing={refreshingTips} />
        <StatsTiles />
        <MoodTrend />
        <MoodCheckin onSaved={refreshTips} />
        <ZenQuiz />
      </div>

      <aside className="flex min-w-0 flex-col gap-6 lg:col-span-4" aria-label="Learning profile, focus and coping">
        <AcademicProfileCard ctx={context} />
        <FocusMode countdown={context.countdown} onSessionComplete={onFocusComplete} />
        <CopingToolkit />
      </aside>
    </div>
  )
}
