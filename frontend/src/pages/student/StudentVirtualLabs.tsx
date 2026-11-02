import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Clock, FlaskConical, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { ErrorState, Skeleton } from '@/components/ui/loading'
import { Tabs } from '@/components/ui/tabs'
import { buttonVariants } from '@/components/ui/button'
import { useAsync } from '@/lib/useAsync'
import { duration, fmtMarks, STATUS_META, windowBadge } from '@/lib/virtualLabs'
import { virtualLabService, type MyLab } from '@/services/virtualLabService'

type Filter = 'todo' | 'submitted' | 'reviewed'
const inFilter = (l: MyLab, f: Filter) =>
  f === 'todo' ? l.my.status === 'not_started' || l.my.status === 'in_progress' : l.my.status === f

/** Student: virtual labs assigned to my class, with progress and marks. */
export default function StudentVirtualLabs() {
  const { data, error, retry } = useAsync(() => virtualLabService.myLabs(), [])
  const labs = data?.labs
  const [filter, setFilter] = useState<Filter>('todo')

  const count = (f: Filter) => labs?.filter((l) => inFilter(l, f)).length ?? 0
  const shown = labs?.filter((l) => inFilter(l, filter))
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <header className="animate-fade-up">
        <h1 className="font-display text-3xl font-bold">Virtual <span className="text-gradient">Labs</span></h1>
        <p className="mt-1 text-sm text-ink-300">Perform virtual lab experiments, record your observations and answer the viva.</p>
      </header>
      <Tabs items={[{ id: 'todo', label: 'To do', count: count('todo') }, { id: 'submitted', label: 'Submitted', count: count('submitted') },
        { id: 'reviewed', label: 'Marked', count: count('reviewed') }]} value={filter} onChange={setFilter} />
      {error && <ErrorState title="Couldn’t load your labs" message={error} onRetry={retry} />}
      {!shown ? !error && <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div> : shown.length === 0 ? (
        <Card className="p-10 text-center text-sm text-ink-300">
          <FlaskConical className="mx-auto mb-2 h-8 w-8 text-ink-500" />{filter === 'todo' ? 'No labs to do right now.' : 'Nothing here yet.'}
        </Card>
      ) : (
        <ul className="space-y-3">
          {shown.map((l) => {
            const w = windowBadge(l.window.state, l.due_at, l.available_from)
            const st = STATUS_META[l.my.status]
            const action = l.my.status === 'not_started' ? 'Start lab' : l.my.status === 'in_progress' ? 'Continue' : 'View'
            return (
              <li key={l.assignment_id}>
                <Card className="flex flex-wrap items-center gap-4 p-5">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-500/15 to-aqua-500/15">
                    <FlaskConical className="h-6 w-6 text-brand-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium uppercase tracking-wide text-brand-600">{l.subject_name}</div>
                    <div className="font-display text-lg font-semibold text-fg">{l.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {l.my.status !== 'reviewed' && l.my.status !== 'submitted' && <Badge tone={w.tone}>{w.label}</Badge>}
                      {l.my.returned && <Badge tone="warn"><RotateCcw className="h-3 w-3" /> Sent back to redo</Badge>}
                      {l.my.active_seconds > 0 && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{duration(l.my.active_seconds)} in lab</span>}
                      {l.my.status === 'reviewed' && <b className="text-fg">{fmtMarks(l.my.marks)}/{fmtMarks(l.max_marks)} marks</b>}
                    </div>
                  </div>
                  {(l.window.can_work || l.my.status !== 'not_started') ? (
                    <Link to={`/student/virtual-labs/${l.assignment_id}`} className={buttonVariants({ variant: l.my.status === 'reviewed' || l.my.status === 'submitted' ? 'secondary' : 'default' })}>
                      {action} <ArrowRight className="h-4 w-4" />
                    </Link>
                  ) : <span className="text-xs text-ink-500">{l.window.state === 'scheduled' ? 'Not open yet' : 'Closed'}</span>}
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
