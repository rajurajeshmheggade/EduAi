import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ArrowRight, Coffee, Gamepad2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BREAK_MINUTES, RETURN_NOTICE_SECONDS, STUDY_BLOCK_MINUTES } from '@/lib/studyFlow/config'

/**
 * A modal notice of the study cycle (native <dialog>: focus is trapped and returned by the browser). It has one
 * action; Escape does not dismiss it, so the student always answers it.
 */
function Notice({ title, icon, children, action }: { title: string; icon: ReactNode; children: ReactNode; action: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal?.()
    return () => { if (d?.open) d.close?.() }
  }, [])
  return (
    <dialog ref={ref} role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`}
      onCancel={(e) => e.preventDefault()}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-line bg-ink-900 p-0 text-ink-100 shadow-2xl backdrop:bg-fg/40 backdrop:backdrop-blur-sm">
      <div className="space-y-4 p-6 text-center motion-safe:animate-fade-up">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-rose-400/20 to-purple-500/20 text-rose-500" aria-hidden>{icon}</div>
        <h2 id={`${id}-t`} className="font-display text-xl font-semibold text-fg">{title}</h2>
        <div id={`${id}-d`} className="space-y-2 text-sm leading-relaxed text-ink-300">{children}</div>
        <div className="flex justify-center pt-1">{action}</div>
      </div>
    </dialog>
  )
}

/** After a study block: OK (the only choice) starts the break in the Game Zone. */
export function BreakDueNotice({ onOk }: { onOk: () => void }) {
  return (
    <Notice title={`Time for a ${BREAK_MINUTES}-minute break`} icon={<Coffee className="h-7 w-7" />}
      action={<Button size="lg" className="min-w-32" autoFocus onClick={onOk}>OK</Button>}>
      <p>You’ve studied for {STUDY_BLOCK_MINUTES} minutes — great focus! A short break helps it stick.</p>
      <p><Gamepad2 className="mr-1 inline h-4 w-4 align-[-3px] text-purple-500" aria-hidden />
        Relax in the Wellness Game Zone; after {BREAK_MINUTES} minutes we’ll take you back to your AI Classroom.</p>
    </Notice>
  )
}

/** The break is over: back to the AI Classroom now, or by itself after a few seconds. */
export function BreakOverNotice({ onContinue }: { onContinue: () => void }) {
  const [left, setLeft] = useState(RETURN_NOTICE_SECONDS)
  const done = useRef(onContinue)
  useEffect(() => { done.current = onContinue })
  useEffect(() => {
    const id = window.setInterval(() => setLeft((n) => n - 1), 1000)
    return () => window.clearInterval(id)
  }, [])
  useEffect(() => { if (left <= 0) done.current() }, [left])
  return (
    <Notice title="Break’s over — let’s keep learning!" icon={<ArrowRight className="h-7 w-7" />}
      action={<Button size="lg" autoFocus onClick={onContinue}>Back to the AI Classroom <ArrowRight className="h-4 w-4" /></Button>}>
      <p>Hope that was fun. Your next study block starts now.</p>
      <p>Taking you back in <b className="tabular-nums text-fg">{Math.max(0, left)}</b> s…</p>
    </Notice>
  )
}
