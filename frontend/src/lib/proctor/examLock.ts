/**
 * Device lock while an admission exam runs. Launch stores the lock and broadcasts a logout to every tab of this
 * browser profile, so the candidate cannot reach teacher pages; any portal tab shows "Exam in progress" and tells the
 * exam tab, which records PORTAL_ACCESS_ATTEMPT. The lock is cleared only after the teacher signs in again.
 */
export const EXAM_LOCK_KEY = 'eduai.exam-lock'
const MAX_AGE_MS = 6 * 60 * 60 * 1000

export interface ExamLock { session_id: string; at: number }

export function setExamLock(sessionId: string) {
  try { localStorage.setItem(EXAM_LOCK_KEY, JSON.stringify({ session_id: sessionId, at: Date.now() })) } catch { /* storage unavailable */ }
}

export function examLock(): ExamLock | null {
  try {
    const v = JSON.parse(localStorage.getItem(EXAM_LOCK_KEY) ?? 'null') as ExamLock | null
    return v && Date.now() - v.at < MAX_AGE_MS ? v : null
  } catch { return null }
}

export function clearExamLock() {
  try { localStorage.removeItem(EXAM_LOCK_KEY) } catch { /* storage unavailable */ }
}

const channel = (name: string) => (typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(name))

/** Tell every tab to drop the signed-in user (tokens are already cleared from localStorage). */
export function broadcastLogout() {
  const c = channel('eduai-auth')
  c?.postMessage({ type: 'logout' })
  c?.close()
}

export function onAuthBroadcast(fn: () => void): () => void {
  const c = channel('eduai-auth')
  if (!c) return () => {}
  c.onmessage = (e) => { if (e.data?.type === 'logout') fn() }
  return () => c.close()
}

export type ExamMessage = { type: 'portal-access'; path: string } | { type: 'exam-hello'; page: string } | { type: 'exam-taken'; page: string }

export function examChannel(onMessage: (m: ExamMessage) => void): { post: (m: ExamMessage) => void; close: () => void } {
  const c = channel('eduai-exam')
  if (c) c.onmessage = (e) => onMessage(e.data as ExamMessage)
  return { post: (m) => c?.postMessage(m), close: () => c?.close() }
}
