import { buildPaperDocx, sniffImage } from './paperDocx'
import { blobBytes, mixedPaper, readZipEntry } from './exportFixture.testutil'
import { AR_LETTERS } from './paper'

const ctx = { arCodes: ['Code A text', 'Code B text', 'Code C text', 'Code D text'], arInstruction: 'Choose the correct code.', lang: 'en' as const, images: {} }

async function startsWithPK(blob: Blob) {
  const b = await blobBytes(blob)
  return b[0] === 0x50 && b[1] === 0x4b
}

describe('Word export', () => {
  it('builds a .docx question paper with real equations and the paper layout', async () => {
    const blob = await buildPaperDocx(mixedPaper(), ctx, { answerKey: false })
    expect(await startsWithPK(blob)).toBe(true)
    const xml = (await readZipEntry(blob, 'word/document.xml'))!
    expect(xml).toContain('Demo International School')
    expect(xml).toContain('Unit Test 2 — Electricity')
    expect(xml).toContain('m:oMath')
    expect(xml).toContain('m:f>')                          // \frac → a Word fraction
    expect(xml).toContain('Maximum Marks')
    expect(xml).toContain('1 hour 30 minutes')
    expect(xml).toContain('General Instructions')
    expect(xml).not.toContain('ANSWER KEY')
    // A/R directions once for the two consecutive A/R questions (Q.4–5)
    expect(xml.match(/Choose the correct code\./g)).toHaveLength(1)
    expect(xml).toContain('4–5')
    // Column II printed in its shuffled order: (a) is the first pair of right_order
    expect(xml.indexOf('measures potential difference')).toBeLessThan(xml.indexOf('measures current'))
    expect(xml).toContain('Nirmala UI')
    const footer = (await readZipEntry(blob, 'word/footer1.xml')) ?? ''
    expect(footer).toContain('PAGE')
    expect(footer).toContain('NUMPAGES')
    expect(footer).toContain('DRAFT')
  })

  it('builds the separate answer key', async () => {
    const blob = await buildPaperDocx(mixedPaper({ status: 'PUBLISHED' }), ctx, { answerKey: true })
    const xml = (await readZipEntry(blob, 'word/document.xml'))!
    expect(xml).toContain('ANSWER KEY')
    expect(xml).toContain('Ampere')                       // MCQ key
    expect(xml).toContain('Code A text')                  // A/R key with the code text
    expect(xml).toContain('ampere')                       // passage sub-question key
    expect(xml).toContain('m:oMath')                      // equation inside a model answer
    expect(xml).toContain('x²/2')                         // a short stem shows equations as readable text
    expect(xml).not.toContain('\\frac')
    expect(xml).not.toContain('General Instructions')
    expect(xml).not.toContain('Roll No.')
    const footer = (await readZipEntry(blob, 'word/footer1.xml')) ?? ''
    expect(footer).not.toContain('DRAFT')
    expect(AR_LETTERS).toHaveLength(4)
  })

  it('prints labels in the paper language', async () => {
    const blob = await buildPaperDocx(mixedPaper({ language: 'hi' }), { ...ctx, lang: 'hi' }, { answerKey: false })
    const xml = (await readZipEntry(blob, 'word/document.xml'))!
    expect(xml).toContain('अधिकतम अंक')
  })

  it('reads PNG and JPEG sizes from their headers', () => {
    const png = new Uint8Array(32)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    new DataView(png.buffer).setUint32(16, 160)
    new DataView(png.buffer).setUint32(20, 90)
    expect(sniffImage(png)).toEqual({ type: 'png', width: 160, height: 90 })
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x40, 0x00, 0x80, 0x03, 0, 0, 0, 0])
    expect(sniffImage(jpg)).toEqual({ type: 'jpg', width: 128, height: 64 })
    expect(sniffImage(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull()
  })
})
