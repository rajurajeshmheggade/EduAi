import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { GAME_ZONE_PATH, STUDY_RETURN_PATH, isExamPath, isStudentPortalPath, isStudyPath } from '@/lib/studyFlow/config'
import { useQuiet } from '@/lib/studyFlow/quiet'
import { FocusTimerProvider, useFocusTimer } from './FocusTimerContext'
import { FocusTimerWidget } from './FocusTimerWidget'
import { StudyCycleProvider, useStudyCycle } from './StudyCycleContext'
import { BreakDueNotice, BreakOverNotice } from './StudyNotice'

/**
 * Students' study companions, mounted once for the whole app: the sticky Focus Timer and the 25 / 5 study-break
 * cycle. Teachers, admins and every other role get neither (the providers stay inert).
 */
export function StudyFlowProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const scope = user?.role === 'student' ? `${user.org_code}.${user.user_code}` : null
  return (
    <FocusTimerProvider scope={scope}>
      <StudyCycleProvider scope={scope}>
        {children}
        {scope && <StudyFlowLayer />}
      </StudyCycleProvider>
    </FocusTimerProvider>
  )
}

/**
 * What the student sees: the floating timer, the break reminder and the "break's over" notice. Nothing appears on an
 * exam (online test being taken, virtual-lab attempt, admission exam): reminders wait until it ends. The floating
 * timer also steps aside during a classroom session, and a due break waits for a running focus session to finish.
 */
export function StudyFlowLayer() {
  const focus = useFocusTimer()
  const study = useStudyCycle()
  const quiet = useQuiet()
  const { pathname } = useLocation()
  const nav = useNavigate()
  if (!focus || !study || !isStudentPortalPath(pathname)) return null

  const exam = quiet.exam || isExamPath(pathname)
  const { cycle } = study
  const showDue = cycle.phase === 'due' && !exam && focus.timer.status !== 'running'
  const showOver = cycle.phase === 'breakOver' && !exam && !isStudyPath(pathname)
  const showTimer = !exam && !quiet.session

  return createPortal(
    <div data-app-portal="">
      {/* Keyed by the break, so its countdown starts from a fresh clock. */}
      {showTimer && <FocusTimerWidget key={cycle.phase === 'break' ? `break-${cycle.breakEndsAt}` : 'focus'} focus={focus} cycle={cycle} />}
      {showDue && <BreakDueNotice onOk={() => { study.acceptBreak(); nav(GAME_ZONE_PATH) }} />}
      {showOver && <BreakOverNotice onContinue={() => { study.resumeStudy(); nav(STUDY_RETURN_PATH) }} />}
    </div>,
    document.body,
  )
}
