import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpenText, FileText, MessageSquareText, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Label, Select } from '@/components/ui/field'
import { aiClassroomService, type NlpChapter, type NlpClass } from '@/services/aiClassroomService'
import { errorMessage } from '@/services/apiClient'

/**
 * AI Classroom landing: either continue with your assigned subject's textbook (unchanged, existing reader),
 * or browse the chapter library (backend/nlp/) by class — every subject and chapter for that class at once,
 * each one that has a PDF opening the AI reader (chat + auto-explanation grounded in the page, camera check).
 */
export default function AiClassroomHome() {
  const [classes, setClasses] = useState<NlpClass[] | null>(null)
  const [classLabel, setClassLabel] = useState('')
  const [bySubject, setBySubject] = useState<Record<string, NlpChapter[]> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    aiClassroomService.classes().then((cs) => {
      setClasses(cs)
      if (cs[0]) setClassLabel(cs[0].class_label)
    }).catch((e) => setError(errorMessage(e)))
  }, [])

  useEffect(() => {
    if (!classLabel) return
    setBySubject(null)
    aiClassroomService.subjects(classLabel).then(async (subjects) => {
      const pairs = await Promise.all(subjects.map(async (s) => [s, await aiClassroomService.chapters(classLabel, s)] as const))
      setBySubject(Object.fromEntries(pairs))
    }).catch((e) => setError(errorMessage(e)))
  }, [classLabel])

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <header className="animate-fade-up">
        <p className="flex items-center gap-1.5 text-sm text-ink-300"><MessageSquareText className="h-4 w-4" /> AI Classroom</p>
        <h1 className="mt-1 font-display text-3xl font-bold">Learn with your <span className="text-gradient">AI tutor</span></h1>
        <p className="mt-1 text-sm text-ink-300">Pick a chapter below, or continue with your textbook — either way you get an AI tutor that reads the page with you.</p>
      </header>

      <Link to="/student/classroom/textbook">
        <Card className="flex items-center gap-4 p-5 transition-colors hover:border-brand-400/50">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-500/10"><BookOpenText className="h-6 w-6 text-brand-600" /></div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-lg font-semibold text-fg">Continue with my textbook</div>
            <p className="text-sm text-ink-300">Your subject's indexed textbook, with the 3D avatar tutor and page-aware chat.</p>
          </div>
        </Card>
      </Link>

      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      <Card className="space-y-4 p-5">
        <div className="flex items-center gap-3">
          <Sparkles className="h-5 w-5 text-brand-600" />
          <h2 className="font-display text-lg font-semibold text-fg">Chapter library</h2>
        </div>
        {!classes ? <div className="skeleton h-24" /> : classes.length === 0 ? (
          <p className="text-sm text-ink-300">No chapters are available yet.</p>
        ) : (
          <>
            <div className="max-w-xs">
              <Label htmlFor="ac-class">Class</Label>
              <Select id="ac-class" value={classLabel} onChange={(e) => setClassLabel(e.target.value)}>
                {classes.map((c) => <option key={c.class_label} value={c.class_label}>{c.grade ? `Class ${c.grade}` : c.class_label}</option>)}
              </Select>
            </div>

            {!bySubject ? <div className="skeleton h-40" /> : Object.keys(bySubject).length === 0 ? (
              <p className="text-sm text-ink-300">No chapters for this class yet.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {Object.entries(bySubject).map(([subject, chapters]) => (
                  <div key={subject} className="rounded-xl border border-line p-4">
                    <h3 className="mb-2 font-display text-base font-semibold text-fg">{subject}</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {chapters.map((c) => c.has_pdf ? (
                        <Link key={c.chapter} to={`/student/classroom/nlp/${encodeURIComponent(classLabel)}/${encodeURIComponent(subject)}/${encodeURIComponent(c.chapter)}`}>
                          <Badge tone="brand" className="cursor-pointer hover:bg-brand-500/20"><FileText className="h-3 w-3" /> {c.chapter}</Badge>
                        </Link>
                      ) : (
                        <Badge key={c.chapter} tone="neutral" title="No PDF yet for this chapter" className="opacity-60">{c.chapter}</Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  )
}

