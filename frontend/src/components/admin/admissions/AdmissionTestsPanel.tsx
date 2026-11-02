import { useCallback, useEffect, useState } from 'react'
import { BarChart3, ClipboardList, Users } from 'lucide-react'
import { CandidatesTab } from '@/components/admission-test/CandidatesTab'
import { ResultsTab } from '@/components/admission-test/ResultsTab'
import { TestsTab } from '@/components/admission-test/TestsTab'
import { Tabs } from '@/components/ui/tabs'
import { errorMessage } from '@/services/apiClient'
import { admissionTestService as svc, type AdmTest, type Candidate } from '@/services/admissionTestService'

type Tab = 'results' | 'tests' | 'candidates'

/** Org admins: read-only view of every admission test and result in the institution (plus candidate data deletion). */
export function AdmissionTestsPanel({ org }: { org: string | null }) {
  const scope = org ?? undefined
  const [tab, setTab] = useState<Tab>('results')
  const [tests, setTests] = useState<AdmTest[] | null>(null)
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadCandidates = useCallback(() => svc.candidates(scope).then(setCandidates).catch((e) => setError(errorMessage(e))), [scope])
  useEffect(() => {
    svc.tests(scope).then(setTests).catch((e) => setError(errorMessage(e)))
    void loadCandidates()
  }, [scope, loadCandidates])
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-300">Admission tests that teachers build, launch and score. Read only: teachers run the tests; you can open every report and delete a
        candidate's data on request.</p>
      <Tabs items={[{ id: 'results', label: 'Results', icon: BarChart3 }, { id: 'tests', label: 'Tests', icon: ClipboardList, count: tests?.length },
        { id: 'candidates', label: 'Candidates', icon: Users, count: candidates?.length }]} value={tab} onChange={setTab} />
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      {tab === 'results' && <ResultsTab tests={tests} org={scope} reportBase="/admin/admission-reports" readOnly />}
      {tab === 'tests' && <TestsTab tests={tests} readOnly />}
      {tab === 'candidates' && <CandidatesTab candidates={candidates} reload={() => void loadCandidates()} readOnly />}
    </div>
  )
}
