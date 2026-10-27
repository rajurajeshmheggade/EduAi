import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  Archive, BookOpen, BookPlus, Check, CheckCircle2, ChevronRight, GraduationCap, Loader2, Pencil, Plus, RotateCcw, School, Search, Trash2, UserRound, Users, X,
} from 'lucide-react'
import { SyllabusEditor } from '@/components/admin/SyllabusEditor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label, Select } from '@/components/ui/field'
import { adminTabLink } from '@/lib/adminTabs'
import { cn } from '@/lib/utils'
import { adminService } from '@/services/adminService'
import { errorMessage } from '@/services/apiClient'
import { syllabusCounts, type SyllabusCounts } from '@/services/syllabusService'
import type { ClassSubject, Member, SchoolClass, SubjectType } from '@/types'

const TYPE_LABEL: Record<SubjectType, string> = { THEORY: 'Theory', LAB: 'Lab', COACHING_TEST: 'Test series' }
const EMPTY_CLASS = { class_code: '', class_name: '', class_teacher_code: '', room_number: '', grade_number: '' }

/**
 * Admin: set up the academic structure — teachers → classes → subjects (with subject teachers) → chapters → sub-topics.
 * Left: class list. Right: the selected class with its subjects and the selected subject's syllabus.
 */
export function ClassesPanel({ org }: { org?: string | null }) {
  const [classes, setClasses] = useState<SchoolClass[] | null>(null)
  const [teachers, setTeachers] = useState<Member[]>([])
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_CLASS)
  const [showNew, setShowNew] = useState(false)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  const load = useCallback(async () => {
    try {
      const [c, t] = await Promise.all([adminService.classes(org), adminService.teachers(org)])
      setClasses(c); setTeachers(t.filter((x) => x.is_active))
      setSelected((cur) => (cur && c.some((x) => x.class_code === cur) ? cur : c.find((x) => x.is_active)?.class_code ?? c[0]?.class_code ?? null))
    } catch (e) { setError(errorMessage(e)) }
  }, [org])
  useEffect(() => { void load() }, [load])

  async function run(fn: () => Promise<unknown>) {
    setError(null)
    try { await fn(); await load(); return true } catch (e) { setError(errorMessage(e)); return false }
  }

  async function create(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const code = form.class_code.trim()
    const ok = await run(() => adminService.createClass({ ...form, class_code: code, class_teacher_code: form.class_teacher_code || null, room_number: form.room_number || null, grade_number: form.grade_number ? Number(form.grade_number) : null }, org))
    if (ok) { setForm(EMPTY_CLASS); setShowNew(false); setSelected(code) }
    setBusy(false)
  }

  const list = (classes ?? []).filter((c) => (showArchived || c.is_active) &&
    (!query || `${c.class_name} ${c.class_code}`.toLowerCase().includes(query.toLowerCase())))
  const current = classes?.find((c) => c.class_code === selected) ?? null
  const withSubjects = classes?.filter((c) => c.is_active && c.subjects.length > 0).length ?? 0
  const steps = [
    { n: 1, label: 'Add teachers', done: teachers.length > 0, hint: `${teachers.length} active`, to: adminTabLink('teachers') },
    { n: 2, label: 'Create classes', done: (classes?.length ?? 0) > 0, hint: `${classes?.filter((c) => c.is_active).length ?? 0} classes` },
    { n: 3, label: 'Add subjects & teachers', done: withSubjects > 0, hint: `${withSubjects} class(es) with subjects` },
    { n: 4, label: 'Chapters & sub-topics', done: false, hint: 'Per subject syllabus' },
  ]

  return (
    <div className="space-y-6">
      <ol aria-label="Setup steps" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((s) => {
          const body = (
            <div className={cn('flex h-full items-center gap-3 rounded-xl border p-3', s.done ? 'border-ok/30 bg-ok/5' : 'border-line bg-ink-900')}>
              <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold', s.done ? 'bg-ok text-white' : 'bg-brand-500/10 text-brand-600')}>
                {s.done ? <CheckCircle2 className="h-4 w-4" /> : s.n}
              </span>
              <div className="min-w-0"><div className="text-sm font-medium text-fg">{s.label}</div><div className="text-xs text-ink-500">{s.hint}</div></div>
            </div>
          )
          return <li key={s.n}>{s.to ? <Link to={s.to} className="block h-full">{body}</Link> : body}</li>
        })}
      </ol>

      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      {showNew && (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div><CardTitle>New class / section / batch</CardTitle><CardDescription>The class teacher is the only teacher who can enrol students into this class.</CardDescription></div>
            <Button size="icon" variant="ghost" aria-label="Close" onClick={() => setShowNew(false)}><X className="h-4 w-4" /></Button>
          </CardHeader>
          <CardContent>
            <form onSubmit={create} className="grid gap-3 sm:grid-cols-[1fr_1.3fr_0.8fr_1.3fr_0.7fr_auto] sm:items-end">
              <div><Label htmlFor="c-code">Class code</Label><Input id="c-code" required autoFocus placeholder="Grade-8-C" value={form.class_code} onChange={(e) => setForm({ ...form, class_code: e.target.value })} pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,63}" /></div>
              <div><Label htmlFor="c-name">Display name</Label><Input id="c-name" required minLength={2} placeholder="Grade 8 — Section C" value={form.class_name} onChange={(e) => setForm({ ...form, class_name: e.target.value })} /></div>
              <div><Label htmlFor="c-grade">Grade</Label>
                <Select id="c-grade" value={form.grade_number} onChange={(e) => setForm({ ...form, grade_number: e.target.value })}>
                  <option value="">—</option>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>Class {i + 1}</option>)}
                </Select>
              </div>
              <div><Label htmlFor="c-teacher">Class teacher</Label>
                <Select id="c-teacher" value={form.class_teacher_code} onChange={(e) => setForm({ ...form, class_teacher_code: e.target.value })}>
                  <option value="">— Assign later —</option>
                  {teachers.map((t) => <option key={t.user_code} value={t.user_code}>{t.full_name} ({t.user_code})</option>)}
                </Select>
              </div>
              <div><Label htmlFor="c-room">Room</Label><Input id="c-room" placeholder="Room-204" value={form.room_number} onChange={(e) => setForm({ ...form, room_number: e.target.value })} maxLength={32} /></div>
              <Button type="submit" disabled={busy} id="create-class">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <Card className="h-fit lg:sticky lg:top-4">
          <div className="space-y-3 border-b border-line p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-base font-semibold text-fg">Classes {classes && <span className="text-ink-500">({classes.filter((c) => c.is_active).length})</span>}</h2>
              <Button size="sm" onClick={() => setShowNew(true)} id="new-class"><Plus className="h-3.5 w-3.5" /> New class</Button>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-500" />
              <Input aria-label="Search classes" className="h-9 pl-8 text-sm" placeholder="Search classes" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-2">
            {!classes ? <div className="skeleton h-40" /> : list.length === 0 ? (
              <p className="p-4 text-center text-sm text-ink-300"><GraduationCap className="mx-auto mb-2 h-7 w-7 text-ink-500" />{classes.length ? 'No matching classes.' : 'No classes yet — create the first one.'}</p>
            ) : (
              <ul className="space-y-1">
                {list.map((c) => (
                  <li key={c.class_code}>
                    <button onClick={() => setSelected(c.class_code)} aria-current={c.class_code === selected ? 'true' : undefined}
                      className={cn('flex w-full cursor-pointer items-center gap-2.5 rounded-xl p-2.5 text-left transition-colors',
                        c.class_code === selected ? 'bg-brand-500/10 ring-1 ring-brand-400/30' : 'hover:bg-ink-800', !c.is_active && 'opacity-60')}>
                      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', c.class_code === selected ? 'bg-brand-500 text-white' : 'bg-ink-800 text-ink-300')}><School className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-fg">{c.class_name}</span>
                        <span className="block truncate text-xs text-ink-500">{c.subjects.length} subject{c.subjects.length === 1 ? '' : 's'} · {c.student_count} students{!c.is_active ? ' · archived' : ''}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {classes?.some((c) => !c.is_active) && (
            <label className="flex items-center gap-2 border-t border-line px-3 py-2 text-xs text-ink-300">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived classes
            </label>
          )}
        </Card>

        {!classes ? <div className="skeleton h-96" /> : !current ? (
          <Card className="grid place-items-center p-10 text-center text-sm text-ink-300">
            <div><School className="mx-auto mb-2 h-8 w-8 text-ink-500" />Create a class to add its subjects, chapters and sub-topics.
              <div className="mt-3"><Button size="sm" onClick={() => setShowNew(true)}><Plus className="h-3.5 w-3.5" /> New class</Button></div></div>
          </Card>
        ) : (
          <ClassDetail key={current.class_code} c={current} classes={classes} teachers={teachers} run={run} org={org} />
        )}
      </div>
    </div>
  )
}

function ClassDetail({ c, classes, teachers, run, org }: {
  c: SchoolClass; classes: SchoolClass[]; teachers: Member[]; run: (fn: () => Promise<unknown>) => Promise<boolean>; org?: string | null
}) {
  const [editing, setEditing] = useState(false)
  const [info, setInfo] = useState({ class_name: c.class_name, room_number: c.room_number ?? '', grade_number: c.grade_number ? String(c.grade_number) : '' })
  const [sub, setSub] = useState({ subject_code: '', subject_name: '', teacher_code: '', subject_type: 'THEORY' as SubjectType })
  const [active, setActive] = useState<string | null>(c.subjects[0]?.subject_code ?? null)
  const [counts, setCounts] = useState<SyllabusCounts>({})
  const tOptions = teachers.map((t) => <option key={t.user_code} value={t.user_code}>{t.full_name}</option>)
  const save = (patch: Partial<{ class_name: string; class_teacher_code: string | null; is_active: boolean; room_number: string | null; grade_number: number | null }>) =>
    run(() => adminService.updateClass(c.class_code, { class_name: c.class_name, class_teacher_code: c.class_teacher_code, is_active: c.is_active, room_number: c.room_number ?? null, grade_number: c.grade_number ?? null, ...patch }, org))

  useEffect(() => { syllabusCounts(c.class_code, org).then(setCounts).catch(() => setCounts({})) }, [c.class_code, org])
  const activeSubject = c.subjects.find((s) => s.subject_code === active) ?? null

  async function addSubject(e: FormEvent) {
    e.preventDefault()
    const code = sub.subject_code.trim()
    const ok = await run(() => adminService.setClassSubject(c.class_code, code, { subject_name: sub.subject_name.trim(), teacher_code: sub.teacher_code || null, subject_type: sub.subject_type }, org))
    if (ok) { setSub({ subject_code: '', subject_name: '', teacher_code: '', subject_type: 'THEORY' }); setActive(code) }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          {editing ? (
            <form className="grid gap-3 sm:grid-cols-[1.5fr_0.8fr_1fr_auto] sm:items-end"
              onSubmit={async (e) => { e.preventDefault(); if (await save({ class_name: info.class_name.trim(), room_number: info.room_number.trim() || null, grade_number: info.grade_number ? Number(info.grade_number) : null })) setEditing(false) }}>
              <div><Label htmlFor="e-name">Display name</Label><Input id="e-name" required minLength={2} autoFocus value={info.class_name} onChange={(e) => setInfo({ ...info, class_name: e.target.value })} /></div>
              <div><Label htmlFor="e-grade">Grade</Label>
                <Select id="e-grade" value={info.grade_number} onChange={(e) => setInfo({ ...info, grade_number: e.target.value })}>
                  <option value="">Not set</option>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>Class {i + 1}</option>)}
                </Select>
              </div>
              <div><Label htmlFor="e-room">Room</Label><Input id="e-room" maxLength={32} value={info.room_number} onChange={(e) => setInfo({ ...info, room_number: e.target.value })} /></div>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                <Button type="submit"><Check className="h-4 w-4" /> Save</Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-xl">{c.class_name}{!c.is_active && <Badge tone="neutral">Archived</Badge>}</CardTitle>
                <CardDescription><span className="font-mono">{c.class_code}</span>{c.grade_number ? ` · Class ${c.grade_number}` : ''} · {c.year_code} {c.cycle_code}{c.room_number ? ` · ${c.room_number}` : ''}</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="aqua"><Users className="h-3 w-3" /> {c.student_count} students</Badge>
                <Button size="sm" variant="secondary" onClick={() => { setInfo({ class_name: c.class_name, room_number: c.room_number ?? '', grade_number: c.grade_number ? String(c.grade_number) : '' }); setEditing(true) }}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                <Button size="sm" variant="secondary" onClick={() => save({ is_active: !c.is_active })}>
                  {c.is_active ? <><Archive className="h-3.5 w-3.5" /> Archive</> : <><RotateCcw className="h-3.5 w-3.5" /> Restore</>}
                </Button>
              </div>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="max-w-md">
            <Label htmlFor={`ct-${c.class_code}`}>Class teacher</Label>
            <Select id={`ct-${c.class_code}`} value={c.class_teacher_code ?? ''} onChange={(e) => save({ class_teacher_code: e.target.value || null })}>
              <option value="">— Not assigned —</option>{tOptions}
            </Select>
            <p className="mt-1 text-xs text-ink-500">Enrols students and can mark attendance for every subject of this class.</p>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Subjects, teachers & syllabus</h3>
              <span className="text-xs text-ink-500">{c.subjects.length} subject{c.subjects.length === 1 ? '' : 's'}</span>
            </div>
            <div className="overflow-hidden rounded-xl border border-line">
              {c.subjects.length === 0 && <p className="p-4 text-sm text-ink-500">No subjects yet — add the first one below.</p>}
              <ul className="divide-y divide-line">
                {c.subjects.map((s) => (
                  <SubjectRow key={s.subject_code} s={s} active={s.subject_code === active} count={counts[s.subject_code]} tOptions={tOptions}
                    onSelect={() => setActive(s.subject_code)}
                    onSave={(body) => run(() => adminService.setClassSubject(c.class_code, s.subject_code, body, org))}
                    onRemove={() => { if (confirm(`Remove ${s.subject_name} from ${c.class_name}? Attendance and the syllabus are kept and come back if you add it again.`)) { void run(() => adminService.removeClassSubject(c.class_code, s.subject_code, org)).then((ok) => ok && active === s.subject_code && setActive(null)) } }} />
                ))}
              </ul>
            </div>
            <form className="mt-3 grid gap-2 rounded-xl border border-dashed border-line p-3 sm:grid-cols-[1fr_1.3fr_0.9fr_1.3fr_auto]" onSubmit={addSubject}>
              <Input aria-label="Subject code" required placeholder="PHY101" value={sub.subject_code} onChange={(e) => setSub({ ...sub, subject_code: e.target.value })} pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,63}" title="Letters, digits, . _ - (no spaces)" />
              <Input aria-label="Subject name" required minLength={2} placeholder="Physics" value={sub.subject_name} onChange={(e) => setSub({ ...sub, subject_name: e.target.value })} />
              <Select aria-label="Subject type" value={sub.subject_type} onChange={(e) => setSub({ ...sub, subject_type: e.target.value as SubjectType })}>
                {(Object.keys(TYPE_LABEL) as SubjectType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </Select>
              <Select aria-label="Subject teacher" value={sub.teacher_code} onChange={(e) => setSub({ ...sub, teacher_code: e.target.value })}>
                <option value="">— Teacher —</option>{tOptions}
              </Select>
              <Button type="submit" variant="outline" id="add-subject"><BookPlus className="h-4 w-4" /> Add subject</Button>
            </form>
          </div>
        </CardContent>
      </Card>

      {activeSubject ? (
        <SyllabusEditor key={`${c.class_code}-${activeSubject.subject_code}`} classCode={c.class_code} subject={activeSubject} org={org}
          copySources={classes.filter((x) => x.class_code !== c.class_code && x.subjects.some((s) => s.subject_code === activeSubject.subject_code))}
          onChanged={(syl) => setCounts((m) => ({ ...m, [syl.subject_code]: { chapters: syl.chapter_count, topics: syl.topic_count } }))} />
      ) : c.subjects.length > 0 && (
        <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-ink-300"><BookOpen className="mx-auto mb-2 h-6 w-6 text-ink-500" />Choose <b>Syllabus</b> on a subject to add its chapters and sub-topics.</p>
      )}
    </div>
  )
}

function SubjectRow({ s, active, count, tOptions, onSelect, onSave, onRemove }: {
  s: ClassSubject; active: boolean; count?: { chapters: number; topics: number }; tOptions: React.ReactNode
  onSelect: () => void; onSave: (body: { subject_name: string; teacher_code: string | null; subject_type?: SubjectType }) => Promise<boolean>; onRemove: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ subject_name: s.subject_name, subject_type: s.subject_type ?? 'THEORY' })
  const type = s.subject_type ?? 'THEORY'

  if (editing) {
    return (
      <li className="bg-ink-800/50 p-3">
        <form className="grid gap-2 sm:grid-cols-[1.4fr_1fr_auto] sm:items-end"
          onSubmit={async (e) => { e.preventDefault(); if (await onSave({ subject_name: form.subject_name.trim(), subject_type: form.subject_type, teacher_code: s.teacher_code })) setEditing(false) }}>
          <div><Label htmlFor={`sn-${s.subject_code}`}>Subject name ({s.subject_code})</Label><Input id={`sn-${s.subject_code}`} required minLength={2} autoFocus value={form.subject_name} onChange={(e) => setForm({ ...form, subject_name: e.target.value })} /></div>
          <div><Label htmlFor={`st-${s.subject_code}`}>Type</Label>
            <Select id={`st-${s.subject_code}`} value={form.subject_type} onChange={(e) => setForm({ ...form, subject_type: e.target.value as SubjectType })}>
              {(Object.keys(TYPE_LABEL) as SubjectType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </Select>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" className="h-10" onClick={() => setEditing(false)}>Cancel</Button>
            <Button type="submit" size="sm" className="h-10"><Check className="h-3.5 w-3.5" /> Save</Button>
          </div>
        </form>
      </li>
    )
  }

  return (
    <li className={cn('flex flex-wrap items-center gap-3 p-3 transition-colors', active && 'bg-brand-500/[0.05]')}>
      <div className="min-w-40 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium text-fg">{s.subject_name}<Badge tone="neutral" className="!text-[10px]">{TYPE_LABEL[type]}</Badge></div>
        <div className="text-xs text-ink-500"><span className="font-mono">{s.subject_code}</span> · {count ? `${count.chapters} chapters · ${count.topics} sub-topics` : 'No syllabus yet'}</div>
      </div>
      <div className="flex items-center gap-1.5">
        <UserRound className="h-4 w-4 text-ink-500" />
        <Select aria-label={`Teacher for ${s.subject_name}`} className="h-9 w-44"
          value={s.teacher_code ?? ''} onChange={(e) => void onSave({ subject_name: s.subject_name, teacher_code: e.target.value || null, subject_type: type })}>
          <option value="">— No teacher —</option>{tOptions}
        </Select>
      </div>
      <div className="flex items-center gap-1">
        <Button size="sm" variant={active ? 'default' : 'secondary'} onClick={onSelect} aria-pressed={active}><BookOpen className="h-3.5 w-3.5" /> Syllabus</Button>
        <Button size="icon" variant="ghost" aria-label={`Edit ${s.subject_name}`} onClick={() => { setForm({ subject_name: s.subject_name, subject_type: type }); setEditing(true) }}><Pencil className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" aria-label={`Remove ${s.subject_name}`} onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>
      </div>
    </li>
  )
}
