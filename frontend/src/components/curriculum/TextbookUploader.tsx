import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { CheckCircle2, FileUp, Loader2, UploadCloud, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/field'
import { Progress } from '@/components/ui/progress'
import { errorMessage } from '@/services/apiClient'
import { curriculumService } from '@/services/curriculumService'
import type { Job } from '@/types'

const STAGE: Record<string, string> = { parsing: 'Reading PDF & detecting chapters', embedding: 'Creating vector embeddings', done: 'Indexed' }

/** FR-T2-01/02: upload a textbook PDF, then follow vectorization progress live. */
export function TextbookUploader({ subject, year, cycle, klass, onIndexed }: {
  subject: string; year: string | null; cycle: string | null; klass: string | null; onIndexed: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [drag, setDrag] = useState(false)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => () => window.clearInterval(timer.current), [])

  const pick = useCallback((f: File | undefined) => {
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.pdf')) { setError('Please choose a PDF file.'); return }
    setError(null); setFile(f)
    setTitle((t) => t || f.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' '))
  }, [])

  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]) }

  function follow(jobId: string) {
    window.clearInterval(timer.current)
    timer.current = window.setInterval(async () => {
      try {
        const j = await curriculumService.job(jobId)
        setJob(j)
        if (j.status === 'completed' || j.status === 'failed') {
          window.clearInterval(timer.current)
          onIndexed()
        }
      } catch { /* transient — keep polling */ }
    }, 1000)
  }

  async function submit() {
    if (!file || title.trim().length < 2) return
    setError(null); setJob(null); setUploadPct(0)
    try {
      const r = await curriculumService.upload({ file, title: title.trim(), subject, year, cycle, klass }, setUploadPct)
      setUploadPct(null)
      setJob({ job_id: r.job_id, status: 'queued', progress: 0, detail: {}, error: null })
      onIndexed()
      follow(r.job_id)
      setFile(null); setTitle('')
    } catch (e) {
      setUploadPct(null); setError(errorMessage(e, 'Upload failed'))
    }
  }

  const uploading = uploadPct !== null
  const running = job && (job.status === 'queued' || job.status === 'running')

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
        onClick={() => input.current?.click()} role="button" tabIndex={0} id="textbook-dropzone"
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        className={`grid cursor-pointer place-items-center rounded-2xl border-2 border-dashed p-6 text-center transition-all ${drag ? 'border-aqua-400 bg-aqua-500/10 scale-[1.01]' : 'border-line-strong bg-ink-800/60 hover:border-brand-400/50 hover:bg-brand-500/5'}`}
      >
        <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" id="textbook-file" onChange={(e) => pick(e.target.files?.[0])} />
        {file ? (
          <div className="flex items-center gap-3 text-left"><FileUp className="h-8 w-8 text-brand-300" /><div><div className="text-sm font-medium text-fg">{file.name}</div><div className="text-xs text-ink-500">{(file.size / 1048576).toFixed(1)} MB · click to change</div></div></div>
        ) : (
          <div><UploadCloud className="mx-auto mb-2 h-9 w-9 text-brand-300" /><div className="text-sm font-medium text-fg">Drop a textbook PDF here</div><div className="text-xs text-ink-500">or click to browse · up to 100 MB</div></div>
        )}
      </div>

      <div>
        <Label htmlFor="textbook-title">Title</Label>
        <Input id="textbook-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Foundations of Physics" maxLength={300} />
      </div>

      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      <Button id="textbook-upload" className="w-full" disabled={!file || title.trim().length < 2 || uploading || !!running} onClick={submit}>
        {uploading ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading {uploadPct}%</> : <><UploadCloud className="h-4 w-4" /> Upload & vectorize for {subject}</>}
      </Button>

      {job && (
        <div className="space-y-2 rounded-xl border border-line bg-ink-900/50 p-3" aria-live="polite">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-ink-300">
              {job.status === 'completed' ? <CheckCircle2 className="h-4 w-4 text-ok" /> : job.status === 'failed' ? <XCircle className="h-4 w-4 text-bad" /> : <Loader2 className="h-4 w-4 animate-spin text-brand-300" />}
              {job.status === 'failed' ? 'Vectorization failed' : STAGE[job.detail.stage ?? ''] ?? 'Queued…'}
            </span>
            <span className="tabular-nums text-ink-500">{Math.round(job.progress)}%</span>
          </div>
          <Progress value={job.progress} tone={job.status === 'failed' ? 'bad' : job.status === 'completed' ? 'ok' : 'brand'} />
          {job.status === 'completed' && <p className="text-xs text-ok">{job.detail.chunks} chunks embedded into pgvector.</p>}
          {job.error && <p className="text-xs text-bad">{job.error}</p>}
        </div>
      )}
    </div>
  )
}
