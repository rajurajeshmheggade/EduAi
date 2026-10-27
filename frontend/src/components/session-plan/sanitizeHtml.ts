/* Allow-list sanitiser for the stage Description HTML.

   The Description editor is a contentEditable driven by execCommand, so what it stores is HTML — and
   whatever was pasted into it, or whatever a saved session row carries back from the database. Before
   that HTML is shown again (the Preview-and-Save step, the Preview modal, the Launch window's Lesson
   plan tab) it is rebuilt from scratch here: only the formatting tags the editor itself produces survive,
   and NONE of them keep an attribute — so no handler, no style, no href/src can get through.

   Parsing happens in an inert DOMParser document (scripts never run there and images never load). */

const ALLOWED = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'p', 'ul', 'ol', 'li', 'div', 'span'])

/** Elements dropped together with everything inside them — their text is not content. */
const DROP = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'noscript', 'template', 'svg', 'math',
  'head', 'title', 'textarea', 'select', 'option', 'button', 'input', 'link', 'meta', 'base', 'canvas', 'audio', 'video',
])

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function walk(node: Node): string {
  let out = ''
  node.childNodes.forEach((n) => {
    if (n.nodeType === 3) { out += escapeText(n.textContent ?? ''); return }   // text
    if (n.nodeType !== 1) return                                                // comments, PIs …
    const tag = (n as Element).tagName.toLowerCase()
    if (DROP.has(tag)) return
    if (!ALLOWED.has(tag)) { out += walk(n); return }                           // unwrap, keep the text
    out += tag === 'br' ? '<br>' : `<${tag}>${walk(n)}</${tag}>`
  })
  return out
}

/** Rebuild `html` keeping only b/strong/i/em/u/br/p/ul/ol/li/div/span, all without attributes. */
export function sanitizeHtml(html: unknown): string {
  const src = typeof html === 'string' ? html : html == null ? '' : String(html)
  if (!src.trim()) return ''
  if (typeof DOMParser === 'undefined') return escapeText(src.replace(/<[^>]*>/g, ' '))
  const doc = new DOMParser().parseFromString(`<!DOCTYPE html><html><body>${src}</body></html>`, 'text/html')
  return walk(doc.body)
}

/** The visible text of a stored description, for "is there anything here" checks. */
export const stripHtml = (h: unknown) =>
  String(h ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim()
