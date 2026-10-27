import { useRef, useState } from 'react'
import { BookX, Search, X } from 'lucide-react'
import { Input, Label, Select } from '@/components/ui/field'
import type { BookFilters, LibraryMeta } from '@/services/libraryService'

/** Board / class / subject / language / title filters (FRD §6.1). Search is debounced. */
export function LibraryFilters({ meta, value, onChange, subjects, extra }: {
  meta: LibraryMeta | null
  value: BookFilters
  onChange: (f: BookFilters) => void
  subjects: string[]
  extra?: React.ReactNode
}) {
  const [q, setQ] = useState(value.q ?? '')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  function onSearch(v: string) {
    setQ(v)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => onChange({ ...value, q: v }), 350)
  }
  const set = (patch: BookFilters) => onChange({ ...value, ...patch })
  const active = !!(value.board || value.class_number || value.subject || value.language || value.q)

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_0.7fr_1fr_0.8fr_1.4fr_auto] lg:items-end">
      {extra}
      <div><Label htmlFor="lf-board">Board</Label>
        <Select id="lf-board" value={value.board ?? ''} onChange={(e) => set({ board: e.target.value, subject: '' })}>
          <option value="">All boards</option>
          {meta?.boards.map((b) => <option key={b.code} value={b.code}>{b.label}</option>)}
        </Select>
      </div>
      <div><Label htmlFor="lf-class">Class</Label>
        <Select id="lf-class" value={value.class_number ?? ''} onChange={(e) => set({ class_number: e.target.value ? Number(e.target.value) : '', subject: '' })}>
          <option value="">All</option>
          {meta?.classes.map((c) => <option key={c} value={c}>Class {c}</option>)}
        </Select>
      </div>
      <div><Label htmlFor="lf-subject">Subject</Label>
        <Select id="lf-subject" value={value.subject ?? ''} onChange={(e) => set({ subject: e.target.value })}>
          <option value="">All subjects</option>
          {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </div>
      <div><Label htmlFor="lf-lang">Language</Label>
        <Select id="lf-lang" value={value.language ?? ''} onChange={(e) => set({ language: e.target.value })}>
          <option value="">All</option>
          {meta?.languages.map((l) => <option key={l} value={l}>{l}</option>)}
        </Select>
      </div>
      <div><Label htmlFor="lf-q">Search by title</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
          <Input id="lf-q" type="search" className="pl-9" placeholder="Book title, subject or publisher" value={q} maxLength={100} onChange={(e) => onSearch(e.target.value)} />
        </div>
      </div>
      <button type="button" disabled={!active} onClick={() => { clearTimeout(timer.current); setQ(''); onChange({}) }}
        className="inline-flex h-10 cursor-pointer items-center gap-1 rounded-xl px-3 text-sm text-ink-300 hover:bg-ink-800 hover:text-fg disabled:cursor-default disabled:opacity-40">
        <X className="h-4 w-4" /> Clear
      </button>
    </div>
  )
}

export function LibraryEmpty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-line bg-ink-900 px-6 py-14 text-center">
      <div className="max-w-md">
        <BookX className="mx-auto mb-3 h-10 w-10 text-ink-500" />
        <p className="font-display text-base font-semibold text-fg">{title}</p>
        {children && <div className="mt-1 text-sm text-ink-300">{children}</div>}
      </div>
    </div>
  )
}
