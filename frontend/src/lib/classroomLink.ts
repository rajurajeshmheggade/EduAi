/**
 * Deep links into the textbook avatar classroom (route /student/classroom/textbook):
 *   ?subject=PHY&textbook=<textbook_id>&page=41
 * opens that subject's textbook at that page (the AI Classroom home links a chapter's first page this way).
 */
import type { Textbook } from '@/types'

export const TEXTBOOK_CLASSROOM_PATH = '/student/classroom/textbook'

export interface ClassroomLink {
  subject: string
  textbookId?: string
  page?: number
}

export function classroomLink({ subject, textbookId, page }: ClassroomLink): string {
  const q = new URLSearchParams({ subject })
  if (textbookId) q.set('textbook', textbookId)
  if (page) q.set('page', String(page))
  return `${TEXTBOOK_CLASSROOM_PATH}?${q}`
}

/** The link in the URL, or null without one. A subject the student is not enrolled in is ignored. */
export function parseClassroomLink(params: URLSearchParams, allowedSubjects: string[]): ClassroomLink | null {
  const subject = params.get('subject')
  if (!subject || !allowedSubjects.includes(subject)) return null
  const page = Number(params.get('page'))
  return { subject, textbookId: params.get('textbook') || undefined, page: Number.isInteger(page) && page >= 1 ? page : undefined }
}

/** Books the avatar can teach from: fully indexed (students are only ever sent published ones). */
export const readyTextbooks = (books: Textbook[]) => books.filter((b) => b.vector_status === 'indexed')

/**
 * Where the classroom opens: the linked book (when it is ready) at the linked page, kept within the book; otherwise
 * the first ready book at page 1 (a link to a book that was unpublished or re-indexed falls back the same way).
 */
export function pickStart(books: Textbook[], link?: Pick<ClassroomLink, 'textbookId' | 'page'> | null): { bookId: string; page: number } {
  const linked = link?.textbookId ? books.find((b) => b.textbook_id === link.textbookId) : undefined
  const book = linked ?? books[0]
  if (!book) return { bookId: '', page: 1 }
  const last = book.total_pages > 0 ? book.total_pages : Number.POSITIVE_INFINITY
  return { bookId: book.textbook_id, page: linked && link?.page ? Math.min(Math.max(1, link.page), last) : 1 }
}
