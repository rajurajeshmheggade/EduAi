/**
 * Student study flow: the floating Focus Timer and the 25 / 5 study-break cycle. Every number lives here so the
 * school can retune it in one place.
 */

/** Active study time (on study pages, not idle) before the break reminder. */
export const STUDY_BLOCK_MINUTES = 25
/** The break in the Wellness Game Zone. */
export const BREAK_MINUTES = 5
/** No input for this long (and no tutor speaking) means the student is idle: the time stops counting. */
export const IDLE_AFTER_MINUTES = 2
/** "Break's over" notice: seconds before the student is taken back to the AI Classroom. */
export const RETURN_NOTICE_SECONDS = 10
/** A break that ended longer ago than this (e.g. the app was closed) is not announced any more. */
export const STALE_BREAK_MINUTES = 30

/** Focus timer lengths (minutes): the default, the presets and the custom range. */
export const FOCUS_DEFAULT_MINUTES = 25
export const FOCUS_PRESETS = [15, 25, 45] as const
export const FOCUS_MIN_MINUTES = 1
export const FOCUS_MAX_MINUTES = 180
/** A finished focus session earns the Wellness "pomodoro" XP from this length up (server-side amount and cap). */
export const FOCUS_XP_MIN_MINUTES = 25

export const MINUTE_MS = 60_000
export const STUDY_BLOCK_MS = STUDY_BLOCK_MINUTES * MINUTE_MS
export const BREAK_MS = BREAK_MINUTES * MINUTE_MS
export const IDLE_AFTER_MS = IDLE_AFTER_MINUTES * MINUTE_MS

/** Where the break is spent, and where studying resumes. */
export const GAME_ZONE_PATH = '/student/wellness?tab=games'
export const STUDY_RETURN_PATH = '/student/classroom'

/** Study pages: AI Classroom (home, avatar classroom, chapter reader), Digital Library and its readers, Virtual Labs, Homework. */
const STUDY_ROOTS = ['/student/classroom', '/student/library', '/library', '/student/virtual-labs', '/student/homework']

export function isStudyPath(pathname: string): boolean {
  return STUDY_ROOTS.some((root) => pathname === root || pathname.startsWith(`${root}/`))
}

/** Pages that must never be interrupted: an online test being taken and the admission exam. */
export function isExamPath(pathname: string): boolean {
  return /^\/student\/tests\/[^/]+\/take\/?$/.test(pathname) || pathname.startsWith('/admission/exam/')
}

/** Where the floating timer and the break reminders appear: the student portal (and the shared library readers). */
export function isStudentPortalPath(pathname: string): boolean {
  return pathname.startsWith('/student/') || pathname.startsWith('/library/')
}
