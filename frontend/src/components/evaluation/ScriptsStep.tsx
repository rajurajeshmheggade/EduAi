import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileArchive, FolderUp, Loader2, Play, RotateCcw, Trash2, UserX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/field'
import { Progress } from '@/components/ui/progress'
import { errorMessage } from '@/services/apiClient'
import { evaluationService, type EvalJob } from '@/services/evaluationService'
import { cn } from '@/lib/utils'
import { num, type EvalScript, type EvalTest, type ScriptStatus, type ScriptsView } from '@/types'

const STATUS: Record<ScriptStatus, { label: string; tone: 'neutral' | 'warn' | 'ok' | 'bad' | 'brand' | 'aqua' }> = {
  IN_PROGRESS: { label: 'Taking test', tone: 'brand' },
  UPLOADED: { label: 'Ready', tone: 'neutral' }, QUEUED: { label: 'Queued', tone: 'warn' },
  OCR_IN_PROGRESS: { label: 'Reading…', tone: 'warn' }, EVALUATED: { label: 'Evaluated', tone: 'ok' },
  REVIEWED: { label: 'Reviewed', tone: 'aqua' }, FAILED: { label: 'Failed', tone: 'bad' },
}
const METHOD: Record<string, string> = { name: 'Name', code: 'Admission no.', roll: 'Roll no.', fuzzy: 'Close name match', manual: 'Set by you' }
const folderAttrs = { webkitdirectory: '', directory: '' } as Record<string, string>

/** FR-EV-05/06/07: folder upload, filename -> student matching with manual reassignment, then run the AI queue. */
export function ScriptsStep({ test, onChanged }: { test: EvalTest; onChanged: () => void }) {
  const [view, setView] = useState<ScriptsView | null>(null)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [job, setJob] = useState<EvalJob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const id = test.eval_test_id
  const locked = test.status === 'PUBLISHED'
  const online = test.assessment_type === 'ONLINE_TEST'

  const load = useCallback(() => evaluationService.scripts(id).then(setView).catch((e) => setError(errorMessage(e))), [id])
  useEffect(() => { void load() }, [load])

  const poll = useCallback((jobId: string) => {
    window.clearInterval(timer.current)
    timer.current = window.setInterval(async () => {
      try {
        const j = await evaluationService.job(jobId)
        setJob(j)
        void load()
        if (j.status === 'completed' || j.status === 'failed') { window.clearInterval(timer.current); onChanged() }
      } catch { window.clearInterval(timer.current) }
    }, 1500)
  }, [load, onChanged])
  useEffect(() => () => window.clearInterval(timer.current), [])
  // Resume progress after a page reload while a run is still going.
  useEffect(() => {
    if (test.status === 'PROCESSING' && test.last_job_id) poll(test.last_job_id)
  }, [test.status, test.last_job_id, poll])

  async function upload(list: FileList | null) {
    const files = Array.from(list ?? []).filter((f) => /\.(pdf|zip)$/i.test(f.name))
    if (!files.length) { setError('No PDF or ZIP files in that selection'); return }
    setError(null); setNotice(null); setUploadPct(0)
    try {
      const r = await evaluationService.uploadScripts(id, files, setUploadPct)
      setView(r)
      const matched = r.uploaded?.filter((u) => u.student_user_code).length ?? 0
      const replaced = r.uploaded?.filter((u) => u.replaced).length ?? 0
      const bad = r.uploaded?.filter((u) => u.error) ?? []
      setNotice(`${r.uploaded?.length ?? 0} script(s) uploaded · ${matched} matched to students${replaced ? ` · ${replaced} replaced earlier scripts` : ''}${bad.length ? ` · ${bad.length} skipped (${bad.map((b) => b.file).join(', ')})` : ''}.`)
      onChanged()
    } catch (e) { setError(errorMessage(e)) } finally { setUploadPct(null) }
  }

  async function run(reEvaluate = false, scriptIds?: string[]) {
    setError(null)
    try {
      const r = await evaluationService.evaluate(id, { re_evaluate: reEvaluate, script_ids: scriptIds })
      setJob({ job_id: r.job_id, status: 'queued', progress: 0, detail: { total: r.scripts, done: 0 }, error: null })
      onChanged(); void load(); poll(r.job_id)
    } catch (e) { setError(errorMessage(e)) }
  }

  const act = async (fn: () => Promise<ScriptsView>) => { setError(null); try { setView(await fn()); onChanged() } catch (e) { setError(errorMessage(e)) } }

  const scripts = view?.scripts ?? []
  const matched = scripts.filter((s) => s.student_user_code)
  const pending = matched.filter((s) => ['UPLOADED', 'FAILED', 'QUEUED'].includes(s.processing_status))
  const running = job && (job.status === 'queued' || job.status === 'running')
  const used = new Set(matched.map((s) => s.student_user_code))

  return (
    <div className="space-y-5">
      {!locked && !online && (
        <Card>
          <CardHeader>
            <CardTitle>{test.assessment_type === 'ASSIGNMENT' ? 'Upload offline submissions (optional)' : 'Upload student answer scripts'}</CardTitle>
            <CardDescription>Name each PDF after the student — e.g. <code>Aarav_Sharma.pdf</code>, <code>10A01_Aarav Sharma.pdf</code> or the admission number. Pick a whole folder, several PDFs, or a ZIP.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-brand-400/50 bg-brand-500/5 p-4 hover:bg-brand-500/10">
                <FolderUp className="h-8 w-8 text-brand-600" />
                <div><div className="text-sm font-medium text-fg">Choose a folder</div><div className="text-xs text-ink-500">All PDFs inside are uploaded</div></div>
                <input id="scripts-folder" type="file" multiple {...folderAttrs} className="sr-only" disabled={uploadPct !== null || !!running}
                  onChange={(e) => { void upload(e.target.files); e.target.value = '' }} />
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-line-strong bg-ink-800/60 p-4 hover:border-brand-400/50">
                <FileArchive className="h-8 w-8 text-ink-300" />
                <div><div className="text-sm font-medium text-fg">Choose PDFs or a ZIP</div><div className="text-xs text-ink-500">Multiple selection allowed</div></div>
                <input id="scripts-files" type="file" multiple accept=".pdf,.zip" className="sr-only" disabled={uploadPct !== null || !!running}
                  onChange={(e) => { void upload(e.target.files); e.target.value = '' }} />
              </label>
            </div>
            {uploadPct !== null && <div><div className="mb-1 text-xs text-ink-500">Uploading & matching… {uploadPct}%</div><Progress value={uploadPct} /></div>}
            {notice && <p role="status" className="rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok">{notice}</p>}
          </CardContent>
        </Card>
      )}

      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      {job && (
        <Card className="p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            {running ? <Loader2 className="h-4 w-4 animate-spin text-brand-600" /> : job.status === 'completed' ? <CheckCircle2 className="h-4 w-4 text-ok" /> : <AlertTriangle className="h-4 w-4 text-bad" />}
            <span className="font-medium text-fg">{running ? 'AI is reading and grading scripts…' : job.status === 'completed' ? 'Evaluation finished' : 'Evaluation stopped'}</span>
            <span className="text-ink-500">{job.detail.done ?? 0}/{job.detail.total ?? '?'} scripts{job.detail.failed ? ` · ${job.detail.failed} failed` : ''}</span>
          </div>
          <Progress value={num(job.progress)} tone={job.status === 'failed' ? 'bad' : 'brand'} />
          {job.error && <p className="mt-2 text-sm text-bad">{job.error}</p>}
        </Card>
      )}

      <Card className="min-w-0">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>{online || test.assessment_type === 'ASSIGNMENT' ? 'Submissions' : 'Matched scripts'} {view && <span className="text-ink-500">({matched.length}/{scripts.length})</span>}</CardTitle>
            <CardDescription>{online ? 'Students’ test attempts are evaluated automatically when they submit.' : test.assessment_type === 'ASSIGNMENT'
              ? 'Student uploads are evaluated automatically; your folder uploads need “Evaluate”.' : 'Check each file is linked to the right student before running the AI.'}</CardDescription>
          </div>
          {!locked && (
            <div className="flex flex-wrap gap-2">
              {matched.some((s) => ['EVALUATED', 'REVIEWED'].includes(s.processing_status)) && (
                <Button variant="secondary" disabled={!!running} onClick={() => { if (confirm('Re-run the AI on every matched script? Teacher mark changes will be replaced.')) void run(true) }}>
                  <RotateCcw className="h-4 w-4" /> Re-evaluate all
                </Button>
              )}
              <Button onClick={() => run()} disabled={!pending.length || !!running} id="run-evaluation">
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Evaluate {pending.length || ''} script{pending.length === 1 ? '' : 's'}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {view && view.students_without_script.length > 0 && scripts.length > 0 && (
            <p className="flex items-start gap-2 rounded-lg bg-ink-800 px-3 py-2 text-xs text-ink-300"><UserX className="mt-0.5 h-3.5 w-3.5 shrink-0" /> No script yet for: {view.students_without_script.join(', ')}</p>
          )}
          {!view ? <div className="skeleton h-40" /> : scripts.length === 0 ? <p className="py-10 text-center text-sm text-ink-300">No scripts uploaded yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="py-2 pr-3 font-medium">File</th><th className="py-2 pr-3 font-medium">Student</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 pr-3 text-right font-medium">Score</th><th />
                </tr></thead>
                <tbody>
                  {scripts.map((s) => <ScriptRow key={s.script_id} s={s} view={view} used={used} locked={locked || !!running}
                    onAssign={(code) => act(() => evaluationService.assign(id, s.script_id, code))}
                    onDelete={() => { if (confirm(`Remove ${s.uploaded_pdf_filename ?? 'this submission'}?`)) void act(() => evaluationService.deleteScript(id, s.script_id)) }}
                    onRetry={() => run(false, [s.script_id])} />)}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ScriptRow({ s, view, used, locked, onAssign, onDelete, onRetry }: {
  s: EvalScript; view: ScriptsView; used: Set<string | null>; locked: boolean
  onAssign: (code: string | null) => void; onDelete: () => void; onRetry: () => void
}) {
  const st = STATUS[s.processing_status]
  const busy = s.processing_status === 'QUEUED' || s.processing_status === 'OCR_IN_PROGRESS' || s.processing_status === 'IN_PROGRESS'
  return (
    <tr className={cn('border-b border-line align-top last:border-0', !s.student_user_code && 'bg-warn/5')}>
      <td className="py-2.5 pr-3">
        <div className="max-w-56 truncate font-medium text-fg" title={s.uploaded_pdf_filename ?? ''}>
          {s.submission_mode === 'ONLINE_TEST_UI' ? 'Online test attempt' : s.uploaded_pdf_filename}
        </div>
        <div className="text-xs text-ink-500">
          {s.submission_mode === 'ONLINE_TEST_UI' ? 'Typed answers' : `${s.page_count} page${s.page_count === 1 ? '' : 's'}`}
          {s.submission_mode === 'STUDENT_PDF_UPLOAD' && ' · uploaded by student'}
          {s.ocr_method && s.ocr_method !== 'typed' ? ` · ${s.ocr_method === 'vision' ? 'handwriting OCR' : 'typed PDF'}` : ''}
          {s.submitted_at && ` · ${new Date(s.submitted_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
          {s.is_late && <span className="ml-1 font-semibold text-warn">· LATE</span>}
        </div>
      </td>
      <td className="py-2.5 pr-3">
        <Select aria-label={`Student for ${s.uploaded_pdf_filename ?? 'submission'}`} className="h-9 w-56" value={s.student_user_code ?? ''}
          disabled={locked || busy || s.submission_mode !== 'TEACHER_FOLDER_UPLOAD'}
          onChange={(e) => onAssign(e.target.value || null)}>
          <option value="">— Not matched —</option>
          {view.roster.map((r) => (
            <option key={r.user_code} value={r.user_code} disabled={used.has(r.user_code) && r.user_code !== s.student_user_code}>
              {r.roll_number ? `${r.roll_number}. ` : ''}{r.full_name}
            </option>
          ))}
        </Select>
        {s.match_method && <div className="mt-1 text-[11px] text-ink-500">Matched by {METHOD[s.match_method]}{s.match_method === 'fuzzy' && s.match_score ? ` (${Math.round(num(s.match_score) * 100)}%) — please confirm` : ''}</div>}
      </td>
      <td className="py-2.5 pr-3">
        <Badge tone={st.tone}>{busy && <Loader2 className="h-3 w-3 animate-spin" />}{st.label}</Badge>
        {s.error && <div className="mt-1 max-w-64 text-[11px] text-bad">{s.error}</div>}
      </td>
      <td className="py-2.5 pr-3 text-right tabular-nums">{['EVALUATED', 'REVIEWED'].includes(s.processing_status) ? `${num(s.total_obtained_marks)}/${num(s.total_max_marks)}` : '—'}</td>
      <td className="py-2.5 text-right">
        <div className="flex justify-end gap-1">
          {s.processing_status === 'FAILED' && !locked && <Button size="sm" variant="ghost" onClick={onRetry} title="Retry"><RotateCcw className="h-3.5 w-3.5" /></Button>}
          {!locked && !busy && s.submission_mode === 'TEACHER_FOLDER_UPLOAD' && <Button size="sm" variant="ghost" onClick={onDelete} aria-label={`Remove ${s.uploaded_pdf_filename}`}><Trash2 className="h-3.5 w-3.5" /></Button>}
        </div>
      </td>
    </tr>
  )
}
