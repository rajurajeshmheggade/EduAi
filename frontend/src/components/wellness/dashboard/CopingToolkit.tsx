import { ChevronDown, FlaskConical, Leaf } from 'lucide-react'
import { useWellness } from '@/components/wellness/WellnessContext'

/** The server's groundtruth coping techniques (MindAlign backend `meta.coping`), which had no UI in MindAlign. */
export function CopingToolkit() {
  const { meta } = useWellness()
  const techniques = meta?.coping ?? []
  if (!techniques.length) return null

  return (
    <section className="glass rounded-2xl p-5" aria-labelledby="coping-title">
      <h3 id="coping-title" className="flex items-center gap-2 text-base font-semibold">
        <Leaf className="h-5 w-5 text-teal-600" aria-hidden /> Evidence-based coping toolkit
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-500">Quick, research-backed techniques Aura draws on. Open one and try it when stress spikes.</p>
      <ul className="mt-4 space-y-2">
        {techniques.map((t) => (
          <li key={t.name}>
            <details className="group rounded-xl border border-teal-500/20 bg-teal-500/5 open:bg-teal-500/10">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium text-fg [&::-webkit-details-marker]:hidden">
                {t.name}
                <ChevronDown className="h-4 w-4 shrink-0 text-ink-500 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="space-y-2 px-3.5 pb-3 text-xs leading-relaxed">
                <p className="text-ink-300">{t.protocol}</p>
                <p className="flex gap-1.5 text-ink-500">
                  <FlaskConical className="mt-px h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden />
                  <span><b className="font-semibold text-ink-300">Why it works:</b> {t.scientific_basis}</span>
                </p>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  )
}
