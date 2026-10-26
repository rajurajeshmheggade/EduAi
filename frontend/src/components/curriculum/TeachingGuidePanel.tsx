import { useEffect, useState } from 'react'
import { Download, Lightbulb, Loader2, PencilLine, Presentation, Save, Sparkles, TriangleAlert, HelpCircle } from 'lucide-react'
import { Markdown } from '@/components/Markdown'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label, Select, Textarea } from '@/components/ui/field'
import { errorMessage } from '@/services/apiClient'
import { curriculumService } from '@/services/curriculumService'
import type { TeachingGuide, Textbook } from '@/types'

const LEVELS = [['school', 'School'], ['college', 'College'], ['coaching', 'Coaching centre']] as const
const DURATIONS = [30, 45, 60, 90]

/** FR-T2-03 / FR-T2-04: generate, edit and export the "How to Teach" pedagogical guide for a chapter. */
export function TeachingGuidePanel({ book, defaultLevel }: { book: Textbook; defaultLevel: TeachingGuide['institution_level'] }) {
  const [chapter, setChapter] = useState<number>(book.chapters[0]?.chapter_number ?? 1)
  const [duration, setDuration] = useState(45)
  const [level, setLevel] = useState<string>(defaultLevel)
  const [guides, setGuides] = useState<TeachingGuide[]>([])
  const [active, setActive] = useState<TeachingGuide | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setChapter(book.chapters[0]?.chapter_number ?? 1)
    setActive(null); setError(null); setEditing(false)
    curriculumService.listGuides(book.textbook_id).then((g) => { setGuides(g); setActive(g[0] ?? null) }).catch(() => setGuides([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when a different textbook is selected
  }, [book.textbook_id])

  async function generate() {
    setBusy(true); setError(null)
    try {
      const g = await curriculumService.generateGuide({ textbook_id: book.textbook_id, chapter_number: chapter, duration_minutes: duration, institution_level: level })
      setGuides((x) => [g, ...x]); setActive(g); setEditing(false)
    } catch (e) { setError(errorMessage(e, 'Could not generate the guide')) }
    finally { setBusy(false) }
  }

  async function save() {
    if (!active) return
    try {
      const g = await curriculumService.updateGuide(active.guide_id, { lesson_plan_markdown: draft })
      setActive(g); setGuides((x) => x.map((y) => (y.guide_id === g.guide_id ? g : y))); setEditing(false)
    } catch (e) { setError(errorMessage(e)) }
  }

  async function exportPdf() {
    if (!active) return
    const blob = await curriculumService.exportGuidePdf(active.guide_id)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = `teaching-guide-ch${active.chapter_number}.pdf`; a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-[1.6fr_1fr_1fr_auto] sm:items-end">
        <div><Label htmlFor="guide-chapter">Chapter</Label>
          <Select id="guide-chapter" value={chapter} onChange={(e) => setChapter(Number(e.target.value))}>
            {book.chapters.map((c) => <option key={c.chapter_number} value={c.chapter_number}>{c.chapter_number}. {c.chapter_title}</option>)}
          </Select></div>
        <div><Label htmlFor="guide-level">Institution</Label>
          <Select id="guide-level" value={level} onChange={(e) => setLevel(e.target.value)}>{LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></div>
        <div><Label htmlFor="guide-duration">Session</Label>
          <Select id="guide-duration" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>{DURATIONS.map((d) => <option key={d} value={d}>{d} min</option>)}</Select></div>
        <Button id="generate-guide" onClick={generate} disabled={busy || !book.chapters.length}>
          {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> : <><Sparkles className="h-4 w-4" /> Generate</>}
        </Button>
      </div>

      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      {guides.length > 1 && (
        <div className="flex flex-wrap gap-2" aria-label="Previous guides">
          {guides.map((g) => (
            <button key={g.guide_id} onClick={() => { setActive(g); setEditing(false) }}
              className={`cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors ${active?.guide_id === g.guide_id ? 'border-brand-400/60 bg-brand-500/20 text-fg' : 'border-line text-ink-300 hover:text-fg'}`}>
              Ch {g.chapter_number} · {g.duration_minutes}m · {g.institution_level}
            </button>
          ))}
        </div>
      )}

      {!active && !busy && (
        <div className="rounded-2xl border border-dashed border-line p-10 text-center text-sm text-ink-300">
          Pick a chapter and generate a ready-to-teach plan: pacing, hooks, board work, misconceptions and check questions.
        </div>
      )}
      {busy && <div className="space-y-3"><div className="skeleton h-24" /><div className="skeleton h-40" /></div>}

      {active && !busy && (
        <div className="space-y-4 animate-fade-up" id="guide-result">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="mr-auto font-display text-xl font-semibold text-fg">{active.chapter_title}</h3>
            <Badge tone="brand">{active.duration_minutes} min</Badge><Badge tone="aqua" className="capitalize">{active.institution_level}</Badge>
            <Button variant="secondary" size="sm" onClick={() => { setDraft(active.lesson_plan_markdown); setEditing((v) => !v) }}><PencilLine className="h-3.5 w-3.5" />{editing ? 'Cancel' : 'Edit'}</Button>
            <Button variant="secondary" size="sm" onClick={exportPdf} id="export-guide-pdf"><Download className="h-3.5 w-3.5" /> PDF</Button>
          </div>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Presentation className="h-4 w-4 text-brand-300" /> Lesson plan & pacing</CardTitle></CardHeader>
            <CardContent>
              {editing ? (
                <div className="space-y-2">
                  <Textarea rows={12} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Lesson plan markdown" className="font-mono text-xs" />
                  <Button size="sm" onClick={save}><Save className="h-3.5 w-3.5" /> Save changes</Button>
                </div>
              ) : <Markdown source={active.lesson_plan_markdown} />}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Lightbulb className="h-4 w-4 text-amber-400" /> Hook & analogy</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm text-ink-100">
                {active.analogies_and_hooks.opening_hook && <p><b className="text-fg">Hook:</b> {active.analogies_and_hooks.opening_hook}</p>}
                {active.analogies_and_hooks.analogy && <p><b className="text-fg">Analogy:</b> {active.analogies_and_hooks.analogy}</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Presentation className="h-4 w-4 text-aqua-400" /> Board-work blueprint</CardTitle></CardHeader>
              <CardContent><ol className="space-y-2 text-sm text-ink-100">
                {active.board_work_blueprint.map((b) => <li key={b.step} className="flex gap-3"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-aqua-500/20 text-xs text-aqua-400">{b.step}</span>{b.board}</li>)}
              </ol></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><TriangleAlert className="h-4 w-4 text-warn" /> Common misconceptions</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {active.common_misconceptions.map((m, i) => <div key={i}><p className="font-medium text-fg">{m.misconception}</p><p className="text-ink-300">→ {m.clarification}</p></div>)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><HelpCircle className="h-4 w-4 text-rose-400" /> Check questions</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {active.formative_questions.map((q, i) => <div key={i}><p className="font-medium text-fg">{i + 1}. {q.question}</p><p className="text-ink-500">Expected: {q.expected_answer}</p></div>)}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
