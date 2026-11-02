/**
 * The student's study-break cycle: counts ACTIVE time on study pages (input or the tutor speaking in the last
 * IDLE_AFTER_MINUTES, tab visible); after STUDY_BLOCK_MINUTES the break is due, OK starts a BREAK_MINUTES break in the
 * Wellness Game Zone, then studying resumes in the AI Classroom. The notices themselves are shown by StudyFlowLayer,
 * which keeps them away from exams. Progress is stored per student per day; other open tabs follow it.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { toast } from '@/components/ui/toast'
import { todayISO } from '@/lib/calendar'
import { isStudentActive, trackStudentInput } from '@/lib/studyFlow/activity'
import { isExamPath, isStudyPath } from '@/lib/studyFlow/config'
import { quietNow } from '@/lib/studyFlow/quiet'
import { readStored, storageKey, writeStored } from '@/lib/studyFlow/storage'
import {
  addStudyTime, checkBreak, finishBreak, newCycle, restoreCycle, rollDay, startBreak, type CycleState,
} from '@/lib/studyFlow/studyCycle'

export const CYCLE_TICK_MS = 1000
/** Longest gap one tick may count (a frozen or sleeping tab must not add its whole pause). */
const MAX_TICK_MS = 5000

export interface StudyCycleApi {
  cycle: CycleState
  /** OK on the break reminder: the break starts now. */
  acceptBreak: () => void
  /** The break is over: a new study block starts. */
  resumeStudy: () => void
}

const Ctx = createContext<StudyCycleApi | null>(null)

/** The study cycle, or null outside a student session. */
// eslint-disable-next-line react-refresh/only-export-components
export const useStudyCycle = () => useContext(Ctx)

function load(scope: string | null, now = Date.now()) {
  return { scope, cycle: scope ? restoreCycle(readStored(storageKey('studyCycle', scope)), now) : newCycle(todayISO(new Date(now))) }
}

export function StudyCycleProvider({ scope, children }: { scope: string | null; children: ReactNode }) {
  const [store, setStore] = useState(() => load(scope))
  if (store.scope !== scope) setStore(load(scope))
  const { cycle } = store
  const key = scope ? storageKey('studyCycle', scope) : null
  const { pathname } = useLocation()
  const pathRef = useRef(pathname)
  const cycleRef = useRef(cycle)
  useEffect(() => { pathRef.current = pathname }, [pathname])
  useEffect(() => { cycleRef.current = cycle }, [cycle])

  const setCycle = useCallback((next: CycleState) => {
    cycleRef.current = next
    setStore((s) => ({ ...s, cycle: next }))
  }, [])

  // Count active study time each second; end the break when its time is up.
  useEffect(() => {
    if (!scope) return
    const stopInput = trackStudentInput()
    let last = Date.now()
    const id = window.setInterval(() => {
      const now = Date.now()
      const delta = Math.min(Math.max(0, now - last), MAX_TICK_MS)
      last = now
      const cur = cycleRef.current
      const path = pathRef.current
      let next = rollDay(cur, todayISO(new Date(now)))
      if (isStudyPath(path) && isStudentActive(now)) next = addStudyTime(next, delta)
      next = checkBreak(next, now)
      // Already back on a study page when the break ends (cut it short): just say so, no need to move.
      if (next.phase === 'breakOver' && isStudyPath(path) && !quietNow().exam && !isExamPath(path)) {
        next = finishBreak(next)
        toast('Break’s over — welcome back to your studies!', 'info')
      }
      if (next !== cur) setCycle(next)
    }, CYCLE_TICK_MS)
    return () => { window.clearInterval(id); stopInput() }
  }, [scope, setCycle])

  // Remember it: on every step change and every 5 s of study, and when the page goes away.
  const saved = useRef('')
  useEffect(() => {
    if (!key) return
    const sig = `${key}|${cycle.day}|${cycle.phase}|${cycle.breakEndsAt}|${cycle.cycles}|${Math.floor(cycle.activeMs / 5000)}`
    if (sig === saved.current) return
    saved.current = sig
    writeStored(key, cycle)
  }, [key, cycle])
  useEffect(() => {
    if (!key) return
    const save = () => writeStored(key, cycleRef.current)
    const follow = (e: StorageEvent) => {
      if (e.key !== key || !e.newValue) return
      try {
        const other = restoreCycle(JSON.parse(e.newValue), Date.now())
        const cur = cycleRef.current
        // Another tab moved the cycle on (break taken, block finished, more time studied there).
        if (other.phase !== cur.phase || other.cycles !== cur.cycles || other.activeMs > cur.activeMs) setCycle(other)
      } catch { /* not ours */ }
    }
    window.addEventListener('pagehide', save)
    window.addEventListener('storage', follow)
    return () => { window.removeEventListener('pagehide', save); window.removeEventListener('storage', follow) }
  }, [key, setCycle])

  const api = useMemo<StudyCycleApi>(() => ({
    cycle,
    acceptBreak: () => setCycle(startBreak(cycleRef.current, Date.now())),
    resumeStudy: () => setCycle(finishBreak(cycleRef.current)),
  }), [cycle, setCycle])

  return <Ctx.Provider value={scope ? api : null}>{children}</Ctx.Provider>
}
