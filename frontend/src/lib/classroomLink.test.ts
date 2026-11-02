import { describe, expect, it } from 'vitest'
import type { Textbook } from '@/types'
import { classroomLink, parseClassroomLink, pickStart, readyTextbooks } from './classroomLink'

const book = (id: string, over: Partial<Textbook> = {}): Textbook => ({
  textbook_id: id, subject_code: 'PHY', title: id, total_pages: 120, vector_status: 'indexed', is_published_to_students: true,
  pdf_url: '', chapters: [], created_at: '', ...over,
})

describe('textbook classroom deep links', () => {
  it('builds and reads ?subject=&textbook=&page=', () => {
    const url = classroomLink({ subject: 'PHY', textbookId: 'b2', page: 41 })
    expect(url).toBe('/student/classroom/textbook?subject=PHY&textbook=b2&page=41')
    const params = new URLSearchParams(url.split('?')[1])
    expect(parseClassroomLink(params, ['PHY', 'CHEM'])).toEqual({ subject: 'PHY', textbookId: 'b2', page: 41 })
  })

  it('ignores a subject the student is not enrolled in, and a bad page', () => {
    expect(parseClassroomLink(new URLSearchParams('subject=MATH&textbook=b1&page=3'), ['PHY'])).toBeNull()
    expect(parseClassroomLink(new URLSearchParams(''), ['PHY'])).toBeNull()
    expect(parseClassroomLink(new URLSearchParams('subject=PHY&page=0'), ['PHY'])).toEqual({ subject: 'PHY', textbookId: undefined, page: undefined })
    expect(parseClassroomLink(new URLSearchParams('subject=PHY&page=abc'), ['PHY'])?.page).toBeUndefined()
  })

  it('opens the linked book at the linked page', () => {
    const books = [book('b1'), book('b2')]
    expect(pickStart(books, { textbookId: 'b2', page: 41 })).toEqual({ bookId: 'b2', page: 41 })
  })

  it('keeps the page within the book', () => {
    expect(pickStart([book('b1', { total_pages: 30 })], { textbookId: 'b1', page: 99 })).toEqual({ bookId: 'b1', page: 30 })
    expect(pickStart([book('b1', { total_pages: 0 })], { textbookId: 'b1', page: 99 })).toEqual({ bookId: 'b1', page: 99 })
  })

  it('falls back to the first ready book at page 1 without a link, or when the linked book is gone', () => {
    const books = [book('b1'), book('b2')]
    expect(pickStart(books)).toEqual({ bookId: 'b1', page: 1 })
    expect(pickStart(books, { textbookId: 'gone', page: 41 })).toEqual({ bookId: 'b1', page: 1 })
    expect(pickStart([], { textbookId: 'b1', page: 3 })).toEqual({ bookId: '', page: 1 })
  })

  it('only indexed books can be taught from', () => {
    expect(readyTextbooks([book('a'), book('b', { vector_status: 'processing' }), book('c', { vector_status: 'failed' })]).map((b) => b.textbook_id)).toEqual(['a'])
  })
})
