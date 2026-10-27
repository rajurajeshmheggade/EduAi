import { useRef } from 'react'
import { BookOpen, FileText, Library, Target, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/field'
import { OTHER_CHAPTER, uniq } from './model'
import { DotLabel } from './ui'
import type { Creator } from './useCreator'

/** Step 1 — Basic Setup & Content: class / subject / board / chapter / duration + an optional grounding document. */
export function StepSetup({ c }: { c: Creator }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const pickedPair = !!(c.classCode && c.subjectCode)
  const hasChapters = c.chapterOpts.length > 0
  // A textbook chapter, the "type it" option, or nothing yet.
  const chapterValue = c.selChapter ? c.selChapter.id : (c.customChapter || (!!c.chapter && !c.chaptersLoading)) ? OTHER_CHAPTER : ''
  const showTyped = pickedPair && !c.chaptersLoading && (!hasChapters || chapterValue === OTHER_CHAPTER)
  const books = uniq(c.chapterOpts.map((x) => x.textbook_title || x.textbook_id))
  const missing = [!c.setupOk && 'board, class and subject', !c.chapterOk && 'a chapter/unit', !c.durationOk && 'a time duration'].filter(Boolean)
  const chapterOption = (x: (typeof c.chapterOpts)[number]) => <option key={x.id} value={x.id}>{x.chapter_number}. {x.name}</option>

  return (
    <Card className="relative overflow-hidden p-6 md:p-7">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-500 to-emerald-500" />
      <div className="mb-6 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-500/10 text-brand-600"><BookOpen className="h-5 w-5" /></span>
        <div>
          <h3 className="text-lg font-semibold text-fg">Basic Setup</h3>
          <p className="text-[13px] text-ink-500">Configure your lesson details in just a few clicks</p>
        </div>
      </div>

      <div className="mb-6 grid gap-6 md:grid-cols-2">
        <div>
          <DotLabel dot="bg-emerald-500" htmlFor="lp-class">Class</DotLabel>
          <Select id="lp-class" value={c.classCode} onChange={(e) => c.selectClass(e.target.value)} disabled={!c.scope.classes.length}>
            <option value="">{c.scope.classes.length ? 'Select class' : 'No classes assigned'}</option>
            {c.scope.classes.map((x) => <option key={x.class_code} value={x.class_code}>{x.class_name}</option>)}
          </Select>
        </div>
        <div>
          <DotLabel dot="bg-purple-500" htmlFor="lp-subject">Subject</DotLabel>
          <Select id="lp-subject" value={c.subjectCode} onChange={(e) => c.selectSubject(e.target.value)} disabled={!c.subjectOpts.length}>
            <option value="">{c.classCode ? 'Select subject' : 'Select class first'}</option>
            {c.subjectOpts.map((x) => <option key={x.subject_code} value={x.subject_code}>{x.subject_name}</option>)}
          </Select>
        </div>
        <div>
          <DotLabel dot="bg-brand-500" htmlFor="lp-board">Board/Standard</DotLabel>
          <Select id="lp-board" value={c.board} onChange={(e) => c.setBoard(e.target.value)}>
            {uniq([...(c.scope.boards.length ? c.scope.boards : ['CBSE']), ...(c.board ? [c.board] : [])]).map((b) => <option key={b} value={b}>{b}</option>)}
          </Select>
        </div>
        <div>
          <DotLabel dot="bg-orange-500" htmlFor={showTyped && !hasChapters ? 'lp-chapter-text' : 'lp-chapter'}>Chapter/Unit</DotLabel>
          {(!pickedPair || c.chaptersLoading || hasChapters) && (
            <Select id="lp-chapter" value={chapterValue} onChange={(e) => c.pickChapter(e.target.value)} disabled={!pickedPair || c.chaptersLoading}>
              <option value="">{!pickedPair ? 'Select class & subject first' : c.chaptersLoading ? 'Loading chapters…' : 'Select chapter/unit...'}</option>
              {books.length > 1
                ? books.map((b) => (
                  <optgroup key={b} label={b}>
                    {c.chapterOpts.filter((x) => (x.textbook_title || x.textbook_id) === b).map(chapterOption)}
                  </optgroup>
                ))
                : c.chapterOpts.map(chapterOption)}
              <option value={OTHER_CHAPTER}>Other — type a chapter</option>
            </Select>
          )}
          {showTyped && (
            <Input id="lp-chapter-text" aria-label="Chapter or unit name" className={hasChapters ? 'mt-2' : undefined} value={c.chapter}
              onChange={(e) => c.typeChapter(e.target.value)} placeholder="Type the chapter / unit name" />
          )}
          {pickedPair && !c.chaptersLoading && !hasChapters && (
            <p className="mt-1.5 text-xs text-ink-500">No indexed textbook for this subject yet — type the chapter or unit you are planning.</p>
          )}
          {c.selChapter && (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-aqua-500/10 px-2.5 py-1.5 text-xs text-aqua-400">
              <Library className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>The plan will be grounded in chapter {c.selChapter.chapter_number} of <b className="font-semibold">{c.selChapter.textbook_title || 'the indexed textbook'}</b>.</span>
            </p>
          )}
        </div>
        <div>
          <DotLabel dot="bg-red-500" htmlFor="lp-hours">Time Duration</DotLabel>
          <div className="flex items-center gap-2.5">
            <Input id="lp-hours" aria-label="Hours" value={c.hours} placeholder="Hrs" inputMode="numeric" className="w-24 bg-ink-800"
              onChange={(e) => c.changeHours(e.target.value.replace(/\D/g, '').slice(0, 2))} />
            <span className="text-ink-500">:</span>
            <Input id="lp-minutes" aria-label="Minutes" value={c.minutes} placeholder="Mins" inputMode="numeric" className="w-24 bg-ink-800"
              onChange={(e) => c.changeMinutes(e.target.value.replace(/\D/g, '').slice(0, 2))} />
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-xl border-2 border-dashed border-brand-400/40 bg-gradient-to-r from-brand-500/5 to-purple-500/5 p-4">
        {/* Reset the input after reading it, so removing a file and picking the same one again still fires. */}
        <input ref={fileInput} id="lp-upload" type="file" accept=".pdf,.txt,.docx" className="hidden" aria-label="Upload related content"
          onChange={(e) => { c.pickFile(e.target.files?.[0] ?? null); e.target.value = '' }} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink-900 text-brand-600 shadow-sm">
              {c.file ? <FileText className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-fg">{c.file ? c.file.name : 'Upload Related Content'}</p>
              <p className="text-xs text-brand-600">{c.file ? `${(c.file.size / 1024).toFixed(2)} KB` : 'PDFs, TXT, and DOCX files only (Max 10MB)'}</p>
            </div>
          </div>
          {c.file
            ? <Button variant="ghost" size="icon" aria-label="Remove file" title="Remove file" onClick={c.clearFile} className="text-bad hover:bg-bad/10 hover:text-bad"><X className="h-4 w-4" /></Button>
            : <Button variant="secondary" size="sm" className="h-9 bg-ink-900 text-brand-600" onClick={() => fileInput.current?.click()}>Browse Files</Button>}
        </div>
      </div>

      <div className="text-center">
        <Button size="lg" onClick={() => void c.generateCOs()} disabled={!c.canGenCOs}
          title={missing.length ? `Add ${missing.join(', ')} first` : undefined}
          className="rounded-xl from-purple-600 to-brand-600 px-8">
          <Target className="h-[18px] w-[18px]" />Generate COs
        </Button>
      </div>
    </Card>
  )
}
