import { useMemo, useState } from 'react'
import { RotateCcw, Save } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label, Select, Textarea } from '@/components/ui/field'
import { ErrorState, SkeletonPage, Spinner } from '@/components/ui/loading'
import { toast } from '@/components/ui/toast'
import { useAsync } from '@/lib/useAsync'
import { errorMessage } from '@/services/apiClient'
import { questionGenService } from '@/services/questionGenService'
import type { MappingsResponse, QgenSettings, SubjectMappingRow } from '@/types/questionGen'

type Repo = MappingsResponse['repository']

const TONE = { auto: 'brand', override: 'aqua', none: 'warn' } as const
const MAPPING_LABEL = { auto: 'Automatic', override: 'Set by admin', none: 'Not linked' } as const

/** Admin console → Question generator: link each class subject to its content-repository folder, and set the
 *  Assertion–Reason instruction and answer codes printed on question papers. */
export function QgenMappingPanel({ org }: { org?: string | null }) {
  const scope = org ?? undefined
  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-300">
        The AI Question Generator reads chapters from the NLP content repository. Each class subject is linked to a repository class and
        subject automatically (the class&apos;s grade and the subject&apos;s name); correct any link that is wrong or missing here.
      </p>
      <MappingsCard key={`m-${scope ?? ''}`} scope={scope} />
      <ArSettingsCard key={`s-${scope ?? ''}`} scope={scope} />
    </div>
  )
}

/* ───────────────────────────── class subject → repository folder */
function MappingsCard({ scope }: { scope?: string }) {
  const load = useAsync(() => questionGenService.adminMappings(scope), [scope])
  const [saved, setData] = useState<MappingsResponse | null>(null)
  const data = saved ?? load.data ?? null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Class subjects → content repository</CardTitle>
        <CardDescription>Teachers see only chapters of the repository subject their class subject is linked to.</CardDescription>
      </CardHeader>
      <CardContent>
        {load.error && !data ? <ErrorState message={load.error} onRetry={load.retry} />
          : !data ? <SkeletonPage variant="table" />
            : data.mappings.length === 0 ? <p className="text-sm text-ink-300">No classes with subjects yet — add them under Classes &amp; subjects.</p>
              : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-300">
                        <th className="py-2 pr-3 font-medium">Class</th>
                        <th className="py-2 pr-3 font-medium">Subject</th>
                        <th className="py-2 pr-3 font-medium">Link</th>
                        <th className="py-2 pr-3 font-medium">Repository class</th>
                        <th className="py-2 pr-3 font-medium">Repository subject</th>
                        <th className="py-2 font-medium"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.mappings.map((m) => (
                        <MappingRow key={`${m.class_code}|${m.subject_code}`} row={m} repo={data.repository} scope={scope} onSaved={setData} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
      </CardContent>
    </Card>
  )
}

function MappingRow({ row, repo, scope, onSaved }: { row: SubjectMappingRow; repo: Repo; scope?: string; onSaved: (d: MappingsResponse) => void }) {
  const initialClass = row.nlp_class ?? (row.grade != null ? repo.find((c) => c.grade === row.grade)?.class_label : undefined) ?? ''
  const [klass, setKlass] = useState(initialClass)
  const subjects = useMemo(() => repo.find((c) => c.class_label === klass)?.subjects ?? [], [repo, klass])
  const [subject, setSubject] = useState(row.nlp_subject && subjects.includes(row.nlp_subject) ? row.nlp_subject : '')
  const [busy, setBusy] = useState(false)
  const id = `qgm-${row.class_code}-${row.subject_code}`
  const changed = klass !== (row.nlp_class ?? '') || subject !== (row.nlp_subject ?? '')

  const pickClass = (v: string) => {
    setKlass(v)
    const next = repo.find((c) => c.class_label === v)?.subjects ?? []
    setSubject(row.nlp_subject && next.includes(row.nlp_subject) ? row.nlp_subject : next[0] ?? '')
  }
  const run = async (fn: () => Promise<MappingsResponse>, done: string) => {
    setBusy(true)
    try {
      onSaved(await fn())
      toast(done, 'success')
    } catch (e) {
      toast(errorMessage(e, 'Could not save the link'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <tr className="border-b border-line/60 align-top">
      <td className="py-2 pr-3"><div className="font-medium text-fg">{row.class_name ?? row.class_code}</div><div className="text-xs text-ink-400">{row.class_code}</div></td>
      <td className="py-2 pr-3"><div className="text-fg">{row.subject_name}</div><div className="text-xs text-ink-400">{row.subject_code}</div></td>
      <td className="py-2 pr-3">
        <Badge tone={TONE[row.mapping]}>{MAPPING_LABEL[row.mapping]}</Badge>
        {row.note && <p className="mt-1 max-w-[16rem] text-xs text-ink-400">{row.note}</p>}
      </td>
      <td className="py-2 pr-3">
        <label htmlFor={`${id}-class`} className="sr-only">Repository class for {row.class_code} {row.subject_name}</label>
        <Select id={`${id}-class`} className="w-36" value={klass} onChange={(e) => pickClass(e.target.value)} disabled={busy}>
          {!klass && <option value="">Choose…</option>}
          {repo.map((c) => <option key={c.class_label} value={c.class_label}>{c.grade ? `Class ${c.grade}` : c.class_label}</option>)}
        </Select>
      </td>
      <td className="py-2 pr-3">
        <label htmlFor={`${id}-subject`} className="sr-only">Repository subject for {row.class_code} {row.subject_name}</label>
        <Select id={`${id}-subject`} className="w-52" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={busy || !subjects.length}>
          {!subject && <option value="">{subjects.length ? 'Choose…' : 'No subjects'}</option>}
          {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </td>
      <td className="py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" disabled={busy || !klass || !subject || !changed}
            onClick={() => run(() => questionGenService.adminSetMapping(row.class_code, row.subject_code, { nlp_class: klass, nlp_subject: subject }, scope),
              `${row.subject_name} (${row.class_code}) linked to ${subject}, Class ${klass}`)}>
            {busy ? <Spinner className="h-3.5 w-3.5" label="Saving" /> : <Save className="h-3.5 w-3.5" />} Save
          </Button>
          {row.mapping === 'override' && (
            <Button size="sm" variant="ghost" disabled={busy}
              onClick={() => run(() => questionGenService.adminClearMapping(row.class_code, row.subject_code, scope), 'Back to the automatic link')}>
              <RotateCcw className="h-3.5 w-3.5" /> Use automatic
            </Button>
          )}
        </div>
      </td>
    </tr>
  )
}

/* ───────────────────────────── Assertion–Reason instruction + codes */
function ArSettingsCard({ scope }: { scope?: string }) {
  const load = useAsync(() => questionGenService.adminSettings(scope), [scope])
  const [saved, setSaved] = useState<QgenSettings | null>(null)
  const current = saved ?? load.data ?? null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Assertion–Reason codes</CardTitle>
        <CardDescription>Printed once above every group of Assertion–Reason questions, used by the AI generator and for grading online tests.</CardDescription>
      </CardHeader>
      <CardContent>
        {load.error && !current ? <ErrorState message={load.error} onRetry={load.retry} />
          : !current ? <SkeletonPage variant="detail" />
            : <ArForm key={JSON.stringify(current)} initial={current} scope={scope} onSaved={setSaved} />}
      </CardContent>
    </Card>
  )
}

function ArForm({ initial, scope, onSaved }: { initial: QgenSettings; scope?: string; onSaved: (s: QgenSettings) => void }) {
  const [instruction, setInstruction] = useState(initial.ar_instruction)
  const [codes, setCodes] = useState<string[]>([...initial.ar_codes])
  const [busy, setBusy] = useState(false)
  const act = async (fn: () => Promise<QgenSettings>, done: string) => {
    setBusy(true)
    try {
      onSaved(await fn())
      toast(done, 'success')
    } catch (e) {
      toast(errorMessage(e, 'Could not save the codes'), 'error')
    } finally {
      setBusy(false)
    }
  }
  const valid = instruction.trim().length >= 10 && codes.every((c) => c.trim())
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (valid) void act(() => questionGenService.adminSaveSettings({ ar_instruction: instruction.trim(), ar_codes: codes.map((c) => c.trim()) }, scope), 'Assertion–Reason codes saved') }}>
      <div>
        <Label htmlFor="qg-ar-instruction">Instruction</Label>
        <Textarea id="qg-ar-instruction" rows={3} maxLength={600} value={instruction} onChange={(e) => setInstruction(e.target.value)} disabled={busy} />
      </div>
      {codes.map((c, i) => (
        <div key={i}>
          <Label htmlFor={`qg-ar-code-${i}`}>Code ({'ABCD'[i]})</Label>
          <Input id={`qg-ar-code-${i}`} maxLength={300} value={c} disabled={busy}
            onChange={(e) => setCodes((xs) => xs.map((x, k) => (k === i ? e.target.value : x)))} />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button type="submit" disabled={busy || !valid}>{busy ? <Spinner className="h-4 w-4" label="Saving" /> : <Save className="h-4 w-4" />} Save codes</Button>
        {initial.customised && (
          <Button variant="secondary" disabled={busy} onClick={() => act(() => questionGenService.adminResetSettings(scope), 'Default codes restored')}>
            <RotateCcw className="h-4 w-4" /> Restore defaults
          </Button>
        )}
        {!initial.customised && <span className="text-xs text-ink-400">Using the standard CBSE wording.</span>}
      </div>
    </form>
  )
}
