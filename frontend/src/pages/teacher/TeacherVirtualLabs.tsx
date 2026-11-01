import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlaskConical, Info, Search, Send, Users } from 'lucide-react'
import { SourceAttribution } from '@/components/library/diksha/SourceAttribution'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Label, Select } from '@/components/ui/field'
import { Progress } from '@/components/ui/progress'
import { Tabs } from '@/components/ui/tabs'
import { AssignLabDialog } from '@/components/virtual-labs/AssignLabDialog'
import { AssignmentDetail } from '@/components/virtual-labs/AssignmentDetail'
import { LabStage } from '@/components/virtual-labs/LabStage'
import { ROLE_META, ROLE_ORDER, windowBadge } from '@/lib/virtualLabs'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/services/apiClient'
import { virtualLabService, type CollectionInfo, type LabCatalog, type LabSummary, type TeacherLabAssignment } from '@/services/virtualLabService'

type Tab = 'explore' | 'assigned'
type LabDetail = Awaited<ReturnType<typeof virtualLabService.lab>>

/** Teacher: explore DIKSHA virtual labs (Classes 6–12), assign an experiment with a lab worksheet, follow and mark the class. */
export default function TeacherVirtualLabs() {
  const [tab, setTab] = useState<Tab>('explore')
  const [cat, setCat] = useState<LabCatalog | null>(null)
  const [assigned, setAssigned] = useState<TeacherLabAssignment[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadAssigned = useCallback(() => virtualLabService.assignments().then(setAssigned).catch((e) => setError(errorMessage(e))), [])
  useEffect(() => {
    virtualLabService.catalog().then(setCat).catch((e) => setError(errorMessage(e)))
    void loadAssigned()
  }, [loadAssigned])

  const toReview = assigned?.reduce((n, a) => n + a.submitted - a.reviewed, 0) ?? 0
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <header className="animate-fade-up">
        <h1 className="font-display text-3xl font-bold">Virtual <span className="text-gradient">Labs</span></h1>
        <p className="mt-1 text-sm text-ink-300">
          Virtual lab simulations for Classes 6–12 (NCERT, developed with Amrita Vishwa Vidyapeetham and C-DAC). Assign an experiment; students
          perform the simulation, keep a lab record and answer the viva.
        </p>
      </header>
      <Tabs items={[{ id: 'explore', label: 'Explore labs', icon: FlaskConical }, { id: 'assigned', label: 'Assigned', icon: Users, count: assigned?.length }]}
        value={tab} onChange={setTab} />
      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      {tab === 'explore' ? (cat ? <Explore cat={cat} onAssigned={() => { void loadAssigned(); setTab('assigned') }} /> : !error && <div className="skeleton h-96" />) : (
        <Assigned items={assigned} toReview={toReview} onOpen={setOpen} />
      )}
      {open && <AssignmentDetail assignmentId={open} onClose={() => setOpen(null)} onChanged={() => void loadAssigned()} />}
    </div>
  )
}

function Explore({ cat, onAssigned }: { cat: LabCatalog; onAssigned: () => void }) {
  const myGrades = [...new Set(cat.targets.map((t) => t.grade_number).filter((g): g is number => !!g && cat.classes.includes(g)))]
  const [klass, setKlass] = useState(myGrades[0] ?? cat.classes[0])
  const [medium, setMedium] = useState('English')
  const subjects = useMemo(() => cat.collections.filter((c) => c.class_number === klass && c.medium === medium), [cat, klass, medium])
  const [collectionId, setCollectionId] = useState<string | null>(null)
  const current = subjects.find((s) => s.collection_id === collectionId) ?? subjects[0] ?? null
  const [labsOf, setLabsOf] = useState<{ id: string; collection: CollectionInfo; labs: LabSummary[] } | null>(null)
  const [query, setQuery] = useState('')
  const [labId, setLabId] = useState<string | null>(null)
  const [detail, setDetail] = useState<LabDetail | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cid = current?.collection_id
  useEffect(() => {
    if (!cid) return
    let live = true
    virtualLabService.collection(cid, medium).then((d) => { if (live) { setLabsOf({ id: cid, ...d }); setError(null) } })
      .catch((e) => { if (live) setError(errorMessage(e)) })
    return () => { live = false }
  }, [cid, medium])
  const list = labsOf?.id === cid ? labsOf : null
  const shown = list?.labs.filter((l) => !query.trim() || `${l.name} ${l.keywords.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))
  const selected = list?.labs.find((l) => l.lab_id === labId) ?? null

  const loadDetail = useCallback((lab: string) => {
    if (!cid) return
    virtualLabService.lab(cid, lab, medium).then(setDetail).catch((e) => setError(errorMessage(e)))
  }, [cid, medium])
  const pick = (l: LabSummary) => { setLabId(l.lab_id); setDetail(null); loadDetail(l.lab_id) }
  const view = detail && detail.lab.lab_id === labId ? detail : null

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div><Label htmlFor="vl-class">Class</Label>
          <Select id="vl-class" aria-label="Class" value={klass} onChange={(e) => { setKlass(Number(e.target.value)); setCollectionId(null); setLabId(null) }}>
            {cat.classes.map((c) => <option key={c} value={c}>Class {c}</option>)}
          </Select>
        </div>
        <div><Label htmlFor="vl-medium">Medium</Label>
          <Select id="vl-medium" aria-label="Medium" value={medium} onChange={(e) => { setMedium(e.target.value); setCollectionId(null); setLabId(null) }}>
            {cat.mediums.map((m) => <option key={m} value={m}>{m === 'Hindi' ? 'हिन्दी medium' : 'English medium'}</option>)}
          </Select>
        </div>
        <div><Label htmlFor="vl-subject">Subject</Label>
          <Select id="vl-subject" aria-label="Subject" value={current?.collection_id ?? ''} disabled={!subjects.length}
            onChange={(e) => { setCollectionId(e.target.value); setLabId(null) }}>
            {!subjects.length && <option value="">No virtual labs for this class and medium yet</option>}
            {subjects.map((s) => <option key={s.collection_id} value={s.collection_id}>{s.label}</option>)}
          </Select>
        </div>
      </div>
      {!cat.embed_noncommercial && (
        <p className="flex items-start gap-2 rounded-xl border border-aqua-400/30 bg-aqua-500/5 px-3 py-2 text-xs text-ink-300">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-aqua-400" />
          Most virtual labs carry a Creative Commons NonCommercial licence, so their simulations open on the original source site in a new tab.
          Your administrator can let them run inside EduAI after reviewing the licence. Time in the lab is tracked either way.
        </p>
      )}
      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <Card className="flex max-h-[78vh] min-h-0 flex-col p-3">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-500" />
            <Input aria-label="Search experiments" placeholder="Search experiments" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {list && <p className="mb-2 px-1 text-xs text-ink-500">{list.collection.name} · {list.labs.length} experiments</p>}
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto" aria-label="Experiments">
            {!shown ? <li className="skeleton h-64" /> : shown.length === 0 ? <li className="p-4 text-center text-sm text-ink-500">No experiments match.</li> : shown.map((l) => (
              <li key={l.lab_id}>
                <button onClick={() => pick(l)} aria-current={l.lab_id === labId}
                  className={cn('w-full cursor-pointer rounded-xl px-3 py-2 text-left transition-colors', l.lab_id === labId ? 'bg-brand-500/10 ring-1 ring-brand-400/30' : 'hover:bg-ink-800')}>
                  <span className="flex gap-2 text-sm text-fg"><span className="w-6 shrink-0 text-right tabular-nums text-ink-500">{l.position}.</span><span className="line-clamp-2">{l.name}</span></span>
                  <span className="mt-1 flex flex-wrap gap-1 pl-8">
                    {ROLE_ORDER.filter((r) => l.roles[r] && ['simulation', 'theory', 'video', 'self_check'].includes(r)).map((r) => {
                      const Icon = ROLE_META[r].icon
                      return <span key={r} className={cn('inline-flex items-center gap-0.5 text-[11px]', r === 'simulation' ? 'text-ok' : 'text-ink-500')}><Icon className="h-3 w-3" />{ROLE_META[r].label}</span>
                    })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <div className="min-w-0">
          {!selected ? (
            <Card className="grid h-full min-h-80 place-items-center p-10 text-center text-sm text-ink-300">
              <div><FlaskConical className="mx-auto mb-3 h-10 w-10 text-brand-600" />Choose an experiment to preview its simulation and assign it to a class.</div>
            </Card>
          ) : (
            <Card className="space-y-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-display text-xl font-semibold text-fg">{selected.name}</h2>
                  {selected.summary && <p className="mt-1 line-clamp-3 text-sm text-ink-300">{selected.summary}</p>}
                  {selected.keywords.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{selected.keywords.slice(0, 8).map((k) => <Badge key={k}>{k}</Badge>)}</div>}
                </div>
                <Button onClick={() => setAssignOpen(true)} id="open-assign-lab" disabled={!list}><Send className="h-4 w-4" /> Assign to class</Button>
              </div>
              {view?.assigned.length ? (
                <p className="text-xs text-ink-300">Already assigned: {view.assigned.map((a) => `${a.class_name}${a.status === 'closed' ? ' (closed)' : ''}`).join(', ')}</p>
              ) : null}
              {!view ? <div className="skeleton h-[55vh]" /> : <LabStage key={view.lab.lab_id} lab={view.lab} height="55vh" />}
              {list && <SourceAttribution item={list.collection} compact />}
            </Card>
          )}
        </div>
      </div>
      {assignOpen && selected && list && (
        <AssignLabDialog lab={selected} collection={list.collection} targets={cat.targets} onClose={() => setAssignOpen(false)}
          onAssigned={() => { setAssignOpen(false); loadDetail(selected.lab_id); onAssigned() }} />
      )}
    </div>
  )
}

function Assigned({ items, toReview, onOpen }: { items: TeacherLabAssignment[] | null; toReview: number; onOpen: (id: string) => void }) {
  if (!items) return <div className="skeleton h-48" />
  if (items.length === 0) {
    return <Card className="p-10 text-center text-sm text-ink-300"><FlaskConical className="mx-auto mb-2 h-8 w-8 text-ink-500" />No labs assigned yet. Explore the labs and assign one to your class.</Card>
  }
  return (
    <div className="space-y-3">
      {toReview > 0 && <p className="text-sm text-ink-300"><b className="text-fg">{toReview}</b> submission{toReview === 1 ? '' : 's'} waiting for your review.</p>}
      {items.map((a) => {
        const badge = windowBadge(a.window.state, a.due_at, a.available_from)
        const pending = a.submitted - a.reviewed
        return (
          <Card key={a.assignment_id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium uppercase tracking-wide text-brand-600">{a.class_name} · {a.subject_name}</div>
                <div className="mt-0.5 font-display text-lg font-semibold text-fg">{a.title}</div>
                {a.title !== a.lab_name && <div className="text-xs text-ink-500">{a.lab_name}</div>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={badge.tone}>{badge.label}</Badge>
                {pending > 0 && <Badge tone="brand">{pending} to review</Badge>}
                {a.proctor_flags > 0 && <Badge tone="warn" title="Camera/mic check flags across all students' attempts">{a.proctor_flags} camera flag{a.proctor_flags === 1 ? '' : 's'}</Badge>}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <div className="min-w-48 flex-1">
                <div className="mb-1 flex justify-between text-xs text-ink-500"><span>{a.submitted}/{a.students} submitted · {a.started} started</span>
                  <span>{a.average_pct == null ? `${a.reviewed} reviewed` : `class average ${a.average_pct}%`}</span></div>
                <Progress value={a.students ? (a.submitted / a.students) * 100 : 0} tone="ok" />
              </div>
              <Button size="sm" variant="secondary" onClick={() => onOpen(a.assignment_id)} aria-label={`Open ${a.title}`}><Users className="h-3.5 w-3.5" /> Students</Button>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
