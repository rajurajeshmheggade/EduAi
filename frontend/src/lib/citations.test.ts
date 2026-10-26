import { describe, expect, it } from 'vitest'
import { citedPages, parseCitations } from './citations'

describe('parseCitations', () => {
  it('splits text and [Page N] citations in order', () => {
    const segs = parseCitations('Force equals mass times acceleration [Page 14]. See also [Page 3].')
    expect(segs.map((s) => s.type)).toEqual(['text', 'cite', 'text', 'cite', 'text'])
    expect(segs[1]).toMatchObject({ type: 'cite', page: 14 })
    expect(segs[3]).toMatchObject({ type: 'cite', page: 3 })
  })

  it('supports section suffixes and is case-insensitive', () => {
    const segs = parseCitations('x [page 14, Section 2.3] y')
    expect(segs[1]).toMatchObject({ type: 'cite', page: 14 })
  })

  it('returns plain text untouched and ignores malformed markers', () => {
    expect(parseCitations('no citations [Page] [Page x]')).toEqual([{ type: 'text', text: 'no citations [Page] [Page x]' }])
  })

  it('citedPages returns unique sorted pages', () => {
    expect(citedPages('a [Page 9] b [Page 2] c [Page 9]')).toEqual([2, 9])
  })
})
