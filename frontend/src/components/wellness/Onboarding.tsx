import { useState, type FormEvent } from 'react'
import { HeartHandshake, Loader2, ShieldCheck, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Label } from '@/components/ui/field'
import { AcademicProfileCard } from '@/components/wellness/AcademicProfile'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/services/apiClient'
import { wellnessService } from '@/services/wellnessService'
import type { StudentContext, WellnessMeta } from '@/types/wellness'

const FALLBACK_AVATARS = ['🧘', '🧠', '🎯', '🚀', '📚', '🍀', '☀️', '🌈']

/** First step (MindAlign sign-up, minus credentials and the exam picker). Name, class, section, subjects and
    knowledge level all come from the student's EduAI account; they only pick an avatar and, optionally, the date
    their next school exams start. */
export function Onboarding({ name, context, meta, onDone }: { name: string; context: StudentContext; meta: WellnessMeta | null; onDone: () => void }) {
  const avatars = meta?.avatars?.length ? meta.avatars : FALLBACK_AVATARS
  const [examDate, setExamDate] = useState('')
  const [avatar, setAvatar] = useState(avatars[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try { await wellnessService.saveProfile({ examDate: examDate || null, avatar }); onDone() }
    catch (err) { setError(errorMessage(err, 'Could not save your wellness profile')) }
    finally { setBusy(false) }
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-6 p-4 md:p-8">
      <header className="text-center animate-fade-up">
        <span className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-rose-400 to-brand-500 text-white shadow-glow"><HeartHandshake className="h-8 w-8" /></span>
        <h1 className="font-display text-3xl font-bold text-fg">Welcome to <span className="text-gradient">MindAlign</span></h1>
        <p className="mt-2 text-sm text-ink-300">Your personal stress & wellness companion — journal, talk to Aura, breathe, focus and track how you feel.</p>
      </header>
      <Card className="p-6 md:p-8">
        <form onSubmit={submit} className="grid gap-5">
          <div>
            <Label htmlFor="wl-name">Your name</Label>
            <Input id="wl-name" value={name} readOnly className="bg-ink-800" aria-readonly />
            <p className="mt-1 text-xs text-ink-500">From your EduAI account.</p>
          </div>
          <AcademicProfileCard ctx={context} compact />
          <p className="-mt-2 text-xs text-ink-500">
            Tips, the daily quiz and Aura's advice follow your class, subjects and knowledge level. They update as your teachers release results.
          </p>
          <div className="sm:max-w-xs">
            <Label htmlFor="wl-date">When do your next exams start? <span className="font-normal normal-case text-ink-500">(optional)</span></Label>
            <Input id="wl-date" type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
            <p className="mt-1 text-xs text-ink-500">Used for your countdown. Tests your teachers assign show up automatically.</p>
          </div>
          <fieldset>
            <legend className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-300">Pick your avatar</legend>
            <div className="flex flex-wrap gap-2">
              {avatars.map((a) => (
                <button key={a} type="button" aria-pressed={avatar === a} aria-label={`Avatar ${a}`} onClick={() => setAvatar(a)}
                  className={cn('grid h-12 w-12 cursor-pointer place-items-center rounded-xl border text-2xl transition-all',
                    avatar === a ? 'scale-110 border-brand-400 bg-brand-500/10 shadow-glow' : 'border-line bg-ink-900 hover:border-line-strong')}>{a}</button>
              ))}
            </div>
          </fieldset>
          <p className="flex gap-2 rounded-xl border border-aqua-400/30 bg-aqua-500/10 px-3.5 py-3 text-xs leading-relaxed text-ink-300">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-aqua-400" />
            Your journal and chats stay private. Your class teacher sees only wellbeing trends (mood, stress, activity) and safety alerts, so they can support you.
          </p>
          {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
          <Button type="submit" size="lg" disabled={busy} id="wellness-start">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Start my wellness journey
          </Button>
        </form>
      </Card>
    </div>
  )
}
