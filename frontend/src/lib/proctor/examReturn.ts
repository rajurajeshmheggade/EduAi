/**
 * Where the exam view sends an applicant when an admission test started from the standalone admission application
 * ends (instead of the teacher hand-back screen). Only paths inside the admission app are accepted (no open redirect).
 */
const KEY = 'eduai.exam.return'
const SAFE = /^\/apply\/[a-z0-9][a-z0-9-]{5,79}\/[a-z]+$/

export function setExamReturn(path: string) {
  try { if (SAFE.test(path)) sessionStorage.setItem(KEY, path) } catch { /* storage unavailable */ }
}

export function examReturn(): string | null {
  try {
    const v = sessionStorage.getItem(KEY)
    return v && SAFE.test(v) ? v : null
  } catch { return null }
}

export function clearExamReturn() {
  try { sessionStorage.removeItem(KEY) } catch { /* storage unavailable */ }
}
