import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@/components/ui/toast'
import { celebrate, useWellness } from '@/components/wellness/WellnessContext'
import { errorMessage } from '@/services/apiClient'
import { wellnessService } from '@/services/wellnessService'
import type { Helpline, JournalEntry } from '@/types/wellness'
import { AnalysisResult } from './AnalysisResult'
import { EntryPreview } from './EntryPreview'
import { JournalComposer } from './JournalComposer'
import { JournalHistory } from './JournalHistory'
import { formatEntryDate, MIN_JOURNAL_CHARS, prefersReducedMotion } from './journalFormat'

const DimensionalAnalysisVisualizer = lazy(() => import('@/components/wellness/three/DimensionalAnalysisVisualizer'))

/** Student ▸ Wellness ▸ Journal — MindAlign JournalAnalyzer: write, get an AI analysis, tick coping steps, browse history. */
export function JournalTab() {
  const { applyXp, setStats, setAnalyzing, confirm } = useWellness()
  const [entries, setEntries] = useState<JournalEntry[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [stress, setStress] = useState(50)
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Helplines come back only with the analyse call, so they are remembered for that one entry.
  const [crisis, setCrisis] = useState<{ id: string; helplines: Record<string, Helpline> } | null>(null)
  const [pendingCoping, setPendingCoping] = useState<{ id: string; title: string } | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  const load = useCallback(() => wellnessService.journals(50)
    .then((xs) => { setEntries(xs); setLoadError(null) })
    .catch((e: unknown) => setLoadError(errorMessage(e, 'Could not load your journal history'))), [])
  useEffect(() => { void load() }, [load])

  // Leaving the tab mid-analysis must not leave the 3D background stuck in "analysing" mode.
  useEffect(() => () => setAnalyzing(false), [setAnalyzing])

  const selected = entries?.find((e) => e.id === selectedId) ?? null
  const patchEntry = (id: string, copingDone: string[]) =>
    setEntries((xs) => xs?.map((x) => (x.id === id ? { ...x, copingDone } : x)) ?? xs)

  const analyze = async () => {
    const body = text.trim()
    if (body.length < MIN_JOURNAL_CHARS || loading) return
    setLoading(true)
    setAnalyzing(true)
    setSelectedId(null)
    try {
      const r = await wellnessService.analyzeJournal(body, stress)
      setEntries((xs) => [r.entry, ...(xs ?? []).filter((x) => x.id !== r.entry.id)])
      setSelectedId(r.entry.id)
      setCrisis(r.helplines ? { id: r.entry.id, helplines: r.helplines } : null)
      setStats(r.stats)
      applyXp(r.xpResult, 'Expressive Journaling')
      // No celebration on top of an entry that needed the helplines.
      if (!r.helplines) celebrate({ particleCount: 80, spread: 60, origin: { y: 0.8 }, colors: ['#8b5cf6', '#14b8a6', '#22c55e'] })
      setText('')
    } catch (e) {
      toast(errorMessage(e, 'Could not analyse your journal right now. Your text is still here — please try again.'), 'error')
    } finally {
      setLoading(false)
      setAnalyzing(false)
    }
  }

  const toggleCoping = async (entry: JournalEntry, title: string) => {
    if (pendingCoping) return
    const before = entry.copingDone ?? []
    const done = !before.includes(title)
    setPendingCoping({ id: entry.id, title })
    patchEntry(entry.id, done ? [...before, title] : before.filter((t) => t !== title))
    try {
      const r = await wellnessService.coping(entry.id, title, done)
      patchEntry(entry.id, r.copingDone)
      if (done) {
        applyXp(r.xpResult, 'Coping Task Completed')
        celebrate({ particleCount: 30, spread: 55, origin: { y: 0.75 } })
      }
    } catch (e) {
      patchEntry(entry.id, before)
      toast(errorMessage(e, 'Could not save that step. Please try again.'), 'error')
    } finally {
      setPendingCoping(null)
    }
  }

  const selectPast = (entry: JournalEntry) => {
    setSelectedId(entry.id)
    // Bring the entry preview into view (the history list can be far from it on small screens)
    window.setTimeout(() => previewRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' }), 50)
  }

  const remove = async (entry: JournalEntry) => {
    setDeletingId(entry.id)
    try {
      const r = await wellnessService.deleteJournal(entry.id)
      setEntries((xs) => xs?.filter((x) => x.id !== entry.id) ?? xs)
      setSelectedId((id) => (id === entry.id ? null : id))
      setCrisis((c) => (c?.id === entry.id ? null : c))
      setStats(r.stats)
      toast('Journal entry deleted', 'success')
    } catch (e) {
      toast(errorMessage(e, 'Could not delete this entry'), 'error')
    } finally {
      setDeletingId(null)
    }
  }
  const askDelete = (entry: JournalEntry) =>
    confirm(
      'Delete Journal Entry',
      `Permanently delete your ${entry.kind === 'checkin' ? 'mood check-in' : 'journal entry'} from ${formatEntryDate(entry.date)}? Its analysis and coping progress will be removed too, and Aura will no longer reference it.`,
      () => { void remove(entry) },
    )

  return (
    <div className="grid items-start gap-5 lg:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-5 lg:col-span-2">
        <JournalComposer text={text} onText={setText} stress={stress} onStress={setStress} loading={loading} onSubmit={() => void analyze()} />

        {loading && (
          <div className="animate-fade-up" role="status" aria-live="polite">
            <span className="sr-only">Analyzing your journal entry…</span>
            <Suspense fallback={<div className="skeleton h-64" />}>
              <DimensionalAnalysisVisualizer isAnalyzing />
            </Suspense>
          </div>
        )}

        {selected && !loading && (
          <div className="flex flex-col gap-5">
            <div ref={previewRef} className="flex scroll-mt-4 flex-col gap-5">
              <EntryPreview
                entry={selected}
                helplines={crisis?.id === selected.id ? crisis.helplines : null}
                deleting={deletingId === selected.id}
                onDelete={askDelete}
              />
            </div>
            <Suspense fallback={null}>
              <DimensionalAnalysisVisualizer isAnalyzing={false} analysisResult={selected.analysis} />
            </Suspense>
            <AnalysisResult
              entry={selected}
              pendingTitle={pendingCoping?.id === selected.id ? pendingCoping.title : null}
              onToggleCoping={(entry, title) => void toggleCoping(entry, title)}
            />
          </div>
        )}
      </div>

      <JournalHistory entries={entries} error={loadError} selectedId={selectedId} onSelect={selectPast} onRetry={() => { setLoadError(null); void load() }} />
    </div>
  )
}
