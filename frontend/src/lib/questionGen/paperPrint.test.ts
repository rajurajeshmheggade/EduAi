import { pageCounterContent, printDocumentHtml, printPaper } from './paperPrint'
import { mixedPaper } from './exportFixture.testutil'

const ctx = { media: {}, arCodes: ['Code A', 'Code B', 'Code C', 'Code D'], arInstruction: 'Choose the code.', lang: 'en' as const }

describe('print document', () => {
  it('is a complete, script-free A4 document with page numbers', () => {
    const html = printDocumentHtml(mixedPaper(), ctx, { answerKey: false })
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('size: A4')
    expect(html).toContain('counter(page)')
    expect(html).toContain('counter(pages)')
    expect(html).toContain('DRAFT')
    expect(html).toContain('Demo International School')
    expect(html).toMatch(/<div class="qg-num">1\.<\/div>/)
    expect(html).toMatch(/<div class="qg-num">7\.<\/div>/)
    expect(html).toContain('<math')                      // equations as MathML (no KaTeX fonts in the popup)
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toContain('ANSWER KEY')
  })

  it('prints the answer key and localises the page counter', () => {
    const key = printDocumentHtml(mixedPaper({ status: 'PUBLISHED' }), ctx, { answerKey: true })
    expect(key).toContain('ANSWER KEY')
    expect(key).not.toContain('DRAFT')
    expect(pageCounterContent('Page {n} of {N}')).toBe('"Page " counter(page) " of " counter(pages)')
    expect(pageCounterContent('पृष्ठ {n} / {N}')).toBe('"पृष्ठ " counter(page) " / " counter(pages)')
  })

  it('escapes hostile values', () => {
    const p = mixedPaper()
    p.header.exam_title = '</title><script>alert(1)</script>'
    p.items[0].question.text = '<img src=x onerror=alert(1)>Hi'
    const html = printDocumentHtml(p, ctx, { answerKey: false })
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toContain('onerror')
  })

  it('reports a blocked popup', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    expect(printPaper(mixedPaper(), ctx, { answerKey: false })).toBe(false)
    open.mockRestore()
  })
})
