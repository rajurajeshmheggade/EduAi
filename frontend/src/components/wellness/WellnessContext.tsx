import { createContext, useContext, type ReactNode } from 'react'
import type { StudentContext, WellnessMe, WellnessMeta, WellnessProfile, WellnessStats, XpResult } from '@/types/wellness'

/** Shared state for the Wellness tabs (MindAlign App.jsx state, now server-backed). */
export interface WellnessCtx {
  me: WellnessMe
  /** Always set inside the tabs — the shell shows onboarding until the profile exists. */
  profile: WellnessProfile
  /** Class, section, subjects, knowledge level and upcoming work from EduAI — what every prompt is pitched at. */
  context: StudentContext
  meta: WellnessMeta | null
  stats: WellnessStats
  refresh: () => Promise<void>
  setStats: (s: WellnessStats) => void
  /** Apply a server XP result: updates the header bar, toasts "+N XP", celebrates a level-up (MindAlign rewardXp). */
  applyXp: (r: XpResult | null | undefined, taskName: string) => void
  alert: (title: string, message: ReactNode) => void
  confirm: (title: string, message: ReactNode, onConfirm: () => void) => void
  /** Drives the 3D background while an AI analysis runs. */
  setAnalyzing: (b: boolean) => void
}

export const WellnessContext = createContext<WellnessCtx | null>(null)

export function useWellness(): WellnessCtx {
  const v = useContext(WellnessContext)
  if (!v) throw new Error('useWellness must be used inside the Wellness page')
  return v
}

/** Fire confetti without putting canvas-confetti in the initial bundle. */
export function celebrate(opts: { particleCount?: number; spread?: number; angle?: number; origin?: { x?: number; y: number }; colors?: string[] } = {}) {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  void import('canvas-confetti').then((m) => m.default({ particleCount: 80, spread: 60, origin: { y: 0.7 }, ...opts })).catch(() => {})
}
