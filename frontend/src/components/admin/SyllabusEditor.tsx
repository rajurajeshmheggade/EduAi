import { useEffect, useState, type FormEvent } from 'react'
import {
  ArrowDown, ArrowUp, BookOpen, Check, ChevronDown, ChevronRight, ClipboardPaste, Copy, ListPlus, Loader2, Pencil, Plus, Trash2, X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Label, Select, Textarea } from '@/components/ui/field'
import { errorMessage } from '@/services/apiClient'
import { syllabusApi, type Syllabus, type SyllabusChapter } from '@/services/syllabusService'
import { cn } from '@/lib/utils'

const EXAMPLE = `Chapter 1: Motion
  - Distance and displacement
  - Speed and velocity
2. Force and laws of motion
  - Newton's first law
  - Inertia and mass`

/** Admin: chapters and their sub-topics for one class subject. */
export function SyllabusEditor({ classCode, subject, org, copySources, onChanged }: {
  classCode: string
  subject: { subject_code: string; subject_name: string }
  org?: string | null
  /** Other classes that also have this subject code (copy source candidates). */
  copySources: { class_code: string; class_name: string }[]
  onChanged: (s: Syllabus) => void
}) {
  const sapi = syllabusApi(classCode, subject.subject_code, org)
  const [syl, setSyl] = useState<Syllabus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [newChapter, setNewChapter] = useState('')
  const [tool, setTool] = useState<'none' | 'paste' | 'copy'>('none')

  useEffect(() => {
    syllabusApi(classCode, subject.subject_code, org).get().then(setSyl).catch((e) => setError(errorMessage(e)))
  }, [classCode, subject.subject_code, org])

  async function act(fn: () => Promise<Syllabus>, after?: (s: Syllabus) => void) {
    setBusy(true); setError(null)
    try { const s = await fn(); setSyl(s); onChanged(s); after?.(s); return true } catch (e) { setError(errorMessage(e)); return false } finally { setBusy(false) }
  }

  function addChapter(e: FormEvent) {
    e.preventDefault()
    const title = newChapter.trim()
    if (!title) return
    void act(() => sapi.addChapter({ title }), (s) => { setNewChapter(''); const last = s.chapters.at(-1); if (last) setOpen((o) => ({ ...o, [last.chapter_id]: true })) })
  }

  const allOpen = !!syl?.chapters.length && syl.chapters.every((c) => open[c.chapter_id])

  return (
    <section aria-labelledby="syl-h" className="rounded-2xl border border-brand-400/40 bg-brand-500/[0.03] p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="syl-h" className="flex items-center gap-2 font-display text-base font-semibold text-fg"><BookOpen className="h-5 w-5 text-brand-600" /> Syllabus · {subject.subject_name}</h3>
          <p className="text-xs text-ink-500"><span className="font-mono">{subject.subject_code}</span> · {syl ? `${syl.chapter_count} chapter${syl.chapter_count === 1 ? '' : 's'} · ${syl.topic_count} sub-topic${syl.topic_count === 1 ? '' : 's'}` : 'Loading…'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={tool === 'paste' ? 'default' : 'secondary'} onClick={() => setTool(tool === 'paste' ? 'none' : 'paste')}><ClipboardPaste className="h-3.5 w-3.5" /> Paste outline</Button>
          <Button size="sm" variant={tool === 'copy' ? 'default' : 'secondary'} disabled={!copySources.length} title={copySources.length ? undefined : 'No other class has this subject'}
            onClick={() => setTool(tool === 'copy' ? 'none' : 'copy')}><Copy className="h-3.5 w-3.5" /> Copy from class</Button>
          {!!syl?.chapters.length && (
            <Button size="sm" variant="ghost" onClick={() => setOpen(allOpen ? {} : Object.fromEntries(syl.chapters.map((c) => [c.chapter_id, true])))}>
              {allOpen ? 'Collapse all' : 'Expand all'}
            </Button>
          )}
        </div>
      </div>

      {tool === 'paste' && <PasteOutline busy={busy} hasChapters={!!syl?.chapter_count} onImport={(text, mode) => act(() => sapi.importText(text, mode), () => setTool('none'))} />}
      {tool === 'copy' && <CopyFrom busy={busy} sources={copySources} hasChapters={!!syl?.chapter_count} onCopy={(from, mode) => act(() => sapi.copyFrom(from, mode), () => setTool('none'))} />}

      {error && <p role="alert" className="mt-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      <div className="mt-4 space-y-2">
        {!syl ? <div className="skeleton h-24" /> : syl.chapters.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-ink-300">
            <BookOpen className="mx-auto mb-2 h-7 w-7 text-ink-500" />
            No chapters yet. Add the first chapter below, or use <b>Paste outline</b> to add a whole syllabus at once.
          </div>
        ) : syl.chapters.map((c, i) => (
          <ChapterRow key={c.chapter_id} c={c} first={i === 0} last={i === syl.chapters.length - 1} busy={busy}
            open={!!open[c.chapter_id]} onToggle={() => setOpen((o) => ({ ...o, [c.chapter_id]: !o[c.chapter_id] }))}
            onSave={(title, description) => act(() => sapi.updateChapter(c.chapter_id, { title, description }))}
            onMove={(d) => act(() => sapi.moveChapter(c.chapter_id, d))}
            onDelete={() => { if (confirm(`Delete chapter ${c.number} “${c.title}” and its ${c.topics.length} sub-topic(s)?`)) void act(() => sapi.deleteChapter(c.chapter_id)) }}
            onAddTopics={(titles) => act(() => sapi.addTopics(c.chapter_id, titles))}
            onSaveTopic={(id, title) => act(() => sapi.updateTopic(id, title))}
            onMoveTopic={(id, d) => act(() => sapi.moveTopic(id, d))}
            onDeleteTopic={(id) => act(() => sapi.deleteTopic(id))} />
        ))}
      </div>

      <form onSubmit={addChapter} className="mt-3 flex gap-2">
        <Input aria-label="New chapter title" id="new-chapter" placeholder={`Chapter ${(syl?.chapter_count ?? 0) + 1} title, e.g. “Motion”`} value={newChapter} maxLength={300} onChange={(e) => setNewChapter(e.target.value)} />
        <Button type="submit" disabled={busy || !newChapter.trim()} id="add-chapter">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add chapter</Button>
      </form>
    </section>
  )
}

function ChapterRow({ c, first, last, busy, open, onToggle, onSave, onMove, onDelete, onAddTopics, onSaveTopic, onMoveTopic, onDeleteTopic }: {
  c: SyllabusChapter; first: boolean; last: boolean; busy: boolean; open: boolean; onToggle: () => void
  onSave: (title: string, description: string | null) => Promise<boolean>; onMove: (d: 'up' | 'down') => void; onDelete: () => void
  onAddTopics: (titles: string[]) => Promise<boolean>; onSaveTopic: (id: string, title: string) => Promise<boolean>
  onMoveTopic: (id: string, d: 'up' | 'down') => void; onDeleteTopic: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(c.title)
  const [desc, setDesc] = useState(c.description ?? '')
  const [topic, setTopic] = useState('')

  async function save(e: FormEvent) {
    e.preventDefault()
    if (await onSave(title.trim(), desc.trim() || null)) setEditing(false)
  }
  async function addTopic(e: FormEvent) {
    e.preventDefault()
    // Pasting several lines adds one sub-topic per line.
    const titles = topic.split('\n').map((t) => t.replace(/^\s*[-*•–]\s*/, '').trim()).filter(Boolean)
    if (titles.length && await onAddTopics(titles)) setTopic('')
  }

  return (
    <div className={cn('rounded-xl border bg-ink-900 transition-colors', open ? 'border-brand-400/50' : 'border-line')}>
      {editing ? (
        <form onSubmit={save} className="space-y-2 p-3">
          <div className="flex items-center gap-2">
            <Badge tone="brand">Ch {c.number}</Badge>
            <Input aria-label="Chapter title" autoFocus required maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <Textarea aria-label="Chapter description" rows={2} maxLength={2000} placeholder="Learning outcomes or notes (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => { setEditing(false); setTitle(c.title); setDesc(c.description ?? '') }}><X className="h-3.5 w-3.5" /> Cancel</Button>
            <Button type="submit" size="sm" disabled={busy}><Check className="h-3.5 w-3.5" /> Save</Button>
          </div>
        </form>
      ) : (
        <div className="flex items-center gap-2 p-2.5">
          <button onClick={onToggle} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} sub-topics of ${c.title}`} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left">
            {open ? <ChevronDown className="h-4 w-4 shrink-0 text-brand-600" /> : <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" />}
            <span className="grid h-7 min-w-9 place-items-center rounded-lg bg-brand-500/10 px-1.5 text-xs font-bold tabular-nums text-brand-600">Ch {c.number}</span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-fg">{c.title}</span>
              {c.description && <span className="block truncate text-xs text-ink-500">{c.description}</span>}
            </span>
          </button>
          <Badge tone="neutral">{c.topics.length} sub-topic{c.topics.length === 1 ? '' : 's'}</Badge>
          <IconBtn label="Move chapter up" disabled={first || busy} onClick={() => onMove('up')}><ArrowUp className="h-3.5 w-3.5" /></IconBtn>
          <IconBtn label="Move chapter down" disabled={last || busy} onClick={() => onMove('down')}><ArrowDown className="h-3.5 w-3.5" /></IconBtn>
          <IconBtn label="Edit chapter" onClick={() => { setTitle(c.title); setDesc(c.description ?? ''); setEditing(true) }}><Pencil className="h-3.5 w-3.5" /></IconBtn>
          <IconBtn label="Delete chapter" danger onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
        </div>
      )}

      {open && !editing && (
        <div className="border-t border-line px-3 pb-3 pt-2">
          {c.topics.length === 0 && <p className="py-1 pl-9 text-xs text-ink-500">No sub-topics yet.</p>}
          <ol className="space-y-1">
            {c.topics.map((t, i) => (
              <TopicRow key={t.topic_id} n={`${c.number}.${i + 1}`} title={t.title} first={i === 0} last={i === c.topics.length - 1} busy={busy}
                onSave={(title) => onSaveTopic(t.topic_id, title)} onMove={(d) => onMoveTopic(t.topic_id, d)}
                onDelete={() => { if (confirm(`Delete sub-topic “${t.title}”?`)) onDeleteTopic(t.topic_id) }} />
            ))}
          </ol>
          <form onSubmit={addTopic} className="mt-2 flex items-start gap-2 pl-9">
            <Textarea aria-label={`New sub-topic for ${c.title}`} rows={1} className="min-h-9 text-sm" placeholder="Add a sub-topic (paste several lines to add many)"
              value={topic} onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} />
            <Button type="submit" size="sm" variant="outline" className="h-9" disabled={busy || !topic.trim()}><ListPlus className="h-3.5 w-3.5" /> Add</Button>
          </form>
        </div>
      )}
    </div>
  )
}

function TopicRow({ n, title, first, last, busy, onSave, onMove, onDelete }: {
  n: string; title: string; first: boolean; last: boolean; busy: boolean
  onSave: (t: string) => Promise<boolean>; onMove: (d: 'up' | 'down') => void; onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(title)
  async function save(e: FormEvent) {
    e.preventDefault()
    if (value.trim() && await onSave(value.trim())) setEditing(false)
  }
  return (
    <li className="group flex items-center gap-2 rounded-lg py-1 pl-9 pr-1 hover:bg-ink-800">
      <span className="w-9 shrink-0 text-xs tabular-nums text-ink-500">{n}</span>
      {editing ? (
        <form onSubmit={save} className="flex flex-1 items-center gap-1.5">
          <Input aria-label="Sub-topic title" autoFocus required maxLength={300} className="h-8 text-sm" value={value} onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setEditing(false); setValue(title) } }} />
          <IconBtn label="Save sub-topic" submit><Check className="h-3.5 w-3.5" /></IconBtn>
          <IconBtn label="Cancel" onClick={() => { setEditing(false); setValue(title) }}><X className="h-3.5 w-3.5" /></IconBtn>
        </form>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-sm text-ink-100">{title}</span>
          <span className="flex opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <IconBtn label="Move sub-topic up" disabled={first || busy} onClick={() => onMove('up')}><ArrowUp className="h-3.5 w-3.5" /></IconBtn>
            <IconBtn label="Move sub-topic down" disabled={last || busy} onClick={() => onMove('down')}><ArrowDown className="h-3.5 w-3.5" /></IconBtn>
            <IconBtn label="Edit sub-topic" onClick={() => { setValue(title); setEditing(true) }}><Pencil className="h-3.5 w-3.5" /></IconBtn>
            <IconBtn label="Delete sub-topic" danger onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
          </span>
        </>
      )}
    </li>
  )
}

function PasteOutline({ busy, hasChapters, onImport }: { busy: boolean; hasChapters: boolean; onImport: (text: string, mode: 'append' | 'replace') => void }) {
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'append' | 'replace'>('append')
  return (
    <div className="mt-4 space-y-2 rounded-xl border border-line bg-ink-900 p-3">
      <Label htmlFor="syl-paste">Paste the syllabus outline</Label>
      <p className="text-xs text-ink-500">One chapter per line. Indent sub-topics, or start them with “-”, “•” or a number like 1.2.</p>
      <Textarea id="syl-paste" rows={7} className="font-mono text-xs" placeholder={EXAMPLE} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ModeToggle mode={mode} setMode={setMode} hasChapters={hasChapters} />
        <Button size="sm" disabled={busy || !text.trim()} onClick={() => { if (mode === 'append' || confirm('Replace the current syllabus with the pasted outline?')) onImport(text, mode) }}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardPaste className="h-3.5 w-3.5" />} Import
        </Button>
      </div>
    </div>
  )
}

function CopyFrom({ busy, sources, hasChapters, onCopy }: { busy: boolean; sources: { class_code: string; class_name: string }[]; hasChapters: boolean; onCopy: (from: string, mode: 'append' | 'replace') => void }) {
  const [from, setFrom] = useState(sources[0]?.class_code ?? '')
  const [mode, setMode] = useState<'append' | 'replace'>('replace')
  return (
    <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-ink-900 p-3">
      <div className="min-w-48 flex-1"><Label htmlFor="syl-copy">Copy chapters and sub-topics from</Label>
        <Select id="syl-copy" value={from} onChange={(e) => setFrom(e.target.value)}>
          {sources.map((s) => <option key={s.class_code} value={s.class_code}>{s.class_name} ({s.class_code})</option>)}
        </Select>
      </div>
      <ModeToggle mode={mode} setMode={setMode} hasChapters={hasChapters} />
      <Button size="sm" disabled={busy || !from} onClick={() => { if (mode === 'append' || !hasChapters || confirm('Replace the current syllabus with the copied one?')) onCopy(from, mode) }}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />} Copy
      </Button>
    </div>
  )
}

function ModeToggle({ mode, setMode, hasChapters }: { mode: 'append' | 'replace'; setMode: (m: 'append' | 'replace') => void; hasChapters: boolean }) {
  if (!hasChapters) return <span className="text-xs text-ink-500">The syllabus is empty, so chapters are simply added.</span>
  return (
    <div role="radiogroup" aria-label="Import mode" className="flex rounded-lg border border-line p-0.5 text-xs">
      {(['append', 'replace'] as const).map((m) => (
        <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
          className={cn('cursor-pointer rounded-md px-2.5 py-1', mode === m ? 'bg-brand-500/10 font-medium text-brand-600' : 'text-ink-300 hover:text-fg')}>
          {m === 'append' ? 'Add after existing' : 'Replace existing'}
        </button>
      ))}
    </div>
  )
}

function IconBtn({ label, onClick, disabled, danger, submit, children }: { label: string; onClick?: () => void; disabled?: boolean; danger?: boolean; submit?: boolean; children: React.ReactNode }) {
  return (
    <button type={submit ? 'submit' : 'button'} aria-label={label} title={label} onClick={onClick} disabled={disabled}
      className={cn('grid h-7 w-7 cursor-pointer place-items-center rounded-md text-ink-500 transition-colors disabled:cursor-not-allowed disabled:opacity-30',
        danger ? 'hover:bg-bad/10 hover:text-bad' : 'hover:bg-ink-800 hover:text-fg')}>
      {children}
    </button>
  )
}
