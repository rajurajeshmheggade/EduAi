import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { libraryService } from '@/services/libraryService'
import type { PublishedExternal } from '@/services/dikshaService'
import StudentLibrary from './StudentLibrary'

vi.mock('@/services/libraryService', () => ({ libraryService: { studentBooks: vi.fn() } }))
const svc = vi.mocked(libraryService)

const ext = (id: string, name: string, resource_type: 'video' | 'pdf', subject: [string, string]): PublishedExternal => ({
  source: 'diksha', source_id: id, kind: 'resource', name, source_status: 'available', published_at: '2026-11-01T10:00:00Z', context: null,
  subjects: [{ subject_code: subject[0], subject_name: subject[1], teacher_name: 'Priya Teacher' }],
  metadata: { source: 'diksha', source_id: id, kind: 'resource', name, description: null, cover_url: null, primary_category: 'Explanation Content',
    content_type: null, mime_type: null, resource_type, boards: ['NCERT'], classes: [9], class_labels: [], subjects: [subject[1]], mediums: ['English'],
    license: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/legalcode' }, author: 'NCERT', creator: null, attributions: [],
    copyright: 'NCERT', copyright_year: 2021, organisation: ['NCERT'], leaf_count: null, size_bytes: null, duration: null, version: null, published_on: null, status: 'Live' },
})
const VIDEO = ext('do_v1', 'Motion explained', 'video', ['PHY101', 'Physics'])
const PDF = ext('do_p1', 'Poems chapter 1', 'pdf', ['ENG101', 'English'])
const TYPES = [{ value: 'textbook' as const, label: 'Textbooks', count: 0 }, { value: 'video' as const, label: 'Videos', count: 1 },
  { value: 'document' as const, label: 'Documents (PDF)', count: 1 }, { value: 'interactive' as const, label: 'Interactive', count: 0 },
  { value: 'audio' as const, label: 'Audio', count: 0 }]

describe('Student Library: content type → subjects', () => {
  it('offers types that have content and narrows the subjects to those with content of the chosen type', async () => {
    svc.studentBooks.mockImplementation(async (f) => {
      const external = f.content_type === 'video' ? [VIDEO] : f.content_type === 'document' ? [PDF] : [VIDEO, PDF]
      return { class_code: 'Grade-9-B', class_name: 'Grade 9 — Section B', year_code: '2026-27', books: [], external, languages: ['English'], types: TYPES,
        subjects: external.flatMap((e) => e.subjects.map(({ subject_code, subject_name }) => ({ subject_code, subject_name }))) }
    })
    const { container } = render(<MemoryRouter><StudentLibrary /></MemoryRouter>)
    const types = await screen.findByRole('radiogroup', { name: 'Content type' })
    expect(within(types).getAllByRole('radio').map((r) => r.textContent)).toEqual(['All types', 'Videos (1)', 'Documents (PDF) (1)'])
    const subjects = () => within(screen.getByRole('radiogroup', { name: 'Subject' })).getAllByRole('radio').map((r) => r.textContent)
    expect(subjects()).toEqual(['All subjects', 'Physics', 'English'])

    fireEvent.click(within(types).getByRole('radio', { name: 'Videos (1)' }))
    await waitFor(() => expect(svc.studentBooks).toHaveBeenLastCalledWith(expect.objectContaining({ content_type: 'video' })))
    await waitFor(() => expect(subjects()).toEqual(['All subjects', 'Physics']))
    expect(screen.getByRole('article', { name: 'Motion explained' })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Poems chapter 1' })).not.toBeInTheDocument()
    expect(screen.getAllByTestId('credits')[0]).toHaveTextContent('CC BY 4.0')
    expect(container.textContent).not.toMatch(/diksha|source:/i)
  })
})
