import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BarChart3, ClipboardList, Radio, Rocket, Users } from 'lucide-react'
import { CandidatesTab } from '@/components/admission-test/CandidatesTab'
import { LaunchTab } from '@/components/admission-test/LaunchTab'
import { LiveTab } from '@/components/admission-test/LiveTab'
import { ResultsTab } from '@/components/admission-test/ResultsTab'
import { TestsTab } from '@/components/admission-test/TestsTab'
import { ErrorState } from '@/components/ui/loading'
import { Tabs } from '@/components/ui/tabs'
import { errorMessage } from '@/services/apiClient'
import { admissionTestService as svc, type AdmTest, type Candidate } from '@/services/admissionTestService'

type Tab = 'tests' | 'candidates' | 'launch' | 'live' | 'results'
const TABS: Tab[] = ['tests', 'candidates', 'launch', 'live', 'results']

/** Teacher → Assessments → Admissions: build tests, manage candidates, launch, monitor live, read results. */
export default function TeacherAdmissions() {
  const [params, setParams] = useSearchParams()
  const tab = (TABS as string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'tests'
  const [tests, setTests] = useState<AdmTest[] | null>(null)
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadTests = useCallback(() => svc.tests().then(setTests).catch((e) => setError(errorMessage(e))), [])
  const loadCandidates = useCallback(() => svc.candidates().then(setCandidates).catch((e) => setError(errorMessage(e))), [])
  useEffect(() => { void loadTests(); void loadCandidates() }, [loadTests, loadCandidates])

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <header className="animate-fade-up">
        <h1 className="font-display text-3xl font-bold">Admission <span className="text-gradient">tests</span></h1>
        <p className="mt-1 text-sm text-ink-300">Build a test from your own Assignments and Online tests plus an HQ section, launch it for a candidate on
          this device, and read a proctored, AI-scored report.</p>
      </header>
      <Tabs items={[{ id: 'tests', label: 'Tests', icon: ClipboardList, count: tests?.length }, { id: 'candidates', label: 'Candidates', icon: Users, count: candidates?.length },
        { id: 'launch', label: 'Launch', icon: Rocket }, { id: 'live', label: 'Live monitor', icon: Radio }, { id: 'results', label: 'Results', icon: BarChart3 }]}
        value={tab} onChange={(t) => setParams({ tab: t })} />
      {error && <ErrorState title="Couldn’t load admission tests" message={error} onRetry={() => { setError(null); void loadTests(); void loadCandidates() }} />}
      {tab === 'tests' && <TestsTab tests={tests} />}
      {tab === 'candidates' && <CandidatesTab candidates={candidates} reload={() => void loadCandidates()} />}
      {tab === 'launch' && <LaunchTab tests={tests} candidates={candidates} />}
      {tab === 'live' && <LiveTab />}
      {tab === 'results' && <ResultsTab tests={tests} />}
    </div>
  )
}
