/* Journal formatting helpers shared by the Journal and Aura Chat tabs (MindAlign JournalAnalyzer + utils/journalContext). */

/** Server limits for one journal entry (POST /me/journals strips whitespace, then checks 10..5000). */
export const MIN_JOURNAL_CHARS = 10
export const MAX_JOURNAL_CHARS = 5000

/**
 * Formats a journal date the same way in the chat panel and in Aura's prompt (e.g. "28 Sep 2026").
 * Mirrors MindAlign's formatJournalDate so "Can we talk about my journal entry from …?" reads the same.
 */
export function formatJournalDate(isoDate: string): string {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return 'Undated entry'
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Long form used above "What you wrote" (e.g. "Tue, 27 Oct 2026, 09:41"). */
export function formatEntryDate(isoDate: string): string {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return 'Undated entry'
  return date.toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/** Compact form used in the Journal History list (e.g. "27 Oct, 09:41"). */
export function formatHistoryDate(isoDate: string): string {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return 'Undated'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export type MoodTone = 'ok' | 'warn' | 'bad'

/** MindAlign getMoodBadgeClass: success ≥ 70, warning ≥ 45, danger below. */
export function moodTone(score: number): MoodTone {
  if (score >= 70) return 'ok'
  if (score >= 45) return 'warn'
  return 'bad'
}

/** MindAlign getMoodLabel. */
export function moodLabel(score: number): string {
  if (score >= 75) return 'Calm & Focused'
  if (score >= 60) return 'Balanced'
  if (score >= 40) return 'Stressed'
  return 'Severe Burnout Alert'
}

/** Hint shown next to the self-reported stress slider. */
export function stressHint(stress: number): string {
  if (stress > 75) return '🔥 High Stress'
  if (stress > 40) return '⚡ Tension'
  return '🍃 Calm'
}

/** True when the user asked the OS to tone down motion (used for smooth scrolling). */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** "academic_struggle" → "Academic struggle" (Aura memory categories). */
export function humanizeCategory(category: string): string {
  const s = category.replace(/[_-]+/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Note'
}
