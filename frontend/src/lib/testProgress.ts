/**
 * Pure helpers for the online-test 80% completion flag (FR-TST-PROGRESS). The server is the single source of
 * truth for the percentage and the flag itself (see `evaluation_candidate_scripts.progress_flagged_at`); these
 * functions only decide, on the teacher's side, which already-flagged students are *new* since the last poll —
 * so a live monitor can notify once per student per test without ever repeating itself, even across reloads
 * (the caller is expected to seed `seen` from nothing on mount, not from storage, so a fresh page load never
 * re-announces students who were already near completion before it opened).
 */
import type { NearCompletionStudent } from '@/types'

/** Students present in `current` that are not yet in `seen`. Does not mutate `seen`. */
export function newlyNearCompletion(current: NearCompletionStudent[], seen: ReadonlySet<string>): NearCompletionStudent[] {
  return current.filter((s) => !seen.has(s.user_code))
}

export function describeNearCompletion(s: NearCompletionStudent): string {
  return `${s.full_name} has reached ${s.progress_percentage}% completion`
}
