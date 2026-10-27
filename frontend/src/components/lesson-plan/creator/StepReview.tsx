import { CircleCheckBig, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Creator } from './useCreator'

/** Step 7 — Review & Create: lesson summary + Save to Draft / Create My Lesson Plan. */
export function StepReview({ c }: { c: Creator }) {
  const leGenerated = c.gen.le
  const summary: [string, string][] = [
    ['Board', c.board ? c.board.toUpperCase() : 'Not selected'],
    ['Grade', c.className || 'Not selected'],
    ['Subject', c.subjectName || 'Not selected'],
    ['Chapter', c.chapter.trim() || 'Not selected'],
  ]
  return (
    <>
      <div className="rounded-[20px] border-2 border-amber-300/60 bg-gradient-to-br from-ink-900 to-amber-400/[0.06] p-6 shadow-xl shadow-amber-400/10 md:p-8">
        <div className="mb-5.5 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white"><Sparkles className="h-5 w-5" /></span>
          <h3 className="text-[22px] font-semibold text-fg">Lesson Summary</h3>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {summary.map(([l, v]) => (
            <div key={l} className="rounded-xl border border-amber-200/70 bg-ink-900/70 p-4">
              <div className="mb-1.5 text-[13px] font-medium text-amber-700">{l}</div>
              <div className="text-[17px] font-semibold text-fg">{v}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-9 flex flex-wrap items-center justify-center gap-3.5">
        {/* A draft can be saved at any point — it does not require the Learning Experience to be finished. */}
        <Button variant="outline" onClick={() => void c.saveDraft()} disabled={c.busy === 'draft' || !c.gen.co}
          title={c.gen.co ? 'Save your progress as a draft' : 'Generate course outcomes first'}
          className="h-auto rounded-2xl border-2 border-amber-400/60 bg-ink-900 px-8.5 py-5 text-base font-semibold text-amber-700 hover:scale-[1.03] hover:bg-amber-400/10">
          <CircleCheckBig className="h-5 w-5" />{c.busy === 'draft' ? 'Saving…' : 'Save to Draft'}
        </Button>
        <Button onClick={() => void c.createPlan()} disabled={!leGenerated}
          className="h-auto rounded-[20px] from-orange-500 to-orange-700 px-11 py-5.5 text-lg font-semibold shadow-2xl shadow-amber-400/40 hover:scale-[1.04] disabled:from-ink-500 disabled:to-ink-500">
          <Sparkles className="h-[22px] w-[22px]" />Create My Lesson Plan
        </Button>
      </div>
      {!leGenerated && <p className="mt-3.5 text-center text-sm text-amber-700">Generate the Learning Experience (Step 6) to finish.</p>}
    </>
  )
}
