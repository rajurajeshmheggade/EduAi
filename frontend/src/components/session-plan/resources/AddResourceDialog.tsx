import { useState, type FormEvent } from 'react'
import { Link2, Loader2, Plus, Upload, X } from 'lucide-react'
import { Overlay } from '@/components/lesson-plan/dialogs'
import { RESOURCE_TYPES } from '@/components/lesson-plan/data'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/field'
import { cn } from '@/lib/utils'
import { httpStatus, sessionErrorMessage, sessionPlanService } from '@/services/lessonPlanService'
import type { LpChapter, ResourceType } from '@/types/lessonPlan'

/* "+ Add resource" — NEW in EduAI, which has no separate Learning Resources screen. Adds a link OR an uploaded
   file (≤ 50 MB) to the library of this lesson plan's class + subject, optionally under a chapter. */

const MAX_MB = 50

/** A sensible type for a chosen file, until the teacher picks one themselves. */
function typeOfFile(name: string): ResourceType {
  const e = (name.split('.').pop() || '').toLowerCase()
  if (e === 'pdf') return 'PDF'
  if (['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(e)) return 'Video'
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga'].includes(e)) return 'Audio'
  if (['ppt', 'pptx', 'key', 'odp'].includes(e)) return 'Presentation'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(e)) return 'Image'
  return 'Document'
}

export function AddResourceDialog({ classCode, subjectCode, scopeLine, chapters, initialChapter, onAdded, onClose }: {
  classCode: string
  subjectCode: string
  scopeLine: string
  chapters: LpChapter[]
  initialChapter: string
  onAdded: (chapter: string) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState<ResourceType>('Link')
  const [typeTouched, setTypeTouched] = useState(false)
  const [chapter, setChapter] = useState(initialChapter)
  const [mode, setMode] = useState<'link' | 'file'>('link')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // The chapter the teacher is browsing may not be one of the curriculum's (an old free-text chapter); keep it selectable.
  const chapterNames = Array.from(new Set([...chapters.map((c) => c.name), ...(initialChapter ? [initialChapter] : [])]))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const name = title.trim()
    if (!name) { setErr('Enter a title for the resource.'); return }
    const link = url.trim()
    if (mode === 'link') {
      if (!link) { setErr('Paste the link to the resource.'); return }
      if (!/^https?:\/\/\S+$/i.test(link)) { setErr('Links must start with http:// or https://'); return }
    } else {
      if (!file) { setErr('Choose a file to upload.'); return }
      if (file.size > MAX_MB * 1024 * 1024) { setErr(`That file is larger than ${MAX_MB} MB.`); return }
      if (file.size === 0) { setErr('That file is empty.'); return }
    }
    setBusy(true); setErr('')
    try {
      await sessionPlanService.addResource({
        classCode, subjectCode, title: name, resourceType: type, chapter: chapter || undefined,
        url: mode === 'link' ? link : undefined, file: mode === 'file' ? file : null,
        description: description.trim() || undefined,
      })
      onAdded(chapter)
    } catch (ex) {
      setErr(httpStatus(ex) === 413 ? `That file is larger than ${MAX_MB} MB.` : sessionErrorMessage(ex, 'The resource could not be added.'))
      setBusy(false)
    }
  }

  const tab = (m: 'link' | 'file', label: string, Icon: typeof Link2) => (
    <button type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setErr('') }}
      className={cn('flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all',
        mode === m ? 'bg-ink-900 text-brand-600 shadow-sm ring-1 ring-line' : 'text-ink-300 hover:text-fg')}>
      <Icon className="h-3.5 w-3.5" />{label}
    </button>
  )

  return (
    <Overlay onClose={busy ? undefined : onClose} z="z-[400]">
      <form onSubmit={submit} className="glass lp-fly w-[min(480px,100%)] rounded-2xl" role="dialog" aria-modal="true" aria-labelledby="sr-add-title">
        <div className="flex items-start gap-3 rounded-t-2xl border-b border-line bg-gradient-to-b from-brand-500/[0.06] to-transparent px-5 py-4">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/12 text-brand-600"><Plus className="h-4 w-4" /></span>
          <div className="mr-auto min-w-0">
            <h3 id="sr-add-title" className="font-display text-base font-semibold text-fg">Add a resource</h3>
            <p className="mt-0.5 truncate text-xs text-ink-500">To the library of {scopeLine || 'this class and subject'}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" title="Close"
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-ink-500 hover:bg-ink-800 hover:text-fg"><X className="h-3.5 w-3.5" /></button>
        </div>
        <div className="flex flex-col gap-3.5 px-5 py-4">
          <div>
            <label htmlFor="sr-add-name" className="mb-1.5 block text-[13px] font-medium text-fg">Title <span className="text-bad">*</span></label>
            <Input id="sr-add-name" maxLength={300} value={title} onChange={(e) => { setTitle(e.target.value); setErr('') }} placeholder="e.g., Photosynthesis explainer video" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="sr-add-type" className="mb-1.5 block text-[13px] font-medium text-fg">Type</label>
              <Select id="sr-add-type" value={type} onChange={(e) => { setType(e.target.value as ResourceType); setTypeTouched(true) }}>
                {RESOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </div>
            <div>
              <label htmlFor="sr-add-chapter" className="mb-1.5 block text-[13px] font-medium text-fg">Chapter</label>
              <Select id="sr-add-chapter" value={chapter} onChange={(e) => setChapter(e.target.value)}>
                <option value="">No chapter (all chapters)</option>
                {chapterNames.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
          </div>
          <div role="tablist" aria-label="Resource source" className="flex gap-1 rounded-xl border border-line bg-ink-800 p-1">
            {tab('link', 'Link', Link2)}
            {tab('file', 'Upload a file', Upload)}
          </div>
          {mode === 'link' ? (
            <div>
              <label htmlFor="sr-add-url" className="mb-1.5 block text-[13px] font-medium text-fg">Link <span className="text-bad">*</span></label>
              <Input id="sr-add-url" type="url" inputMode="url" value={url} onChange={(e) => { setUrl(e.target.value); setErr('') }} placeholder="https://…" />
            </div>
          ) : (
            <div>
              <label htmlFor="sr-add-file" className="mb-1.5 block text-[13px] font-medium text-fg">File (max {MAX_MB} MB) <span className="text-bad">*</span></label>
              <input id="sr-add-file" type="file"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null
                  setFile(f); setErr('')
                  if (f && !typeTouched) setType(typeOfFile(f.name))
                  if (f && !title.trim()) setTitle(f.name.replace(/\.[^.]+$/, '').slice(0, 300))
                }}
                className="block w-full cursor-pointer rounded-xl border border-dashed border-line-strong bg-ink-800 p-2.5 text-xs text-ink-300 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-500 file:px-3 file:py-1 file:text-white" />
            </div>
          )}
          <div>
            <label htmlFor="sr-add-desc" className="mb-1.5 block text-[13px] font-medium text-fg">Description <span className="font-normal text-ink-500">(optional)</span></label>
            <Textarea id="sr-add-desc" rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {err && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-[13px] text-bad">{err}</p>}
        </div>
        <div className="flex justify-end gap-2.5 px-5 pb-5">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Add to library</Button>
        </div>
      </form>
    </Overlay>
  )
}
