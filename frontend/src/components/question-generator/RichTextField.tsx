import { useEffect, useId, useRef, useState } from 'react'
import { Bold, Italic, List, ListOrdered, Sigma, Subscript, Superscript, Underline, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { escapeAttr, plainLength, renderLatex, sanitizeRich } from '@/lib/questionGen/richText'
import { EquationDialog } from './EquationDialog'

/* A contentEditable rich-text field for question text, options and answers: bold / italic / underline,
   sub- and superscript, lists, and equations (KaTeX). Uncontrolled like the lesson-plan DescEditor: the HTML is
   loaded when `resetKey` changes, never on every keystroke (that would throw the caret to the start).

   Equations live in the editor as non-editable chips that show the rendered formula; reading the value back
   turns each chip into the stored `<span class="math" data-latex>` form and the whole value is sanitised. */

const TOOLS: { cmd: string; label: string; Icon: LucideIcon }[] = [
  { cmd: 'bold', label: 'Bold', Icon: Bold },
  { cmd: 'italic', label: 'Italic', Icon: Italic },
  { cmd: 'underline', label: 'Underline', Icon: Underline },
  { cmd: 'subscript', label: 'Subscript', Icon: Subscript },
  { cmd: 'superscript', label: 'Superscript', Icon: Superscript },
  { cmd: 'insertUnorderedList', label: 'Bulleted list', Icon: List },
  { cmd: 'insertOrderedList', label: 'Numbered list', Icon: ListOrdered },
]

/** Stored HTML → editor HTML (equation spans become rendered, non-editable chips). */
function toEditorHtml(stored: string): string {
  return sanitizeRich(stored).replace(/<span class="math" data-latex="([^"]*)"( data-display="block")?>[\s\S]*?<\/span>/g,
    (_, l: string) => chip(l.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')))
}

function chip(latex: string): string {
  return `<span class="math qg-eq" data-latex="${escapeAttr(latex)}" contenteditable="false" title="Click to edit the equation">${renderLatex(latex)}</span>`
}

/** Editor DOM → stored HTML. */
const fromEditorHtml = (el: HTMLElement) => sanitizeRich(readChips(el))

/** Walk the live editor and serialise it, replacing each equation chip by its stored span. */
function readChips(el: HTMLElement): string {
  const copy = el.cloneNode(true) as HTMLElement
  copy.querySelectorAll('span.qg-eq').forEach((s) => {
    const latex = s.getAttribute('data-latex') ?? ''
    const span = document.createElement('span')
    span.className = 'math'
    span.setAttribute('data-latex', latex)
    span.textContent = latex
    s.replaceWith(span)
  })
  return copy.innerHTML
}

export function RichTextField({ value, onChange, resetKey, label, placeholder, limit, minRows = 2, compact, invalid, id }: {
  value: string
  onChange: (html: string) => void
  /** Reload the editor content when this changes (e.g. the question being edited). */
  resetKey: string
  label: string
  placeholder?: string
  limit?: number
  minRows?: number
  compact?: boolean
  invalid?: boolean
  id?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const autoId = useId()
  const fieldId = id ?? autoId
  const valueRef = useRef(value)
  useEffect(() => { valueRef.current = value })
  const [eq, setEq] = useState<{ latex: string; target: HTMLElement | null } | null>(null)
  const savedRange = useRef<Range | null>(null)
  const [count, setCount] = useState(() => plainLength(value))

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = toEditorHtml(valueRef.current || '')
    setCount(plainLength(valueRef.current))
  }, [resetKey])

  const emit = () => {
    const el = ref.current
    if (!el) return
    const html = fromEditorHtml(el)
    setCount(plainLength(html))
    onChange(html)
  }

  const cmd = (c: string) => {
    ref.current?.focus()
    // execCommand is deprecated but remains the only built-in rich-text toolbar for a contentEditable.
    document.execCommand(c, false)
    emit()
  }

  const openEquation = (target: HTMLElement | null) => {
    const sel = window.getSelection()
    savedRange.current = sel && sel.rangeCount && ref.current?.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null
    setEq({ latex: target?.getAttribute('data-latex') ?? '', target })
  }

  const insertEquation = (latex: string) => {
    const el = ref.current
    if (!el) return
    const html = chip(latex)
    if (eq?.target && el.contains(eq.target)) {
      const tmp = document.createElement('span')
      tmp.innerHTML = html
      eq.target.replaceWith(tmp.firstChild as Node)
    } else {
      const tmp = document.createElement('span')
      tmp.innerHTML = html + ' '
      const range = savedRange.current
      if (range && el.contains(range.startContainer)) {
        range.deleteContents()
        const frag = document.createDocumentFragment()
        while (tmp.firstChild) frag.appendChild(tmp.firstChild)
        range.insertNode(frag)
      } else {
        while (tmp.firstChild) el.appendChild(tmp.firstChild)
      }
    }
    setEq(null)
    emit()
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={fieldId} className="block text-xs font-medium uppercase tracking-wide text-ink-300">{label}</label>
        {limit ? <span className={cn('text-[11px] tabular-nums', count > limit ? 'text-bad' : 'text-ink-500')}>{count}/{limit}</span> : null}
      </div>
      <div className={cn('overflow-hidden rounded-xl border bg-ink-900/70 focus-within:border-brand-400/70 focus-within:ring-2 focus-within:ring-brand-500/30',
        invalid ? 'border-bad/60' : 'border-line')}>
        <div className="flex flex-wrap gap-0.5 border-b border-line bg-ink-800/60 px-1.5 py-1" role="toolbar" aria-label={`${label} formatting`}>
          {TOOLS.filter((t) => !compact || !t.cmd.startsWith('insert')).map(({ cmd: c, label: l, Icon }) => (
            <button key={c} type="button" title={l} aria-label={l} onMouseDown={(e) => e.preventDefault()} onClick={() => cmd(c)}
              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-ink-300 hover:bg-brand-500/12 hover:text-brand-600">
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
          <button type="button" title="Insert equation" aria-label="Insert equation" onMouseDown={(e) => e.preventDefault()} onClick={() => openEquation(null)}
            className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs text-ink-300 hover:bg-brand-500/12 hover:text-brand-600">
            <Sigma className="h-3.5 w-3.5" /> Equation
          </button>
        </div>
        <div ref={ref} id={fieldId} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={label}
          aria-invalid={invalid || undefined} data-placeholder={placeholder}
          onInput={emit} onBlur={emit}
          onClick={(e) => {
            const t = (e.target as HTMLElement).closest('span.qg-eq') as HTMLElement | null
            if (t) openEquation(t)
          }}
          onPaste={(e) => {
            // paste as plain text: formatting from other apps is not trusted
            e.preventDefault()
            document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
          }}
          style={{ minHeight: `${minRows * 1.6 + 1}rem` }}
          className="qg-rich lp-rich-editor px-3 py-2 text-sm leading-relaxed text-fg outline-none" />
      </div>
      {eq && <EquationDialog initial={eq.latex} onClose={() => setEq(null)} onInsert={insertEquation} />}
    </div>
  )
}
