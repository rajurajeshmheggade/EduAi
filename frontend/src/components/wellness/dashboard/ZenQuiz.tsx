import { useCallback, useEffect, useState } from 'react'
import { isAxiosError } from 'axios'
import { CheckCircle2, HelpCircle, Lightbulb, Loader2, RotateCw, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { celebrate, useWellness } from '@/components/wellness/WellnessContext'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/services/apiClient'
import { wellnessService } from '@/services/wellnessService'
import type { QuizState } from '@/types/wellness'

/** Zen Brain Quiz — one AI-generated question a day. The answer is checked on the server (the client never
    sees `correctIdx` before answering), which also awards +25 XP (correct) or +10 XP (participation). */
export function ZenQuiz() {
  const { applyXp, alert } = useWellness()
  const [quiz, setQuiz] = useState<QuizState | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [pending, setPending] = useState<number | null>(null)

  const fetchQuiz = useCallback(() => wellnessService.quiz()
    .then((q) => { setQuiz(q); setFailed(false) })
    .catch(() => setFailed(true))
    .finally(() => setLoading(false)), [])
  useEffect(() => { void fetchQuiz() }, [fetchQuiz])
  const load = () => { setLoading(true); void fetchQuiz() }

  async function answer(idx: number) {
    if (!quiz || quiz.answered || pending !== null) return
    setPending(idx)
    try {
      const r = await wellnessService.answerQuiz(idx)
      const { xpResult, ...state } = r
      setQuiz(state)
      const xp = xpResult?.awarded ?? 0
      const explanation = state.explanation ?? ''
      if (state.correct) {
        applyXp(xpResult, 'Zen Brain Quiz (Correct Answer)')
        celebrate({ particleCount: 50, spread: 45, colors: ['#22c55e', '#14b8a6'] })
        alert('✨ CORRECT RESPONSE!', `Excellent logic! ${xp > 0 ? `+${xp} XP earned. ` : ''}${explanation}`)
      } else {
        applyXp(xpResult, 'Zen Brain Quiz Participation')
        alert('💡 ANSWER REVIEW', `Not quite${xp > 0 ? `, but you still earn +${xp} XP for participating` : ''}! ${explanation}`)
      }
    } catch (e) {
      if (isAxiosError(e) && e.response?.status === 409) {
        toast("You have already answered today's quiz", 'info')
        void load()
      } else {
        toast(errorMessage(e, 'Could not submit your answer'), 'error')
      }
    } finally {
      setPending(null)
    }
  }

  return (
    <section className="glass flex flex-col gap-4 rounded-2xl p-5 md:p-6" aria-labelledby="quiz-title" aria-busy={loading}>
      <div className="flex items-center justify-between gap-2">
        <h3 id="quiz-title" className="flex items-center gap-2 text-lg font-semibold">
          <HelpCircle className="h-[22px] w-[22px] text-purple-600" aria-hidden /> Zen Brain Quiz
        </h3>
        <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-2.5 py-0.5 text-xs font-semibold text-purple-700">+25 XP</span>
      </div>
      <p className="text-sm leading-relaxed text-ink-500">
        Answer today&apos;s active retrieval psychology check-in to build academic resilience and earn wellness points!
      </p>

      {loading ? (
        <div className="flex flex-col items-center gap-2 py-8" role="status">
          <Loader2 className="h-6 w-6 animate-spin text-purple-500" aria-hidden />
          <span className="text-xs text-ink-500">Generating your custom quiz…</span>
        </div>
      ) : quiz ? (
        <div className="rounded-xl border border-line bg-ink-800/60 p-4">
          <strong id="quiz-question" className="mb-4 block text-[0.95rem] text-fg">{quiz.question}</strong>
          <div role="group" aria-labelledby="quiz-question" className="flex flex-col gap-2.5">
            {quiz.options.map((opt, i) => {
              const isCorrect = quiz.answered && quiz.correctIdx === i
              const isWrongPick = quiz.answered && quiz.answerIdx === i && !isCorrect
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => void answer(i)}
                  disabled={quiz.answered || pending !== null}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors',
                    !quiz.answered && 'cursor-pointer border-purple-500/25 bg-ink-900 text-ink-100 hover:border-purple-500/50 hover:bg-purple-500/5 disabled:cursor-wait',
                    isCorrect && 'border-brand-400 bg-brand-500/10 font-medium text-brand-600',
                    isWrongPick && 'border-bad/50 bg-bad/10 text-bad',
                    quiz.answered && !isCorrect && !isWrongPick && 'border-line bg-ink-900 text-ink-500',
                  )}
                >
                  <span>
                    {opt}
                    {isCorrect && <span className="sr-only"> (correct answer{quiz.answerIdx === i ? ', your answer' : ''})</span>}
                    {isWrongPick && <span className="sr-only"> (your answer, incorrect)</span>}
                  </span>
                  {pending === i && <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />}
                  {isCorrect && <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" aria-hidden />}
                  {isWrongPick && <XCircle className="h-4 w-4 shrink-0" aria-hidden />}
                </button>
              )
            })}
          </div>
          {quiz.answered && quiz.explanation && (
            <p className="mt-4 flex gap-2 rounded-lg border border-purple-500/20 bg-purple-500/5 px-3 py-2.5 text-xs leading-relaxed text-ink-300" aria-live="polite">
              <Lightbulb className="mt-px h-4 w-4 shrink-0 text-purple-600" aria-hidden />
              <span><b className="text-fg">{quiz.correct ? 'Correct!' : 'Answer review:'}</b> {quiz.explanation} <span className="text-ink-500">A new question arrives tomorrow.</span></span>
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <p className="text-sm text-ink-500">{failed ? 'No quiz active right now. Complete a journal analysis first, or try again.' : 'No quiz active. Complete a journal analysis first!'}</p>
          <Button size="sm" variant="secondary" onClick={() => void load()}><RotateCw className="h-3.5 w-3.5" />Try again</Button>
        </div>
      )}
    </section>
  )
}
