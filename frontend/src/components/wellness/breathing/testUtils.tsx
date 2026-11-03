/* Test helpers: a Wellness context with spies, for mounting a tab outside the Wellness page. */
import type { ReactNode } from 'react'
import { vi } from 'vitest'
import { WellnessContext, type WellnessCtx } from '@/components/wellness/WellnessContext'
import type { StudentContext, WellnessProfile } from '@/types/wellness'

export function makeWellnessCtx(profile: Partial<WellnessProfile> = {}, context: Partial<StudentContext> = {}) {
  const academic: StudentContext = {
    className: 'Grade 10 · Section A', gradeLabel: 'Grade 10', grade: 10, section: 'A', term: '2026-27 · Term-1',
    subjects: ['Mathematics', 'Physics'], upcoming: [], countdown: null,
    knowledge: { level: 'Not yet assessed', avgPct: null, assessments: 0, bySubject: [], strongest: null, needsSupport: null },
    ...context,
  }
  const full: WellnessProfile = {
    examDate: null, avatar: '🧘', breathCycles: 0,
    xp: 0, level: 1, levelTitle: 'Mindful Rookie', xpToNext: 100, totalXp: 0, ...profile,
  }
  const ctx = {
    me: { student: { name: 'Asha', code: 'S1', classCode: null }, context: academic, profile: full, stats: null },
    profile: full,
    context: academic,
    meta: null,
    stats: { avgStress: 0, journalsCount: 0, moodTrend: [] },
    refresh: vi.fn(() => Promise.resolve()),
    setStats: vi.fn(),
    applyXp: vi.fn(),
    alert: vi.fn(),
    confirm: vi.fn(),
    setAnalyzing: vi.fn(),
  } satisfies WellnessCtx
  const wrapper = ({ children }: { children: ReactNode }) => <WellnessContext.Provider value={ctx}>{children}</WellnessContext.Provider>
  return { ctx, wrapper }
}
