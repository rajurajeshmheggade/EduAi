/* Stress Buster copy and tuning (MindAlign StressBusterGame). */
import type { StudentContext } from '@/types/wellness'

export const AFFIRMATIONS = [
  "Test scores don't define my worth!",
  'I am learning at my own perfect pace.',
  'Deep breaths dissolve examination panic.',
  'One topic at a time; I am capable.',
  'My health is more important than a grade.',
  'I have prepared well, and I will do my best.',
  'Failures are just diagnostic feedback loops.',
  'I am resilient, focused, and steady.',
]

/** The worries carried by the balloons, customised to the student's class: their subjects, the subject they find
    hardest and whatever is due next. */
export function stressThoughts(ctx: Pick<StudentContext, 'subjects' | 'gradeLabel' | 'upcoming' | 'knowledge'> | null | undefined): string[] {
  const hardest = ctx?.knowledge.needsSupport ?? ctx?.subjects[0]
  const next = ctx?.upcoming[0]
  return [
    'Low test score',
    hardest ? `${hardest} backlog` : 'Homework backlog',
    next ? `${next.subject} ${next.kindLabel.toLowerCase()} due` : 'Unfinished homework',
    `${ctx?.gradeLabel ?? 'School'} syllabus load`,
    'Comparing with classmates',
    'Sleepless night',
    'Forgot formulas',
    'Family expectations',
    'Exam day panic',
    'Time running out',
    'Useless revision',
  ]
}

/** Calm balloon tints (rose, orange, violet, indigo, blue): a light highlight over a colour deep enough for white text. */
export const BALLOON_COLORS: { light: string; deep: string }[] = [
  { light: '#fda4af', deep: '#e11d48' },
  { light: '#fdba74', deep: '#c2410c' },
  { light: '#c4b5fd', deep: '#7c3aed' },
  { light: '#a5b4fc', deep: '#4f46e5' },
  { light: '#93c5fd', deep: '#2563eb' },
]

export const QUEST_TARGET = 10 // pops that complete the quest
export const POINTS_PER_POP = 10
export const SPAWN_EVERY_MS = 1500
/** Balloons leave once they are this far above the top edge. */
export const OFFSCREEN_PX = 150
/** MindAlign moved balloons 1.2–2.7 px per frame; the same speeds per second at 60 fps, independent of refresh rate. */
export const MIN_SPEED_PX_S = 72
export const MAX_SPEED_PX_S = 162

export const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]
