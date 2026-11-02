import { useEffect, useMemo, useState } from 'react'
import { ListPlus, Search, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Label, Select } from '@/components/ui/field'
import { ErrorState, SkeletonPage } from '@/components/ui/loading'
import { toast } from '@/components/ui/toast'
import { useAsync } from '@/lib/useAsync'
import { errorMessage } from '@/services/apiClient'
import { questionGenService } from '@/services/questionGenService'
import type { BankItem, Lang, MediaInfo, QgenMeta, QType } from '@/types/questionGen'
import { renderCtx } from '@/lib/questionGen/render'
import { QuestionBadges, QuestionView } from './shared'

/* The question bank: the teacher's own saved questions plus those colleagues shared with the school. Search by text
   (question and answer), type, difficulty, Bloom level and content-repository subject; reuse in a paper or delete. */

const PAGE = 20

export function BankPanel({ meta, defaultSubject, onAdd }: {
  meta: QgenMeta
  /** Pre-filter on the paper's content-repository subject. */
  defaultSubject?: string | null
  /** Picker mode (inside a paper): adds the selected questions. */
  onAdd?: (bankIds: string[]) => Promise<void>
}) {
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const [qtype, setQtype] = useState<QType | ''>('')
  const [difficulty, setDifficulty] = useState('')
  const [bloom, setBloom] = useState('')
  const [scope, setScope] = useState<'org' | 'mine'>('org')
  const [subject, setSubject] = useState(defaultSubject ?? '')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [withKey, setWithKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [removed, setRemoved] = useState<Set<string>>(new Set())

  useEffect(() => { const t = window.setTimeout(() => setTerm(q.trim()), 350); return () => window.clearTimeout(t) }, [q])
  // "Show more" grows the page; any filter change starts again from the first page
  const filters = [term, qtype, difficulty, bloom, scope, subject].join('|')
  const [more, setMore] = useState({ filters, limit: PAGE })
  const limit = more.filters === filters ? more.limit : PAGE
  const setLimit = (f: (l: number) => number) => setMore({ filters, limit: f(limit) })

  const res = useAsync((signal) => questionGenService.bank({ q: term, qtype, difficulty, bloom, scope, nlp_subject: subject, limit }, { signal }),
    [term, qtype, difficulty, bloom, scope, subject, limit])
  const items = (res.data?.items ?? []).filter((i) => !removed.has(i.bank_id))
  const media: Record<string, MediaInfo> = res.data?.media ?? {}

  const remove = async (b: BankItem) => {
    if (!window.confirm('Delete this question from the bank?')) return
    try { await questionGenService.deleteBankItem(b.bank_id); setRemoved((s) => new Set(s).add(b.bank_id)); toast('✓ Deleted from the bank') }
    catch (e) { toast(errorMessage(e), 'error') }
  }
  const add = async () => {
    if (!onAdd) return
    setBusy(true)
    try { await onAdd([...picked]); setPicked(new Set()) } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-6">
        <div className="md:col-span-2">
          <Label htmlFor="bk-q">Search</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
            <Input id="bk-q" className="pl-9" value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} placeholder="Words in the question or answer" />
          </div>
        </div>
        <div>
          <Label htmlFor="bk-type">Type</Label>
          <Select id="bk-type" value={qtype} onChange={(e) => setQtype(e.target.value as QType | '')}>
            <option value="">All types</option>
            {meta.types.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="bk-diff">Difficulty</Label>
          <Select id="bk-diff" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            <option value="">Any</option>
            {meta.difficulties.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="bk-bloom">Bloom’s level</Label>
          <Select id="bk-bloom" value={bloom} onChange={(e) => setBloom(e.target.value)}>
            <option value="">Any</option>
            {meta.blooms.map((b) => <option key={b.code} value={b.code}>{b.label}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="bk-scope">Questions</Label>
          <Select id="bk-scope" value={scope} onChange={(e) => setScope(e.target.value as 'org' | 'mine')}>
            <option value="org">Mine + shared by my school</option>
            <option value="mine">Only mine</option>
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {defaultSubject && (
          <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-brand-500" checked={!!subject}
            onChange={(e) => setSubject(e.target.checked ? defaultSubject : '')} /> Only {defaultSubject}</label>
        )}
        <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-brand-500" checked={withKey} onChange={(e) => setWithKey(e.target.checked)} /> Show answers</label>
        {res.data && <span className="text-ink-400">{res.data.total} question{res.data.total === 1 ? '' : 's'}</span>}
        {onAdd && <Button size="sm" className="ml-auto" onClick={() => void add()} disabled={!picked.size || busy}><ListPlus className="h-3.5 w-3.5" /> Add {picked.size || ''} to paper</Button>}
      </div>

      {res.loading && !res.data && <SkeletonPage variant="table" />}
      {res.error && <ErrorState title="Could not load the question bank" message={res.error} onRetry={res.retry} />}
      {res.data && !items.length && <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-ink-400">No questions found. Save questions from a paper or from the generator to build your bank.</p>}
      <ul className="space-y-3">
        {items.map((b, i) => <BankRow key={b.bank_id} b={b} n={i + 1} meta={meta} media={media} withKey={withKey}
          picked={picked.has(b.bank_id)} onPick={onAdd ? (on) => setPicked((s) => { const n = new Set(s); if (on) n.add(b.bank_id); else n.delete(b.bank_id); return n }) : undefined}
          onDelete={!onAdd && b.mine ? () => void remove(b) : undefined} />)}
      </ul>
      {res.data && res.data.total > items.length + removed.size && (
        <div className="text-center"><Button variant="secondary" size="sm" disabled={res.loading} onClick={() => setLimit((l) => Math.min(100, l + PAGE))}>Show more</Button></div>
      )}
    </div>
  )
}

function BankRow({ b, n, meta, media, withKey, picked, onPick, onDelete }: {
  b: BankItem; n: number; meta: QgenMeta; media: Record<string, MediaInfo>; withKey: boolean
  picked: boolean; onPick?: (on: boolean) => void; onDelete?: () => void
}) {
  const ctx = useMemo(() => renderCtx(meta, b.language as Lang, media), [meta, b.language, media])
  return (
    <li className="rounded-xl border border-line bg-ink-900/60 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <label className="flex flex-wrap items-center gap-2 text-sm">
          {onPick && <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={picked} onChange={(e) => onPick(e.target.checked)} aria-label={`Select bank question ${n}`} />}
          <QuestionBadges q={b.question} meta={meta} />
          {b.nlp_subject && <Badge>{b.nlp_class ? `Class ${b.nlp_class} · ` : ''}{b.nlp_subject}{b.chapter ? ` · ${b.chapter}` : ''}</Badge>}
          <Badge tone={b.visibility === 'ORG' ? 'aqua' : 'neutral'}>{b.visibility === 'ORG' ? 'Shared' : 'Private'}</Badge>
          {!b.mine && b.owner_name && <span className="text-xs text-ink-400">by {b.owner_name}</span>}
          {b.usage_count > 0 && <span className="text-xs text-ink-400">used {b.usage_count}×</span>}
        </label>
        {onDelete && <Button size="sm" variant="ghost" aria-label={`Delete bank question ${n}`} onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>}
      </div>
      <QuestionView q={b.question} number={String(n)} ctx={ctx} withKey={withKey} />
    </li>
  )
}
