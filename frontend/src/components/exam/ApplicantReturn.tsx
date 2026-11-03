import { CheckCircle2, Lock, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { examStore } from '@/lib/proctor/examApi'
import { clearExamLock } from '@/lib/proctor/examLock'
import { clearExamReturn, examReturn } from '@/lib/proctor/examReturn'

const REASON: Record<string, string> = {
  MANUAL: 'Your answers have been submitted.',
  TIME_UP: 'Time is up. Your answers have been submitted.',
  AUTO_VIOLATION: 'The test was submitted automatically because the supervision rules were broken too many times.',
  ENDED_BY_TEACHER: 'The school ended the test. Your answers so far have been saved.',
}

/**
 * End of an admission test that was started from the standalone admission application (on the applicant's own
 * device): instead of the teacher hand-back, go back to the application's confirmation. A full page load drops the
 * exam route's state and its content-security policy.
 */
export function ApplicantReturn({ reason, locked = false }: { reason?: string | null; locked?: boolean }) {
  function back() {
    const to = examReturn()
    clearExamLock()
    examStore.clear()
    clearExamReturn()
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    window.location.assign(locked && to ? to.replace(/\/submitted$/, '/test') : to ?? '/')
  }
  return (
    <main className="grid min-h-full place-items-center p-6" data-testid="applicant-return">
      <div className="w-full max-w-md space-y-6 text-center">
        {locked ? <Lock className="mx-auto h-14 w-14 text-warn" /> : <CheckCircle2 className="mx-auto h-14 w-14 text-ok" />}
        <div>
          <h1 className="font-display text-3xl font-bold text-fg">{locked ? 'The test is locked' : 'Admission test submitted'}</h1>
          <p className="mt-2 text-ink-300">{locked ? 'The date of birth did not match three times. Please contact the school.' : REASON[reason ?? ''] ?? REASON.MANUAL}</p>
          {!locked && <p className="mt-2 text-sm text-ink-300">Your application is complete. Your sign-in credentials have now been removed.</p>}
        </div>
        <Button size="lg" onClick={back} id="applicant-return"><LogOut className="h-5 w-5" /> Return to the admission application</Button>
      </div>
    </main>
  )
}
