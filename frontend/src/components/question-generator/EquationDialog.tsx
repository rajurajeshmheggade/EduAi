import { useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Label, Textarea } from '@/components/ui/field'
import { MAX_LATEX, renderLatex } from '@/lib/questionGen/richText'

/* LaTeX equation editor with a live KaTeX preview and one-click snippets for the structures school papers use. */

const SNIPPETS: { label: string; latex: string; caret?: number }[] = [
  { label: 'a/b', latex: '\\frac{}{}', caret: 6 },
  { label: 'x²', latex: '^{}', caret: 2 },
  { label: 'x₂', latex: '_{}', caret: 2 },
  { label: '√x', latex: '\\sqrt{}', caret: 6 },
  { label: 'ⁿ√x', latex: '\\sqrt[]{}', caret: 6 },
  { label: '×', latex: '\\times ' },
  { label: '÷', latex: '\\div ' },
  { label: '±', latex: '\\pm ' },
  { label: '≤', latex: '\\leq ' },
  { label: '≥', latex: '\\geq ' },
  { label: '≠', latex: '\\neq ' },
  { label: '≈', latex: '\\approx ' },
  { label: '→', latex: '\\rightarrow ' },
  { label: '⇌', latex: '\\rightleftharpoons ' },
  { label: '°', latex: '^{\\circ}' },
  { label: 'π', latex: '\\pi ' },
  { label: 'θ', latex: '\\theta ' },
  { label: 'α', latex: '\\alpha ' },
  { label: 'β', latex: '\\beta ' },
  { label: 'λ', latex: '\\lambda ' },
  { label: 'μ', latex: '\\mu ' },
  { label: 'Ω', latex: '\\Omega ' },
  { label: 'Δ', latex: '\\Delta ' },
  { label: '∑', latex: '\\sum_{}^{}', caret: 6 },
  { label: '∫', latex: '\\int_{}^{}', caret: 6 },
  { label: 'v⃗', latex: '\\vec{}', caret: 5 },
  { label: 'text', latex: '\\text{}', caret: 6 },
]

export function EquationDialog({ initial, onInsert, onClose }: { initial: string; onInsert: (latex: string) => void; onClose: () => void }) {
  const [latex, setLatex] = useState(initial)
  const ta = useRef<HTMLTextAreaElement>(null)
  const preview = useMemo(() => (latex.trim() ? renderLatex(latex, { display: true }) : ''), [latex])

  const add = (s: { latex: string; caret?: number }) => {
    const el = ta.current
    const start = el?.selectionStart ?? latex.length
    const end = el?.selectionEnd ?? latex.length
    const next = (latex.slice(0, start) + s.latex + latex.slice(end)).slice(0, MAX_LATEX)
    setLatex(next)
    const caret = start + (s.caret ?? s.latex.length)
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(caret, caret) })
  }

  return (
    <Dialog open onClose={onClose} title={initial ? 'Edit equation' : 'Insert equation'} description="Type LaTeX, or use the buttons. The preview shows how it prints." className="w-[min(40rem,calc(100vw-2rem))]">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1" aria-label="Equation snippets">
          {SNIPPETS.map((s) => (
            <button key={s.label} type="button" onClick={() => add(s)} title={s.latex.trim()}
              className="min-w-8 cursor-pointer rounded-md border border-line bg-ink-800 px-2 py-1 text-sm hover:border-brand-400/60 hover:text-brand-600">{s.label}</button>
          ))}
        </div>
        <div>
          <Label htmlFor="qg-latex">LaTeX</Label>
          <Textarea id="qg-latex" ref={ta} rows={3} value={latex} maxLength={MAX_LATEX} autoFocus spellCheck={false}
            onChange={(e) => setLatex(e.target.value)} className="font-mono text-[13px]" placeholder="e.g. v = u + at   or   \frac{1}{2}mv^2" />
        </div>
        <div aria-live="polite" className="min-h-14 overflow-x-auto rounded-xl border border-dashed border-line bg-white p-3 text-center text-black">
          {preview ? <span dangerouslySetInnerHTML={{ __html: preview }} /> : <span className="text-sm text-ink-500">Preview</span>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => latex.trim() && onInsert(latex.trim())} disabled={!latex.trim()}>{initial ? 'Update' : 'Insert'}</Button>
        </div>
      </div>
    </Dialog>
  )
}
