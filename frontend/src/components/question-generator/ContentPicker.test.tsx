import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContentPicker, type ContentSelection } from './ContentPicker'

const svc = vi.hoisted(() => ({
  classes: vi.fn(),
  chapters: vi.fn(),
  topics: vi.fn(),
  content: vi.fn(),
  preview: vi.fn(),
}))
vi.mock('@/services/questionGenService', () => ({ questionGenService: svc }))

const CLASSES = [
  { class_code: 'Grade-10-A', class_name: 'Grade 10 — Section A', grade: 10, nlp_class: 'X', subjects: [
    { subject_code: 'PHY101', subject_name: 'Physics', grade: 10, nlp_class: 'X', nlp_subject: 'General Science', mapping: 'auto', note: null },
    { subject_code: 'MATH-12', subject_name: 'Mathematics', grade: 10, nlp_class: 'X', nlp_subject: 'Mathematics', mapping: 'auto', note: null },
    { subject_code: 'SKT', subject_name: 'Sanskrit', grade: 10, nlp_class: 'X', nlp_subject: null, mapping: 'none', note: 'No subject folder matches “Sanskrit”' },
  ] },
  { class_code: 'Grade-9-B', class_name: 'Grade 9 — Section B', grade: 9, nlp_class: 'IX', subjects: [
    { subject_code: 'PHY101', subject_name: 'Physics', grade: 9, nlp_class: 'IX', nlp_subject: 'Science', mapping: 'auto', note: null },
  ] },
]

beforeEach(() => {
  Object.values(svc).forEach((f) => f.mockReset())
  svc.classes.mockResolvedValue(CLASSES)
  svc.chapters.mockImplementation(async (cc: string) => (cc === 'Grade-10-A'
    ? { nlp_class: 'X', nlp_subject: 'General Science', discipline: 'physics', chapters: ['electricity', 'light', 'acids bases and salts'], primary: ['electricity', 'light'] }
    : { nlp_class: 'IX', nlp_subject: 'Science', discipline: 'physics', chapters: ['motion'], primary: ['motion'] }))
  svc.topics.mockResolvedValue({ topic_source: 'headings', source_file: 'x', topics: [
    { id: 't-1', title: 'Electric Current Circuit', number: '11.1', segment_count: 2, word_count: 480 },
    { id: 't-2', title: 'Electric Power', number: '11.8', segment_count: 1, word_count: 240 },
  ] })
  svc.content.mockResolvedValue({ topic: {}, segments: [
    { id: 's-1', title: 'Part 1 · current, charge', word_count: 240, keywords: [], preview: 'Electric current is …' },
    { id: 's-2', title: 'Part 2 · circuit', word_count: 240, keywords: [], preview: 'A circuit …' },
  ] })
  svc.preview.mockResolvedValue({ topic: {}, segments: [{ id: 's-1', title: 'Part 1', text: 'Electric current is the rate of flow of charge.' }], word_count: 240, truncated: false,
    source: { class: 'X', subject: 'General Science', chapter: 'electricity', file: 'X/General Science/electricity/electricity.txt' } })
})

const select = (name: RegExp) => screen.getByRole('combobox', { name })

describe('ContentPicker cascade', () => {
  it('loads each level from the one above and reports the full selection', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ContentPicker onChange={onChange} />)
    await waitFor(() => expect(select(/^class$/i)).toBeEnabled())
    expect(select(/subject/i)).toBeDisabled()

    await user.selectOptions(select(/^class$/i), 'Grade-10-A')
    const subj = select(/subject/i)
    expect(within(subj).getByRole('option', { name: /Sanskrit \(not linked to content\)/ })).toBeDisabled()
    expect(svc.chapters).not.toHaveBeenCalled()

    await user.selectOptions(subj, 'PHY101')
    await waitFor(() => expect(svc.chapters).toHaveBeenCalledWith('Grade-10-A', 'PHY101', expect.anything()))
    await waitFor(() => expect(select(/chapter/i)).toBeEnabled())
    // the subject's own chapters are grouped first
    const groups = within(select(/chapter/i)).getAllByRole('group')
    expect(groups.map((g) => g.getAttribute('label'))).toEqual(['Physics chapters', 'Other General Science chapters'])

    await user.selectOptions(select(/chapter/i), 'electricity')
    await waitFor(() => expect(select(/topic/i)).toBeEnabled())
    await user.selectOptions(select(/topic/i), 't-1')
    await waitFor(() => expect(select(/learning content/i)).toBeEnabled())
    expect(svc.content).toHaveBeenCalledWith('Grade-10-A', 'PHY101', 'electricity', 't-1', expect.anything())

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      class_code: 'Grade-10-A', subject_code: 'PHY101', nlp_class: 'X', nlp_subject: 'General Science', chapter: 'electricity', segment_ids: [],
    })))
    await user.selectOptions(select(/learning content/i), 's-2')
    await waitFor(() => expect((onChange.mock.lastCall![0] as ContentSelection).segment_ids).toEqual(['s-2']))

    await user.click(screen.getByRole('button', { name: /preview content/i }))
    expect(await screen.findByText(/rate of flow of charge/)).toBeInTheDocument()
    expect(svc.preview).toHaveBeenCalledWith('Grade-10-A', 'PHY101', 'electricity', 't-1', ['s-2'], expect.anything())
  })

  it('resets the lower levels when a higher level changes', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ContentPicker onChange={onChange} />)
    await waitFor(() => expect(select(/^class$/i)).toBeEnabled())
    await user.selectOptions(select(/^class$/i), 'Grade-10-A')
    await user.selectOptions(select(/subject/i), 'PHY101')
    await waitFor(() => expect(select(/chapter/i)).toBeEnabled())
    await user.selectOptions(select(/chapter/i), 'electricity')
    await waitFor(() => expect(select(/topic/i)).toBeEnabled())

    await user.selectOptions(select(/^class$/i), 'Grade-9-B')
    // a class with a single linked subject picks it, and a single chapter is chosen automatically
    await waitFor(() => expect(select(/subject/i)).toHaveValue('PHY101'))
    await waitFor(() => expect(select(/chapter/i)).toHaveValue('motion'))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('shows why a subject cannot be used', async () => {
    const user = userEvent.setup()
    render(<ContentPicker onChange={() => {}} />)
    await waitFor(() => expect(select(/^class$/i)).toBeEnabled())
    await user.selectOptions(select(/^class$/i), 'Grade-10-A')
    // a disabled option cannot be chosen by a user; a locked picker can still point at it
    render(<ContentPicker locked={{ class_code: 'Grade-10-A', subject_code: 'SKT' }} onChange={() => {}} />)
    expect(await screen.findByText(/No subject folder matches/)).toBeInTheDocument()
  })

  it('reports a failed level with a retry', async () => {
    svc.classes.mockRejectedValueOnce(new Error('Network down'))
    const user = userEvent.setup()
    render(<ContentPicker onChange={() => {}} />)
    expect(await screen.findByText('Network down')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(select(/^class$/i)).toBeEnabled())
  })
})
