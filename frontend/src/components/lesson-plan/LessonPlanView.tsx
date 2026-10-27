import { useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, ClipboardList, Download, FileText, Loader2, RotateCw, Save } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { ConfirmDialog } from '@/components/lesson-plan/dialogs'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { toast } from '@/components/ui/toast'
import { errorMessage } from '@/services/apiClient'
import { lessonPlanService } from '@/services/lessonPlanService'
import type { LessonPlanRow, PlanContent } from '@/types/lessonPlan'
import { isObj, printLessonPlan, readPlan, schoolInitials, type LessonPlanExportMeta } from './lessonPlanPrint'
import { AssessmentSection } from './view/AssessmentSection'
import { FiveEDesignSection } from './view/FiveEDesignSection'
import { ddmmyyyy, setIn, type Path, type SectionKey, type SectionProps } from './view/edit'
import { AssignmentsSection, CoreObjectivesSection, LearningExperienceSection, OutcomesSection } from './view/sections'
import { MetaField } from './view/ui'

/** The stored plan JSON, defensively: anything that is not an object becomes an empty plan. */
const storedPlan = (row: LessonPlanRow): Partial<PlanContent> => (isObj(row.plan) ? row.plan : {})

/** Teacher ▸ Lesson Plans ▸ Lesson Plan View (port of Rapid's LessonPlanView). Review, edit section by section,
    save, and download the plan as PDF (print document) or Word. */
export function LessonPlanView({ row, readOnly, onBack, onSaved }: {
  row: LessonPlanRow
  readOnly: boolean
  onBack: () => void
  onSaved: (row: LessonPlanRow) => void
}) {
  const { user } = useAuth()
  // `doc` is the stored plan being edited: every original key survives (incl. __creatorState); the class /
  // subject / topic frame below is display-only and never written back.
  const [doc, setDoc] = useState<Partial<PlanContent>>(() => storedPlan(row))
  const [base, setBase] = useState(row)
  const [editing, setEditing] = useState<SectionKey | null>(null)
  const [snapshot, setSnapshot] = useState<Partial<PlanContent> | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [wordBusy, setWordBusy] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)

  // A new row (re-read after a save) replaces the working copy — adjusted during render, not in an effect.
  if (base !== row) {
    setBase(row)
    setDoc(storedPlan(row))
    setEditing(null)
    setSnapshot(null)
    setDirty(false)
  }

  const plan = useMemo<Partial<PlanContent>>(() => ({
    coreObjectives: [], assessment: [], elos: [], ...doc,
    grade: doc.grade || row.className,
    subject: doc.subject || row.subjectName,
    topic: doc.topic || row.title,
    duration: String(row.durationMins || doc.duration || ''),
    plannedDate: doc.plannedDate || ddmmyyyy(row.createdAt),
    executionPeriod: doc.executionPeriod || '',
  }), [doc, row])
  const model = useMemo(() => readPlan(plan), [plan])

  const meta: LessonPlanExportMeta = {
    schoolName: user?.org_name || user?.org_code || '',
    teacherName: user?.full_name ?? '',
    academicYear: user?.year_code ?? '',
  }
  const fileBase = `${model.topic || model.subject || 'Lesson'}_Unit_plan`.replace(/\s+/g, '_')

  /* ── section editing: snapshot on Edit, restore on Cancel ───────────────────────────────────────── */
  const startEdit = (k: SectionKey) => { if (editing || saving) return; setSnapshot(doc); setEditing(k) }
  const cancelEdit = () => { if (snapshot) setDoc(snapshot); setEditing(null); setSnapshot(null) }
  const saveEdit = () => { if (snapshot && snapshot !== doc) setDirty(true); setEditing(null); setSnapshot(null) }
  const set = (path: Path, value: string, create = false) =>
    setDoc((d) => setIn(d, path, value, create) as Partial<PlanContent>)

  const sectionProps = (k: SectionKey): SectionProps => ({
    model, doc, set,
    editing: editing === k,
    showEdit: !readOnly,
    editLocked: saving || (editing !== null && editing !== k),
    onEdit: () => startEdit(k),
    onSave: saveEdit,
    onCancel: cancelEdit,
  })

  /* ── persist ─────────────────────────────────────────────────────────────────────────────────────── */
  async function save() {
    if (editing || saving) return
    setSaving(true)
    const wasSaved = saved
    try {
      await lessonPlanService.savePlan({
        id: row.id, classCode: row.classCode, className: row.className, subjectCode: row.subjectCode,
        subjectName: row.subjectName, chapterName: row.chapterName, textbookId: row.textbookId,
        chapterNumber: row.chapterNumber, unitPlanTitle: row.title, board: row.board, durationMins: row.durationMins,
        plan: doc, isCompleted: true, source: row.source,
      })
    } catch (e) {
      toast(errorMessage(e, 'The lesson plan could not be saved.'), 'error')
      setSaving(false)
      return
    }
    setSaved(true)
    setDirty(false)
    toast(wasSaved ? 'Lesson plan updated successfully.' : 'Lesson plan saved successfully.', 'success')
    let fresh: LessonPlanRow
    try { fresh = await lessonPlanService.getPlan(row.id) } catch { fresh = { ...row, plan: doc, isCompleted: true } }
    setSaving(false)
    onSaved(fresh)
  }

  /* ── downloads ───────────────────────────────────────────────────────────────────────────────────── */
  const downloadPdf = () => {
    if (editing) { toast('Finish editing before downloading.', 'error'); return }
    if (!printLessonPlan(plan, meta, fileBase)) {
      toast('Your browser blocked the print window. Allow pop-ups for this site and try again.', 'error')
      return
    }
    toast('Choose “Save as PDF” in the print dialog to download the plan.')
  }

  async function downloadWord() {
    if (wordBusy) return
    if (editing) { toast('Finish editing before downloading.', 'error'); return }
    setWordBusy(true)
    toast('Generating Word document…')
    try {
      const { exportLessonPlanToWord } = await import('./lessonPlanWord')
      await exportLessonPlanToWord(plan, meta, fileBase)
      toast('Word document downloaded.', 'success')
    } catch {
      toast('Could not generate the Word document.', 'error')
    } finally {
      setWordBusy(false)
    }
  }

  const back = () => { if (!readOnly && (dirty || editing)) setConfirmLeave(true); else onBack() }

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 animate-fade-up print:hidden">
        <Button variant="ghost" onClick={back}><ArrowLeft className="h-4 w-4" />Back to Lesson Plans</Button>
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-glow" aria-hidden>
            <ClipboardList className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-fg">Lesson Plan View</h1>
            <p className="text-sm text-ink-300">Review and download your lesson plan</p>
          </div>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-end gap-2 pb-6 pt-8 print:hidden">
        {!readOnly && dirty && !editing && <span className="mr-auto text-sm text-warn">You have unsaved changes — click {saved ? 'Update' : 'Save'} to keep them.</span>}
        {!readOnly && (
          <Button variant="secondary" onClick={() => void save()} disabled={editing !== null || saving}
            title={editing ? 'Finish editing the open section first' : undefined}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <RotateCw className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {saving ? 'Saving…' : saved ? 'Update' : 'Save'}
          </Button>
        )}
        <Button variant="secondary" onClick={downloadPdf}><Download className="h-4 w-4" />Download PDF</Button>
        <Button variant="secondary" onClick={() => void downloadWord()} disabled={wordBusy}>
          {wordBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          {wordBusy ? 'Generating…' : 'Download Word'}
        </Button>
      </div>

      <Card className="mx-auto w-full max-w-5xl overflow-hidden animate-fade-up">
        <Banner schoolName={meta.schoolName} academicYear={meta.academicYear} />

        <div className="grid grid-cols-2 gap-6 border-b border-line bg-ink-800/40 p-6 md:grid-cols-3 md:p-8">
          <MetaColumn>
            <MetaField label="Class" value={model.grade} />
            <MetaField label="Duration(mins)" value={model.duration} />
            <MetaField label="Execution Period" value={model.executionPeriod} />
          </MetaColumn>
          <MetaColumn>
            <MetaField label="Subject" value={model.subject} />
            <MetaField label="Teacher's Name" value={meta.teacherName} />
          </MetaColumn>
          <MetaColumn>
            <MetaField label="Topic" value={model.topic} />
            <MetaField label="Planned Date" value={model.plannedDate} />
          </MetaColumn>
        </div>

        <div className="flex flex-col gap-12 p-4 pt-8 md:p-8">
          <CoreObjectivesSection {...sectionProps('core')} />
          <OutcomesSection {...sectionProps('elo')} />
          <AssessmentSection {...sectionProps('assess')} />
          {model.assignments.length > 0 && <AssignmentsSection {...sectionProps('assign')} />}
          {model.fiveE.length > 0 && <LearningExperienceSection {...sectionProps('5e')} />}
          {model.design.length > 0 && <FiveEDesignSection {...sectionProps('fed')} />}
        </div>
      </Card>

      {confirmLeave && (
        <ConfirmDialog title="Discard unsaved changes?" confirmLabel="Discard changes"
          message="Your edits to this lesson plan have not been saved. Leave without saving them?"
          onClose={() => setConfirmLeave(false)} onConfirm={() => { setConfirmLeave(false); onBack() }} />
      )}
    </div>
  )
}

/** Card banner: logo-or-initials tile, school name, "UNIT PLAN", academic year. EduAI has no school logo yet. */
function Banner({ schoolName, academicYear }: { schoolName: string; academicYear: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-5 border-b border-line bg-gradient-to-r from-brand-500/5 to-brand-500/10 p-6 md:p-8">
      <div className="flex min-w-0 items-center gap-6">
        <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-fg text-lg font-bold text-white shadow-lg" aria-hidden>
          {schoolInitials(schoolName)}
        </div>
        <div className="min-w-0">
          <p className="mb-1 break-words font-display text-2xl font-bold text-fg">{schoolName || '—'}</p>
          <p className="font-display text-xl font-semibold tracking-wider text-brand-600">UNIT PLAN</p>
        </div>
      </div>
      <div className="text-right text-ink-500">
        <div className="text-sm">Academic Year</div>
        <div className="font-semibold">{academicYear || '—'}</div>
      </div>
    </div>
  )
}

const MetaColumn = ({ children }: { children: ReactNode }) => <div className="flex min-w-0 flex-col gap-4">{children}</div>
