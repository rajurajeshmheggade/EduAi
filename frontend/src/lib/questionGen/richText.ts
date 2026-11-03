/* Rich text for questions: allow-list sanitiser, plain text, and equation rendering with KaTeX.

   Stored question HTML is a small subset — b/strong/i/em/u/sub/sup/br/p/div/ul/ol/li and
   `<span class="math" data-latex="…">` for equations (the backend sanitises the same way, richtext.py). Anything
   that comes back from the server or is pasted into the editor is rebuilt from scratch here: no attribute except
   data-latex survives, so no handler, style, href or src can get through. Equations are rendered by KaTeX from the
   LaTeX AFTER sanitising (KaTeX escapes its input and runs with trust: false), never from stored markup. */

import katex from 'katex'

const ALLOWED = new Set(['b', 'strong', 'i', 'em', 'u', 'sub', 'sup', 'br', 'p', 'div', 'ul', 'ol', 'li'])
const DROP = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'head',
  'title', 'textarea', 'select', 'option', 'button', 'input', 'link', 'meta', 'base', 'canvas', 'audio', 'video', 'img',
  'picture', 'form',
])
export const MAX_LATEX = 1000

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export const escapeAttr = (s: string) => escapeHtml(s).replace(/"/g, '&quot;')

export function mathSpan(latex: string, display = false): string {
  const l = latex.trim().slice(0, MAX_LATEX)
  return `<span class="math" data-latex="${escapeAttr(l)}"${display ? ' data-display="block"' : ''}>${escapeHtml(l)}</span>`
}

function walk(node: Node): string {
  let out = ''
  node.childNodes.forEach((n) => {
    if (n.nodeType === 3) { out += escapeHtml(n.textContent ?? ''); return }
    if (n.nodeType !== 1) return
    const el = n as Element
    const tag = el.tagName.toLowerCase()
    if (DROP.has(tag)) return
    if (tag === 'span' && el.classList.contains('math') && el.getAttribute('data-latex')) {
      out += mathSpan(el.getAttribute('data-latex') ?? '', el.getAttribute('data-display') === 'block')
      return
    }
    if (!ALLOWED.has(tag)) { out += walk(n); return }
    out += tag === 'br' ? '<br>' : `<${tag}>${walk(n)}</${tag}>`
  })
  return out
}

const EMPTY_EDGE = /^(?:\s|<br>|<p>(?:\s|<br>)*<\/p>|<div>(?:\s|<br>)*<\/div>)+|(?:\s|<br>|<p>(?:\s|<br>)*<\/p>|<div>(?:\s|<br>)*<\/div>)+$/g

/** Rebuild `html` keeping only the allowed formatting and equation spans. */
export function sanitizeRich(html: unknown): string {
  const src = typeof html === 'string' ? html : html == null ? '' : String(html)
  if (!src.trim()) return ''
  if (typeof DOMParser === 'undefined') return escapeHtml(src.replace(/<[^>]*>/g, ' '))
  const doc = new DOMParser().parseFromString(`<!DOCTYPE html><html><body>${src}</body></html>`, 'text/html')
  return walk(doc.body).replace(EMPTY_EDGE, '').trim()
}

/** Plain text (equations as $latex$ or as their LaTeX source). */
export function plainText(html: string | null | undefined, math: 'latex' | 'raw' = 'latex'): string {
  if (!html) return ''
  const s = html
    .replace(/<span class="math" data-latex="([^"]*)"[^>]*>[\s\S]*?<\/span>/g, (_, l: string) => {
      const latex = decodeEntities(l)
      return math === 'latex' ? ` $${latex}$ ` : ` ${latex} `
    })
    .replace(/<\/(p|div|li)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  return decodeEntities(s).replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
}

export function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
}

/** Plain user text → stored rich text (escaped, line breaks kept, $…$ becomes an equation). */
export function fromPlain(text: string): string {
  return text.split(/(?<!\\)\$([^$\n]{1,1000})\$/).map((part, i) => (i % 2 ? mathSpan(part) : escapeHtml(part).replace(/\n/g, '<br>'))).join('').trim()
}

export function renderLatex(latex: string, { display = false, output = 'html' }: { display?: boolean; output?: 'html' | 'mathml' } = {}): string {
  try {
    return katex.renderToString(latex, { throwOnError: false, displayMode: display, output, trust: false, strict: 'ignore', maxSize: 20, maxExpand: 200 })
  } catch {
    return `<code>${escapeHtml(latex)}</code>`
  }
}

/** Sanitise, then render every equation span with KaTeX — the HTML to put on screen (or in a print document). */
export function renderRich(html: string | null | undefined, opts: { output?: 'html' | 'mathml' } = {}): string {
  const safe = sanitizeRich(html ?? '')
  return safe.replace(/<span class="math" data-latex="([^"]*)"( data-display="block")?>[\s\S]*?<\/span>/g,
    (_, l: string, block?: string) => `<span class="qg-math">${renderLatex(decodeEntities(l), { display: !!block, output: opts.output })}</span>`)
}

/** Visible length of rich text (RAPID questionLimits.ts plainLength rule: tags never count). */
export const plainLength = (html: string | null | undefined) => plainText(html).length
