import { useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Input, Label, Select } from '@/components/ui/field'
import { cn } from '@/lib/utils'
import { DEFAULT_CONTENT_TYPE, type ContentType, type DikshaFilterOptions, type DikshaQuery, type FacetOption } from '@/services/dikshaService'

const n = (o: FacetOption<string | number>) => (o.count !== undefined ? ` (${o.count})` : '')

export function BoardSelector({ options, value, onChange }: { options: FacetOption[]; value: string; onChange: (v: string) => void }) {
  return (
    <div><Label htmlFor="dk-board">Board</Label>
      <Select id="dk-board" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All supported boards</option>
        {options.map((o) => <option key={o.value} value={o.value} disabled={o.count === 0}>{o.label}{n(o)}</option>)}
      </Select>
    </div>
  )
}

export function ClassSelector({ options, value, onChange }: { options: FacetOption<number>[]; value: number | ''; onChange: (v: number | '') => void }) {
  return (
    <div><Label htmlFor="dk-class">Class</Label>
      <Select id="dk-class" value={value} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}>
        <option value="">Classes 5–12</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}{n(o)}</option>)}
      </Select>
    </div>
  )
}

/** Only subjects that have content of the chosen type are offered (facet values with no content are dropped). */
export function SubjectSelector({ options, value, onChange, busy }: { options: FacetOption[]; value: string; onChange: (v: string) => void; busy?: boolean }) {
  const shown = options.filter((o) => o.count === undefined || o.count > 0)
  return (
    <div><Label htmlFor="dk-subject">Subject</Label>
      <Select id="dk-subject" value={value} onChange={(e) => onChange(e.target.value)} disabled={busy || !shown.length}>
        <option value="">{shown.length ? 'All subjects' : 'No subjects for this type'}</option>
        {shown.map((o) => <option key={o.value} value={o.value}>{o.label}{n(o)}</option>)}
      </Select>
    </div>
  )
}

export function LanguageSelector({ options, value, onChange }: { options: FacetOption[]; value: string; onChange: (v: string) => void }) {
  return (
    <div><Label htmlFor="dk-medium">Language / medium</Label>
      <Select id="dk-medium" value={value} onChange={(e) => onChange(e.target.value)} disabled={!options.length}>
        <option value="">All languages</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}{n(o)}</option>)}
      </Select>
    </div>
  )
}

/** Content type first: it decides which subjects (and languages) are offered. Types with nothing to show are disabled. */
export function ResourceTypeSelector({ options, value, onChange }: { options: FacetOption<ContentType>[]; value: ContentType; onChange: (v: ContentType) => void }) {
  return (
    <div><Label htmlFor="dk-type">Content type</Label>
      <Select id="dk-type" value={value} onChange={(e) => onChange(e.target.value as ContentType)}>
        {options.map((o) => <option key={o.value} value={o.value} disabled={o.count === 0 && o.value !== value}>{o.label}{n(o)}</option>)}
      </Select>
    </div>
  )
}

const TYPE_FALLBACK: FacetOption<ContentType>[] = [
  { value: 'textbook', label: 'Textbooks' }, { value: 'video', label: 'Videos' }, { value: 'document', label: 'Documents (PDF)' },
  { value: 'interactive', label: 'Interactive' }, { value: 'audio', label: 'Audio' },
]

export function ResourceSearch({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
  const [q, setQ] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  return (
    <div><Label htmlFor="dk-q">Search</Label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
        <Input id="dk-q" type="search" className="pl-9" placeholder="Title or keywords" value={q} maxLength={100}
          onChange={(e) => { const v = e.target.value; setQ(v); clearTimeout(timer.current); timer.current = setTimeout(() => onSearch(v), 400) }} />
      </div>
    </div>
  )
}

/**
 * Filter bar for the catalogue. Every value comes from the source's facets for the current selection, counting only
 * what opens inside the app. Order follows the dependencies: (board → class →) content type → subject → language.
 * Changing a type or subject keeps the dependent choices only while they still have content (see DikshaBrowser).
 *
 * `lockBoardClass` hides Board and Class: the teacher's view, where both already follow the admin-set board and
 * grade of the class they are publishing for (see Admin console → Classes & subjects).
 */
export function DikshaFilters({ options, value, onChange, lockBoardClass, busy }: {
  options: DikshaFilterOptions | null; value: DikshaQuery; onChange: (q: DikshaQuery) => void; lockBoardClass?: boolean
  /** Filter options for a new selection are loading. */
  busy?: boolean
}) {
  const [resetKey, setResetKey] = useState(0)
  const set = (patch: DikshaQuery) => onChange({ ...value, ...patch, page: 1 })
  const type = value.content_type ?? DEFAULT_CONTENT_TYPE
  const active = !!((!lockBoardClass && (value.board || value.class_number)) || value.subject || value.medium || value.q || type !== DEFAULT_CONTENT_TYPE)
  function clear() {
    setResetKey((k) => k + 1)
    onChange({ content_type: DEFAULT_CONTENT_TYPE, page: 1, ...(lockBoardClass ? { board: value.board, class_number: value.class_number } : {}) })
  }
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2 lg:items-end', lockBoardClass ? 'lg:grid-cols-[1.1fr_1fr_1fr_1.3fr_auto]' : 'lg:grid-cols-[1.1fr_0.8fr_1.1fr_1fr_1fr_1.3fr_auto]')}>
      {!lockBoardClass && (
        <>
          <BoardSelector options={options?.boards ?? []} value={value.board ?? ''} onChange={(board) => set({ board, subject: '', medium: '' })} />
          <ClassSelector options={options?.classes ?? []} value={value.class_number ?? ''} onChange={(class_number) => set({ class_number, subject: '' })} />
        </>
      )}
      <ResourceTypeSelector options={options?.content_types ?? TYPE_FALLBACK} value={type} onChange={(content_type) => set({ content_type })} />
      <SubjectSelector options={options?.subjects ?? []} value={value.subject ?? ''} onChange={(subject) => set({ subject })} busy={busy} />
      <LanguageSelector options={options?.mediums ?? []} value={value.medium ?? ''} onChange={(medium) => set({ medium })} />
      <ResourceSearch key={resetKey} value={value.q ?? ''} onSearch={(q) => set({ q })} />
      <button type="button" disabled={!active} onClick={clear}
        className="inline-flex h-10 cursor-pointer items-center gap-1 rounded-xl px-3 text-sm text-ink-300 hover:bg-ink-800 hover:text-fg disabled:cursor-default disabled:opacity-40">
        <X className="h-4 w-4" /> Clear
      </button>
    </div>
  )
}
