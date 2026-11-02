import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MappingsResponse } from '@/types/questionGen'
import { QgenMappingPanel } from './QgenMappingPanel'

const svc = vi.hoisted(() => ({
  adminMappings: vi.fn(),
  adminSetMapping: vi.fn(),
  adminClearMapping: vi.fn(),
  adminSettings: vi.fn(),
  adminSaveSettings: vi.fn(),
  adminResetSettings: vi.fn(),
}))
vi.mock('@/services/questionGenService', () => ({ questionGenService: svc }))

const repository = [
  { class_label: 'IX', grade: 9, subjects: ['Science', 'English'] },
  { class_label: 'X', grade: 10, subjects: ['General Science', 'Mathematics'] },
  { class_label: 'JEE', grade: null, subjects: ['Physics'] },
]
const data: MappingsResponse = {
  repository,
  mappings: [
    { class_code: 'Grade-10-A', class_name: 'Grade 10 — Section A', subject_code: 'PHY101', subject_name: 'Physics', grade: 10,
      nlp_class: 'X', nlp_subject: 'General Science', mapping: 'auto', note: null },
    { class_code: 'Grade-9-B', class_name: 'Grade 9 — Section B', subject_code: 'SKT', subject_name: 'Sanskrit', grade: 9,
      nlp_class: 'IX', nlp_subject: null, mapping: 'none', note: 'No subject folder in Class IX matches “Sanskrit”' },
    { class_code: 'Grade-9-B', class_name: 'Grade 9 — Section B', subject_code: 'ENG-9', subject_name: 'English', grade: 9,
      nlp_class: 'IX', nlp_subject: 'English', mapping: 'override', note: null },
  ],
}
const settings = { ar_instruction: 'Two statements are given; choose the code.', ar_codes: ['A text', 'B text', 'C text', 'D text'], customised: false }

beforeEach(() => {
  Object.values(svc).forEach((f) => f.mockReset())
  svc.adminMappings.mockResolvedValue(data)
  svc.adminSettings.mockResolvedValue(settings)
  svc.adminSetMapping.mockImplementation(async () => data)
  svc.adminClearMapping.mockResolvedValue(data)
  svc.adminSaveSettings.mockImplementation(async (b: { ar_instruction: string; ar_codes: string[] }) => ({ ...b, customised: true }))
})

describe('Question generator admin panel', () => {
  it('lists class subjects with their links and repository dropdowns from the API', async () => {
    render(<QgenMappingPanel org="DEMO-SCHOOL" />)
    expect(await screen.findByText('PHY101')).toBeInTheDocument()
    expect(svc.adminMappings).toHaveBeenCalledWith('DEMO-SCHOOL')
    expect(screen.getByText('Automatic')).toBeInTheDocument()
    expect(screen.getByText('Not linked')).toBeInTheDocument()
    expect(screen.getByText(/matches “Sanskrit”/)).toBeInTheDocument()
    const klass = screen.getByLabelText('Repository class for Grade-10-A Physics') as HTMLSelectElement
    expect([...klass.options].map((o) => o.textContent)).toEqual(['Class 9', 'Class 10', 'JEE'])
    expect(klass.value).toBe('X')
    expect((screen.getByLabelText('Repository subject for Grade-10-A Physics') as HTMLSelectElement).value).toBe('General Science')
    // "Use automatic" only for an admin override
    expect(screen.getAllByRole('button', { name: /Use automatic/ })).toHaveLength(1)
  })

  it('subject choices follow the class choice and Save sends both', async () => {
    const user = userEvent.setup()
    render(<QgenMappingPanel />)
    const klass = await screen.findByLabelText('Repository class for Grade-10-A Physics') as HTMLSelectElement
    const subject = screen.getByLabelText('Repository subject for Grade-10-A Physics') as HTMLSelectElement
    const row = klass.closest('tr')!
    expect(within(row).getByRole('button', { name: /Save/ })).toBeDisabled()     // nothing changed yet
    await user.selectOptions(klass, 'IX')
    expect([...subject.options].map((o) => o.value)).toEqual(['Science', 'English'])
    expect(subject.value).toBe('Science')
    await user.selectOptions(subject, 'English')
    await user.click(within(row).getByRole('button', { name: /Save/ }))
    await waitFor(() => expect(svc.adminSetMapping).toHaveBeenCalledWith('Grade-10-A', 'PHY101', { nlp_class: 'IX', nlp_subject: 'English' }, undefined))
  })

  it('restores the automatic link for an override', async () => {
    const user = userEvent.setup()
    render(<QgenMappingPanel />)
    await user.click(await screen.findByRole('button', { name: /Use automatic/ }))
    await waitFor(() => expect(svc.adminClearMapping).toHaveBeenCalledWith('Grade-9-B', 'ENG-9', undefined))
  })

  it('edits the Assertion–Reason instruction and codes', async () => {
    const user = userEvent.setup()
    render(<QgenMappingPanel />)
    const codeB = await screen.findByLabelText('Code (B)') as HTMLInputElement
    expect(codeB.value).toBe('B text')
    await user.clear(codeB)
    await user.type(codeB, 'Both true, R does not explain A')
    await user.click(screen.getByRole('button', { name: /Save codes/ }))
    await waitFor(() => expect(svc.adminSaveSettings).toHaveBeenCalledWith(
      { ar_instruction: settings.ar_instruction, ar_codes: ['A text', 'Both true, R does not explain A', 'C text', 'D text'] }, undefined))
    expect(await screen.findByRole('button', { name: /Restore defaults/ })).toBeInTheDocument()
  })

  it('shows an error with a retry when loading fails', async () => {
    svc.adminMappings.mockRejectedValueOnce(new Error('Network down'))
    const user = userEvent.setup()
    render(<QgenMappingPanel />)
    expect(await screen.findByText('Network down')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: /Try again/ })[0])
    expect(await screen.findByText('PHY101')).toBeInTheDocument()
  })
})
