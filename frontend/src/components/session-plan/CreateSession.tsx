import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, BookOpen, ChevronDown, Clock, FolderOpen, Info, Lightbulb, Loader2, Save, Target, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/field'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { httpStatus, sessionErrorMessage, sessionPlanService } from '@/services/lessonPlanService'
import type { GenerateSessionResponse, LessonPlanRow } from '@/types/lessonPlan'
import { defaultResources, stagesPayload, type ResourcesValue } from './resourcesModel'
import { SessionLoader } from './SessionLoader'
import { SessionResources } from './SessionResources'

/* Create Session (port of Rapid's CreateSession.jsx) — reached from "Create Session" on the Session Manager.
   Create only, by design: a saved session is opened read-only through Plan or Preview.

   Session Details, Session Instructions, the lesson plan's OWN Expected Learning Outcomes (read from the
   database, never invented — a plan without them shows an empty state and can still create a session), the
   collapsible optional Session Resources card, and Create Session: generate with save:true, which writes
   the row, its stages and its picked resources in one request while the full-page loader runs. */

/** A session is a lesson period, not a course — 24 h still allows a field trip or an exam sitting. */
const MAX_DURATION_MINS = 1440

function Section({ title, icon, iconClass = 'text-brand-600', optional, collapsible, defaultOpen = true, children }: {
  title: string; icon?: ReactNode; iconClass?: string; optional?: boolean; collapsible?: boolean; defaultOpen?: boolean; children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const shown = !collapsible || open
  const head = (
    <>
      {icon ? <span className={cn('shrink-0 [&>svg]:h-[18px] [&>svg]:w-[18px]', iconClass)}>{icon}</span> : null}
      <h3 className="font-display text-[15.5px] font-semibold text-fg">{title}</h3>
      {optional && <span className="rounded-full bg-ink-800 px-2.5 py-0.5 text-[11.5px] font-medium text-ink-500">Optional</span>}
      {collapsible && (
        <span className={cn('ml-auto inline-flex h-[26px] w-[26px] items-center justify-center rounded-lg bg-brand-500/12 text-brand-600 transition-transform duration-300', !open && '-rotate-90')}>
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={2.6} />
        </span>
      )}
    </>
  )
  return (
    <section className="glass rounded-2xl">
      {collapsible ? (
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
          className={cn('flex w-full cursor-pointer items-center gap-2.5 border-b px-5 py-4 text-left transition-colors', open ? 'border-line' : 'border-transparent')}>{head}</button>
      ) : (
        <div className="flex items-center gap-2.5 border-b border-line px-5 py-4">{head}</div>
      )}
      <div aria-hidden={shown ? undefined : true}
        className={cn('grid transition-[grid-template-rows,opacity] duration-300', shown ? 'grid-rows-[1fr] opacity-100' : 'invisible grid-rows-[0fr] opacity-0')}>
        <div className={cn('min-h-0', shown ? 'overflow-visible' : 'overflow-hidden')}><div className="p-5">{children}</div></div>
      </div>
    </section>
  )
}

function Field({ id, label, value, placeholder, onChange, inputMode }: {
  id: string; label: string; value: string; placeholder: string; onChange: (v: string) => void; inputMode?: 'numeric'
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13.5px] font-medium text-fg">{label} <span className="text-bad">*</span></label>
      <Input id={id} value={value} placeholder={placeholder} inputMode={inputMode} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

interface Draft { title: string; duration: string; instructions: string; selectedELOs: string[]; resources: ResourcesValue }

export function CreateSession({ plan, onBack, onCreated }: {
  plan: LessonPlanRow
  onBack: () => void
  onCreated: (res: GenerateSessionResponse) => void
}) {
  const grade = plan.className || ''
  const subject = plan.subjectName || ''
  const title = plan.title || 'Lesson Plan'
  const lessonPlanId = plan.id

  const [data, setData] = useState<Draft>(() => ({ title: '', duration: '', instructions: '', selectedELOs: [], resources: defaultResources(plan) }))
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  // ── ELOs: the plan's own, read from the database ──────────────────────────────────────────────────
  const [elos, setElos] = useState<string[]>([])
  const [eloState, setEloState] = useState(() => (lessonPlanId
    ? { busy: true, message: '', error: '' }
    : { busy: false, message: '', error: 'This lesson plan has no id, so its outcomes cannot be loaded.' }))
  useEffect(() => {
    if (!lessonPlanId) return undefined
    let alive = true
    sessionPlanService.getSessionElos(lessonPlanId)
      .then((res) => {
        if (!alive) return
        const rows = (Array.isArray(res?.elos) ? res.elos : []).map((e) => String(e?.elo ?? '').trim()).filter(Boolean)
        setElos(Array.from(new Set(rows)))
        setEloState({ busy: false, message: res?.message || '', error: '' })
      })
      .catch((e: unknown) => {
        if (!alive) return
        // A 404 means "there are none", not "something broke" — it falls through to the empty state.
        setEloState({ busy: false, message: '', error: httpStatus(e) === 404 ? '' : sessionErrorMessage(e, 'The outcomes could not be loaded.') })
      })
    return () => { alive = false }
  }, [lessonPlanId])

  const set = <K extends keyof Draft>(k: K) => (val: Draft[K]) => { setErr(''); setData((d) => ({ ...d, [k]: val })) }
  const toggleELO = (elo: string) => setData((d) => ({
    ...d, selectedELOs: d.selectedELOs.includes(elo) ? d.selectedELOs.filter((x) => x !== elo) : [...d.selectedELOs, elo],
  }))

  const save = async () => {
    const name = data.title.trim()
    // Reported one at a time, naming the field at fault.
    if (!name) { setErr('Please enter a session title.'); return }
    const durationMins = parseInt(data.duration, 10)
    if (!Number.isFinite(durationMins) || durationMins <= 0) { setErr('Please enter a duration in minutes.'); return }
    if (durationMins > MAX_DURATION_MINS) { setErr(`Duration cannot be longer than ${MAX_DURATION_MINS} minutes (24 hours).`); return }
    // Only required when the plan actually HAS outcomes to offer.
    if (elos.length > 0 && data.selectedELOs.length === 0) { setErr('Please select at least one Expected Learning Outcome.'); return }

    setLoading(true)
    setErr('')

    // Duplicate title, checked against the SERVER: the list is paged, so a check against the rows on screen
    // would pass a duplicate sitting on page 2. Trimmed + case-insensitive.
    try {
      const found = await sessionPlanService.listSessions({ lessonPlanId, search: name, page: 1, pageSize: 100 })
      const clash = (found?.sessions ?? []).some((r) => String(r.title || '').trim().toLowerCase() === name.toLowerCase())
      if (clash) {
        setErr(`A session called “${name}” already exists in this lesson plan. Please use a different name.`)
        setLoading(false)
        return
      }
    } catch {
      // The CHECK failed, not the name (a 404 is simply "no sessions yet"). Blocking creation because a lookup
      // could not be reached would be worse than letting a rare duplicate through.
    }

    try {
      const res = await sessionPlanService.generateSession({
        lessonPlanId, title: name, durationMins, instructions: data.instructions, elos: data.selectedELOs,
        stages: stagesPayload(data.resources), includeAgents: true, save: true,
      })
      // One message: the session was created. Which extra blocks came back empty is said per block on the
      // Session Plan screen this lands on — listing it here would read as a complaint about a thing that worked.
      toast('Session created successfully.', 'success')
      setLoading(false)
      onCreated(res)
    } catch (e) {
      setErr(sessionErrorMessage(e))
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-8">
      {/* Full-page while the session generates — a small spinner made a 15-30s request feel broken. */}
      <SessionLoader open={loading} title="Generating your session"
        subtitle={`Writing “${data.title.trim() || title}” for ${[grade, subject].filter(Boolean).join(' · ')}, and gathering matching resources.`} />

      <header className="flex flex-wrap items-end justify-between gap-4 animate-fade-up">
        <div>
          <button type="button" onClick={onBack}
            className="mb-3 inline-flex cursor-pointer items-center gap-1.5 rounded-lg text-sm font-medium text-ink-500 transition-colors hover:text-brand-600">
            <ArrowLeft className="h-4 w-4" />Back to Sessions
          </button>
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-green-600 to-green-800 text-white shadow-[0_6px_14px_-6px_rgb(22_101_52/.55)]">
              <Target className="h-5 w-5" />
            </span>
            <div>
              <h1 className="font-display text-3xl font-bold">Create <span className="text-gradient">Session</span></h1>
              <p className="mt-1 text-sm text-ink-300">Design individual learning sessions</p>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-fg">{grade}</div>
          <div className="text-[13px] text-ink-500">{subject}</div>
        </div>
      </header>

      {/* Lesson plan summary */}
      <div className="glass rounded-2xl p-5">
        <h2 className="mb-1 font-display text-[21px] font-bold text-fg">{title}</h2>
        <p className="mb-3 text-[13.5px] text-ink-500">Create a new session for this lesson plan</p>
        <div className="flex flex-wrap gap-4 text-[13px] text-ink-500">
          <span className="inline-flex items-center gap-1.5"><BookOpen className="h-3.5 w-3.5" />Session Creation</span>
          {grade && <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />{grade}</span>}
        </div>
      </div>

      <Section title="Session Details" icon={<Clock />}>
        <div className="flex flex-col gap-4">
          <Field id="cs-title" label="Session Title" value={data.title} placeholder="Enter session title…" onChange={set('title')} />
          {/* 0 cannot be TYPED: non-digits and leading zeros are stripped as you go, so "0045" becomes "45". */}
          <Field id="cs-duration" label="Duration (minutes)" value={data.duration} placeholder="e.g., 45" inputMode="numeric"
            onChange={(x) => set('duration')(x.replace(/[^0-9]/g, '').replace(/^0+/, '').slice(0, 4))} />
        </div>
      </Section>

      <Section title="Session Instructions">
        <Textarea aria-label="Session instructions" value={data.instructions} rows={5} className="resize-y"
          placeholder="Write detailed instructions for this session…" onChange={(e) => set('instructions')(e.target.value)} />
      </Section>

      <Section title="Expected Learning Outcomes" icon={<Lightbulb />} iconClass="text-ok">
        {eloState.busy ? (
          <div className="flex items-center gap-2.5 px-0.5 py-2 text-[13px] text-ink-500">
            <Loader2 className="h-4 w-4 animate-spin text-brand-500" />Loading this lesson plan’s outcomes…
          </div>
        ) : eloState.error ? (
          <div role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3.5 py-3 text-[13px] leading-relaxed text-bad">{eloState.error}</div>
        ) : elos.length === 0 ? (
          // Empty state, not an error: ELO generation is a separate step of the lesson plan wizard.
          <div className="flex items-start gap-3 rounded-xl border border-line bg-ink-800 px-4 py-3.5">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" />
            <span className="text-[13px] leading-relaxed text-ink-500">
              {eloState.message || 'This lesson plan has no Expected Learning Outcomes saved yet.'}
              {' '}You can still create the session now and select outcomes once they have been generated.
            </span>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              {elos.map((elo, i) => {
                const checked = data.selectedELOs.includes(elo)
                return (
                  <label key={i} className={cn('flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors',
                    checked ? 'border-brand-400/40 bg-brand-500/[0.06]' : 'border-transparent hover:bg-ink-800')}>
                    <input type="checkbox" checked={checked} onChange={() => toggleELO(elo)}
                      className="mt-0.5 h-[18px] w-[18px] shrink-0 cursor-pointer accent-brand-500" />
                    <span className="text-[13.5px] leading-normal text-fg">{elo}</span>
                  </label>
                )
              })}
            </div>
            <div className="mt-3 text-xs text-ink-500">Selected: {data.selectedELOs.length} of {elos.length}</div>
          </>
        )}
      </Section>

      <Section title="Session Resources" icon={<FolderOpen />} iconClass="text-violet-600" collapsible defaultOpen={false} optional>
        {/* The Preview header shows the session name being typed above (Rapid showed "Untitled session"). */}
        <SessionResources plan={plan} value={{ ...data.resources, name: data.title.trim() }} onChange={set('resources')}
          objectives={data.selectedELOs} />
      </Section>

      <div className="flex flex-col items-end gap-2.5 pb-2">
        {err ? <div role="alert" className="max-w-[640px] rounded-lg border border-bad/30 bg-bad/10 px-3.5 py-2 text-right text-[13px] font-medium leading-relaxed text-bad">{err}</div> : null}
        <Button id="create-session-submit" size="lg" onClick={() => void save()} disabled={loading}>
          <Save className="h-4 w-4" />Create Session
        </Button>
      </div>
    </div>
  )
}
