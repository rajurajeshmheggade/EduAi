import { useParams } from 'react-router-dom'
import { ErrorState, SkeletonPage } from '@/components/ui/loading'
import { PaperEditor } from '@/components/question-generator/PaperEditor'
import { useQgenMeta } from '@/lib/questionGen/useQgenMeta'
import { useAsync } from '@/lib/useAsync'
import { questionGenService } from '@/services/questionGenService'

/** Teacher → AI Question Generator → a question paper (editor, preview, publish, exports). */
export default function QuestionPaperEditor() {
  const { paperId = '' } = useParams()
  const meta = useQgenMeta()
  const paper = useAsync((signal) => questionGenService.paper(paperId, { signal }), [paperId])
  if (meta.error || paper.error) {
    return (
      <div className="mx-auto max-w-6xl p-4 md:p-8">
        <ErrorState title="Could not open the question paper" message={(paper.error || meta.error)!} onRetry={() => { meta.retry(); paper.retry() }} />
      </div>
    )
  }
  if (!meta.data || !paper.data) return <div className="mx-auto max-w-6xl p-4 md:p-8"><SkeletonPage variant="detail" /></div>
  return <PaperEditor key={paper.data.paper_id} initial={paper.data} meta={meta.data} onReload={paper.retry} />
}
