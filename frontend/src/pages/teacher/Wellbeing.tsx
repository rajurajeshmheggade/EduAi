import { useEffect, useState } from 'react'
import { Activity, HeartHandshake, Loader2, ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/field'
import { HBarList } from '@/components/wellness/teacher/HBarList'
import { OpenAlertsPanel } from '@/components/wellness/teacher/OpenAlertsPanel'
import { StudentDetailDialog } from '@/components/wellness/teacher/StudentDetailDialog'
import { StudentTable } from '@/components/wellness/teacher/StudentTable'
import { SummaryTiles } from '@/components/wellness/teacher/SummaryTiles'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/services/apiClient'
import { wellnessService } from '@/services/wellnessService'
import type { WellbeingClass, WellbeingOverview, WellbeingStudentRow } from '@/types/wellness'

const PERIODS = [7, 30, 90] as const

/** Teacher ▸ Wellbeing & Mindset — class wellness trends from the students' MindAlign companion.
    Aggregates and safety alerts only: journal text and Aura chats never leave the student's account. */
export default function Wellbeing() {
  const [classes, setClasses] = useState<WellbeingClass[] | null>(null)
  const [klass, setKlass] = useState('')
  const [days, setDays] = useState<number>(30)
  const [data, setData] = useState<WellbeingOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [doneKey, setDoneKey] = useState('')
  const [selected, setSelected] = useState<WellbeingStudentRow | null>(null)
  const key = `${klass}|${days}|${reload}`
  const loading = !!klass && doneKey !== key

  useEffect(() => {
    wellnessService.classes().then((c) => {
      setClasses(c)
      const first = c.find((x) => x.isClassTeacher) ?? c[0]
      if (first) setKlass(first.classCode)
    }).catch((e: unknown) => { setClasses([]); setError(errorMessage(e, 'Could not load your classes')) })
  }, [])

  useEffect(() => {
    if (!klass) return
    let live = true
    wellnessService.overview(klass, days)
      .then((o) => { if (live) { setData(o); setError(null) } })
      .catch((e: unknown) => { if (live) setError(errorMessage(e, 'Could not load class wellbeing')) })
      .finally(() => { if (live) setDoneKey(`${klass}|${days}|${reload}`) })
    return () => { live = false }
  }, [klass, days, reload])

  if (classes && classes.length === 0 && !error) {
    return <div className="grid h-full place-items-center p-8 text-center text-sm text-ink-300"><div><HeartHandshake className="mx-auto mb-3 h-10 w-10 text-ink-500" />You are not assigned to any class yet.</div></div>
  }

  const shown = data && data.classCode === klass ? data : null

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4 animate-fade-up">
        <div>
          <h1 className="font-display text-3xl font-bold">Wellbeing &amp; <span className="text-gradient">Mindset</span></h1>
          <p className="mt-1 text-sm text-ink-300">How your students are feeling — mood, stress and engagement from their MindAlign wellness companion.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {loading && shown && <Loader2 className="h-4 w-4 animate-spin text-ink-500" aria-label="Refreshing" />}
          <Select aria-label="Class" id="wb-class" className="w-60" value={klass} disabled={!classes}
            onChange={(e) => { setKlass(e.target.value); setSelected(null) }}>
            {!classes && <option value="">Loading classes…</option>}
            {classes?.map((c) => <option key={c.classCode} value={c.classCode}>{c.className}{c.isClassTeacher ? ' (class teacher)' : ''} · {c.students}</option>)}
          </Select>
          <Select aria-label="Period" id="wb-period" className="w-40" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {PERIODS.map((d) => <option key={d} value={d}>Last {d} days</option>)}
          </Select>
        </div>
      </header>

      <p className="flex items-start gap-2 rounded-xl border border-aqua-400/30 bg-aqua-500/10 px-4 py-3 text-sm text-ink-300">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-aqua-400" aria-hidden />
        Journal entries and Aura chats are private to each student. You see wellbeing trends and safety alerts only.
      </p>

      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      {!shown ? (
        !error && (
          <div className="space-y-6" aria-busy="true">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-28" />)}</div>
            <div className="skeleton h-96" />
          </div>
        )
      ) : (
        <div className={cn('space-y-6 transition-opacity', loading && 'opacity-60')} aria-busy={loading}>
          <OpenAlertsPanel students={shown.students} onOpen={setSelected} />
          <SummaryTiles summary={shown.summary} days={shown.days} />

          <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
            <Card className="h-fit">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5 text-rose-400" aria-hidden />Stress triggers</CardTitle>
                <CardDescription>Most-mentioned triggers in journal entries, last {shown.days} days.</CardDescription>
              </CardHeader>
              <CardContent>
                <HBarList label={`Stress trigger distribution for ${shown.className}, last ${shown.days} days`} unit="mention" barClass="bg-rose-400"
                  items={shown.triggers.map((t) => ({ label: t.trigger, value: t.count }))} empty="No journal triggers in this period yet." />
              </CardContent>
            </Card>
            <StudentTable students={shown.students} onOpen={setSelected} />
          </div>
        </div>
      )}

      {selected && (
        <StudentDetailDialog classCode={klass} student={selected} days={days}
          onClose={() => setSelected(null)} onAcknowledged={() => setReload((n) => n + 1)} />
      )}
    </div>
  )
}
