import { useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Input, Label, Select } from '@/components/ui/field'
import type { DikshaFilterOptions, DikshaQuery, FacetOption } from '@/services/dikshaService'

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

export function SubjectSelector({ options, value, onChange }: { options: FacetOption[]; value: string; onChange: (v: string) => void }) {
  return (
    <div><Label htmlFor="dk-subject">Subject</Label>
      <Select id="dk-subject" value={value} onChange={(e) => onChange(e.target.value)} disabled={!options.length}>
        <option value="">{options.length ? 'All subjects' : 'No subjects'}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}{n(o)}</option>)}
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

export function ResourceTypeSelector({ options, value, onChange }: { options: FacetOption[]; value: string; onChange: (v: string) => void }) {
  return (
    <div><Label htmlFor="dk-type">Content type</Label>
      <Select id="dk-type" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    </div>
  )
}

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

/** Filter bar for the DIKSHA catalog. Every value comes from DIKSHA facets for the current selection. */
export function DikshaFilters({ options, value, onChange }: { options: DikshaFilterOptions | null; value: DikshaQuery; onChange: (q: DikshaQuery) => void }) {
  const [resetKey, setResetKey] = useState(0)
  const set = (patch: DikshaQuery) => onChange({ ...value, ...patch, page: 1 })
  const active = !!(value.board || value.class_number || value.subject || value.medium || value.q || (value.content_type && value.content_type !== 'Digital Textbook'))
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.1fr_0.8fr_1.1fr_1fr_1fr_1.3fr_auto] lg:items-end">
      <BoardSelector options={options?.boards ?? []} value={value.board ?? ''} onChange={(board) => set({ board, subject: '', medium: '' })} />
      <ClassSelector options={options?.classes ?? []} value={value.class_number ?? ''} onChange={(class_number) => set({ class_number, subject: '' })} />
      <SubjectSelector options={options?.subjects ?? []} value={value.subject ?? ''} onChange={(subject) => set({ subject })} />
      <LanguageSelector options={options?.mediums ?? []} value={value.medium ?? ''} onChange={(medium) => set({ medium })} />
      <ResourceTypeSelector options={options?.content_types ?? [{ value: 'Digital Textbook', label: 'Digital Textbook' }]}
        value={value.content_type ?? 'Digital Textbook'} onChange={(content_type) => set({ content_type, subject: '' })} />
      <ResourceSearch key={resetKey} value={value.q ?? ''} onSearch={(q) => set({ q })} />
      <button type="button" disabled={!active} onClick={() => { setResetKey((k) => k + 1); onChange({ content_type: 'Digital Textbook', page: 1 }) }}
        className="inline-flex h-10 cursor-pointer items-center gap-1 rounded-xl px-3 text-sm text-ink-300 hover:bg-ink-800 hover:text-fg disabled:cursor-default disabled:opacity-40">
        <X className="h-4 w-4" /> Clear
      </button>
    </div>
  )
}
