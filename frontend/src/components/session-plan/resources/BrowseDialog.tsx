import { useState } from 'react'
import { Search, X } from 'lucide-react'
import { Overlay } from '@/components/lesson-plan/dialogs'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/field'
import type { AssetType, LpChapter } from '@/types/lessonPlan'
import type { LibSel } from './LibraryPanel'

/* Browse — pick the chapter the library is narrowed to. Class and Subject are LOCKED to the lesson plan's own
   (shown read-only so the teacher can still SEE the scope): a session belongs to one class and one subject,
   and a picked row carries no class of its own, so letting this re-scope would let a Class VIII resource slip
   into a Class III session unnoticed. Chapter stays open — that is the one axis worth narrowing here.
   Mounted only while open, so it always starts from the current browse. */
export function BrowseDialog({ assetType, className, subjectName, chapters, chaptersBusy, initial, onApply, onClose }: {
  assetType: AssetType
  className: string
  subjectName: string
  chapters: LpChapter[]
  chaptersBusy: boolean
  initial: LibSel | null
  onApply: (sel: LibSel) => void
  onClose: () => void
}) {
  const [chapterId, setChapterId] = useState(initial?.chapterId ?? '')
  const [chapterName, setChapterName] = useState(initial?.chapter ?? '')

  return (
    <Overlay onClose={onClose} z="z-[400]">
      <div className="glass lp-fly w-[400px] max-w-full rounded-2xl" role="dialog" aria-modal="true" aria-labelledby="sr-browse-title">
        <div className="flex items-center gap-2.5 rounded-t-2xl border-b border-line bg-gradient-to-b from-brand-500/[0.06] to-transparent px-[18px] py-3.5">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500/12 text-brand-600"><Search className="h-3.5 w-3.5" /></span>
          <span id="sr-browse-title" className="mr-auto text-sm font-semibold text-fg">Browse {assetType}</span>
          <button type="button" onClick={onClose} aria-label="Close" title="Close"
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-ink-500 hover:bg-ink-800 hover:text-fg"><X className="h-3.5 w-3.5" /></button>
        </div>
        <div className="flex flex-col gap-3.5 px-[18px] py-4">
          <div>
            <label htmlFor="sr-browse-class" className="mb-1.5 block text-[13px] font-medium text-fg">Class</label>
            <Input id="sr-browse-class" value={className || '—'} readOnly disabled title="Locked to this lesson plan’s class" />
          </div>
          <div>
            <label htmlFor="sr-browse-subject" className="mb-1.5 block text-[13px] font-medium text-fg">Subject</label>
            <Input id="sr-browse-subject" value={subjectName || '—'} readOnly disabled title="Locked to this lesson plan’s subject" />
          </div>
          <div>
            <label htmlFor="sr-browse-chapter" className="mb-1.5 block text-[13px] font-medium text-fg">Chapters</label>
            <Select id="sr-browse-chapter" value={chapterId} disabled={chaptersBusy}
              onChange={(e) => {
                const id = e.target.value
                setChapterId(id)
                setChapterName(chapters.find((c) => String(c.id) === id)?.name ?? '')
              }}>
              <option value="">{chaptersBusy ? 'Loading chapters…' : 'All chapters'}</option>
              {chapters.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
            </Select>
          </div>
        </div>
        <div className="flex justify-end gap-2.5 px-[18px] pb-4 pt-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onApply({ chapterId, chapter: chapterName })}>Get resources</Button>
        </div>
      </div>
    </Overlay>
  )
}
