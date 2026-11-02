import { describe, expect, it } from 'vitest'
import { fromPlain, mathSpan, plainLength, plainText, renderRich, sanitizeRich } from './richText'

describe('question rich text', () => {
  it('keeps formatting and equations, drops everything else', () => {
    const dirty = '<p onclick="x()" style="color:red">H<sub>2</sub>O and x<sup>2</sup> <b>bold</b><script>alert(1)</script>' +
      '<img src=x onerror=alert(1)><a href="javascript:alert(1)">link</a><iframe src="//evil"></iframe></p>' +
      '<span class="math" data-latex="\\frac{1}{2}" onmouseover="x()">junk</span><svg><circle/></svg>'
    const out = sanitizeRich(dirty)
    expect(out).toBe('<p>H<sub>2</sub>O and x<sup>2</sup> <b>bold</b>link</p><span class="math" data-latex="\\frac{1}{2}">\\frac{1}{2}</span>')
    expect(out).not.toMatch(/onclick|onerror|script|img|iframe|svg|style/)
  })

  it('escapes attribute breakouts inside equations', () => {
    const out = sanitizeRich('<span class="math" data-latex="&quot;&gt;<img src=x>">x</span>')
    expect(out).not.toContain('<img')
    expect(out).toContain('data-latex="&quot;&gt;&lt;img src=x&gt;"')
  })

  it('renders equations with KaTeX only after sanitising', () => {
    const html = renderRich(`Speed ${mathSpan('v = \\frac{d}{t}')}<script>x</script>`)
    expect(html).toContain('katex')
    expect(html).not.toContain('<script')
    const mathml = renderRich(mathSpan('x^2'), { output: 'mathml' })
    expect(mathml).toContain('<math')
  })

  it('converts between plain and rich text', () => {
    const rich = fromPlain('Ohm: $V = IR$ <b>not bold</b>\nline 2')
    expect(rich).toContain('<span class="math" data-latex="V = IR">')
    expect(rich).toContain('&lt;b&gt;not bold&lt;/b&gt;<br>line 2')
    expect(plainText(rich)).toBe('Ohm: $V = IR$ <b>not bold</b>\nline 2')
    expect(plainLength('<p><b>abc</b></p>')).toBe(3)
  })
})
