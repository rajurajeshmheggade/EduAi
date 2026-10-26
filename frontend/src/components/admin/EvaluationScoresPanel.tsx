import { useEffect, useMemo, useState } from 'react'
import { ScanText } from 'lucide-react'
import { ResultsStep } from '@/components/evaluation/ResultsStep'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/field'
import { adminService } from '@/services/adminService'
import { errorMessage } from '@/services/apiClient'
import { evaluationService } from '@/services/evaluationService'
import type { AssessmentType, EvalTest, SchoolClass } from '@/types'

/** FR-EV-13: Class -> Subject -> Test explorer with the all-student score register, analytics and CSV (read-only). */
export function EvaluationScoresPanel({ org }: { org?: string | null }) {
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [klass, setKlass] = useState('')
  const [subject, setSubject] = useState('')
  const [tests, setTests] = useState<EvalTest[] | null>(null)
  const [testId, setTestId] = useState('')
  const [kind, setKind] = useState<AssessmentType | ''>('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { adminService.classes(org).then((c) => setClasses(c)).catch((e) => setError(errorMessage(e))) }, [org])
  useEffect(() => {
    setTests(null); setTestId('')
    evaluationService.adminScores({ class_code: klass || undefined, subject_code: subject || undefined, assessment_type: kind || undefined }, org)
      .then((r) => setTests(r.tests)).catch((e) => setError(errorMessage(e)))
  }, [klass, subject, kind, org])

  const cls = classes.find((c) => c.class_code === klass)
  const test = useMemo(() => tests?.find((t) => t.eval_test_id === testId), [tests, testId])

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ScanText className="h-5 w-5 text-brand-600" /> Assessment score register</CardTitle>
          <CardDescription>Choose class → subject → type → test or assignment to see every student’s score, including those who haven’t submitted.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <Select aria-label="Class" id="es-class" value={klass} onChange={(e) => { setKlass(e.target.value); setSubject('') }}>
            <option value="">All classes</option>
            {classes.map((c) => <option key={c.class_code} value={c.class_code}>{c.class_name}</option>)}
          </Select>
          <Select aria-label="Subject" id="es-subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!cls}>
            <option value="">All subjects</option>
            {cls?.subjects.map((s) => <option key={s.subject_code} value={s.subject_code}>{s.subject_name}</option>)}
          </Select>
          <Select aria-label="Assessment type" id="es-type" value={kind} onChange={(e) => setKind(e.target.value as AssessmentType | '')}>
            <option value="">All types</option><option value="ONLINE_TEST">Online tests</option><option value="ASSIGNMENT">Assignments</option><option value="OFFLINE_EXAM">Offline exams</option>
          </Select>
          <Select aria-label="Test" id="es-test" value={testId} onChange={(e) => setTestId(e.target.value)} disabled={!tests?.length}>
            <option value="">{tests === null ? 'Loading…' : tests.length ? `Choose a test (${tests.length})` : 'No evaluations yet'}</option>
            {tests?.map((t) => <option key={t.eval_test_id} value={t.eval_test_id}>{t.test_title} — {t.class_code} · {t.subject_code} ({t.evaluated} evaluated)</option>)}
          </Select>
        </CardContent>
      </Card>
      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      {test && <ResultsStep key={test.eval_test_id} test={test} readOnly org={org} onChanged={() => {}} />}
    </div>
  )
}
