import { useLocation } from 'react-router-dom'
import { PageLoader, SkeletonPage } from '@/components/ui/loading'
import { useLoadingSignal } from '@/lib/navProgress'

type Variant = 'dashboard' | 'table' | 'cards' | 'detail'

const VARIANTS: [RegExp, Variant][] = [
  [/dashboard/, 'dashboard'],
  [/\/(library\/read|library\/diksha|classroom\/nlp|virtual-labs\/[^/]+|admissions\/reports|admission-reports|tests\/[^/]+\/take)/, 'detail'],
  [/\/(timetable|attendance|homework|evaluation|tests|assignments|admissions|classes)/, 'table'],
  [/\/(library|virtual-labs|classroom|lesson-plans|wellness|wellbeing|evaluations|parent)/, 'cards'],
]

/** Shown inside the shell while a page's code downloads: the sidebar stays put and the placeholder is shaped like
 * the page that is coming (the AI Classroom gets its own loader message). */
export function RouteFallback() {
  const { pathname } = useLocation()
  useLoadingSignal(true)
  if (pathname.startsWith('/student/classroom/textbook')) return <PageLoader message="Opening your AI classroom…" className="min-h-[60vh]" />
  const variant = VARIANTS.find(([re]) => re.test(pathname))?.[1] ?? 'dashboard'
  return <SkeletonPage variant={variant} className="mx-auto max-w-7xl p-4 md:p-8" />
}
