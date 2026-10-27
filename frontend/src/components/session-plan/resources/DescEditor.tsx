import { useEffect, useRef } from 'react'
import { Bold, FileText, Italic, List, ListIndentDecrease, ListIndentIncrease, ListOrdered, type LucideIcon } from 'lucide-react'
import { sanitizeHtml } from '../sanitizeHtml'

/* The stage Description editor — a contentEditable driven by execCommand, exactly like Rapid. It stores HTML.
   Uncontrolled: the HTML is set only when the stage changes; re-setting innerHTML on every keystroke would
   throw the caret back to the start. What is loaded into it is sanitised first (a saved row is untrusted). */

const TB: { c: string; t: string; Icon: LucideIcon }[] = [
  { c: 'bold', t: 'Bold', Icon: Bold },
  { c: 'italic', t: 'Italic', Icon: Italic },
  { c: 'insertOrderedList', t: 'Numbered list', Icon: ListOrdered },
  { c: 'insertUnorderedList', t: 'Bulleted list', Icon: List },
  { c: 'outdent', t: 'Decrease indent', Icon: ListIndentDecrease },
  { c: 'indent', t: 'Increase indent', Icon: ListIndentIncrease },
]

export function DescEditor({ stage, value, onChange }: { stage: string; value: string; onChange: (html: string) => void }) {
  const edRef = useRef<HTMLDivElement>(null)
  // Read through a ref so the stage-change effect below always loads the CURRENT value of the new stage.
  const valueRef = useRef(value)
  useEffect(() => { valueRef.current = value })

  useEffect(() => {
    const el = edRef.current
    if (!el) return
    const html = sanitizeHtml(valueRef.current || '')
    if (el.innerHTML !== html) el.innerHTML = html
  }, [stage])

  const cmd = (c: string) => {
    const el = edRef.current
    if (!el) return
    el.focus()
    // execCommand is deprecated but remains the only built-in rich-text toolbar for a contentEditable.
    document.execCommand(c, false)
    onChange(el.innerHTML)
  }

  return (
    <div className="glass overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-gradient-to-b from-brand-500/[0.06] to-transparent px-4 py-3">
        <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-fg">
          <span className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-lg bg-brand-500/12 text-brand-600"><FileText className="h-3.5 w-3.5" /></span>
          Description
          <span className="rounded-full bg-brand-500/12 px-2.5 py-0.5 text-[11px] font-medium text-brand-600">{stage}</span>
        </span>
        <div className="flex gap-1" role="toolbar" aria-label="Description formatting">
          {TB.map(({ c, t, Icon }) => (
            <button key={c} type="button" title={t} aria-label={t} onMouseDown={(e) => e.preventDefault()} onClick={() => cmd(c)}
              className="inline-flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-lg text-ink-300 transition-colors hover:bg-brand-500/12 hover:text-brand-600">
              <Icon className="h-[15px] w-[15px]" />
            </button>
          ))}
        </div>
      </div>
      <div key={stage} ref={edRef} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true"
        aria-label={`Description for ${stage}`}
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
        data-placeholder="Describe this part of the session — attention getters, statement of objectives, questions asked…"
        className="lp-rich-editor min-h-[150px] p-3.5 text-[13.5px] leading-[1.65] text-fg outline-none focus-visible:rounded-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/60" />
    </div>
  )
}
