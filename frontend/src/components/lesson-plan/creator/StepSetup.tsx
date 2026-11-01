import { useRef } from 'react'
import { BookOpen, FileText, Library, Target, Upload, X } from 'lucide-react'
import { NlpChapterPicker } from '@/components/nlp/NlpChapterPicker'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/field'
import { uniq } from './model'
import { DotLabel } from './ui'
import type { Creator } from './useCreator'

/** Step 1 — Basic Setup & Content: Class / Subject / Chapter come from the chapter library (backend/nlp/,
 * Class III-XII + JEE), which also grounds the plan in that chapter's real text — plus Board and Duration,
 * and an optional uploaded document for extra grounding alongside the chapter text. */
export function StepSetup({ c }: { c: Creator }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const missing = [!c.setupOk && 'class, subject and chapter', !c.durationOk && 'a time duration'].filter(Boolean)

  return (
    <Card className="relative overflow-hidden p-6 md:p-7">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-500 to-emerald-500" />
      <div className="mb-6 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-500/10 text-brand-600"><BookOpen className="h-5 w-5" /></span>
        <div>
          <h3 className="text-lg font-semibold text-fg">Basic Setup</h3>
          <p className="text-[13px] text-ink-500">Pick a class, subject and chapter from the chapter library — the plan is grounded in its real text</p>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-line bg-ink-900/40 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-fg"><Library className="h-4 w-4 text-brand-600" /> Class · Subject · Chapter</div>
        <NlpChapterPicker idPrefix="lp-ncert" onChange={(sel) => void c.pickNcertSelection(sel)} />
        {c.ncertChapter && (
          <p className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-ok/10 px-2.5 py-1.5 text-xs text-ok">
            <span>The plan will be grounded in “{c.ncertChapter}”.</span>
            <button type="button" onClick={c.clearNcert} className="cursor-pointer font-medium underline-offset-2 hover:underline">Remove</button>
          </p>
        )}
      </div>

      <div className="mb-6 grid gap-6 sm:grid-cols-2">
        <div>
          <DotLabel dot="bg-brand-500" htmlFor="lp-board">Board/Standard</DotLabel>
          <Select id="lp-board" value={c.board} onChange={(e) => c.setBoard(e.target.value)}>
            {uniq([...(c.scope.boards.length ? c.scope.boards : ['CBSE']), ...(c.board ? [c.board] : [])]).map((b) => <option key={b} value={b}>{b}</option>)}
          </Select>
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
              <p className="truncate text-sm font-medium text-fg">{c.file ? c.file.name : 'Upload Extra Content (optional)'}</p>
              <p className="text-xs text-brand-600">{c.file ? `${(c.file.size / 1024).toFixed(2)} KB` : 'PDFs, TXT, and DOCX files only (Max 10MB) — used instead of the chapter text if provided'}</p>
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
