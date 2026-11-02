import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VirtualLabWorkspace from '@/pages/student/VirtualLabWorkspace'
import { virtualLabService, type Lab, type LabAssignment, type LabResource, type StudentLabView, type Worksheet } from '@/services/virtualLabService'
import { AssignLabDialog } from './AssignLabDialog'
import { LabStage } from './LabStage'

vi.mock('@/services/virtualLabService', () => ({
  virtualLabService: {
    myLab: vi.fn(), start: vi.fn(), activity: vi.fn(async () => ({ active_seconds: 700, launches: 1, min_seconds: 600 })),
    saveWork: vi.fn(async () => ({ saved_at: '2026-10-28T10:00:00Z' })), submit: vi.fn(), ask: vi.fn(),
    draftWorksheet: vi.fn(), assign: vi.fn(), proctorFlag: vi.fn(async () => ({ flag_count: 1 })),
  },
}))
const svc = vi.mocked(virtualLabService)

// Proctoring switched off for Virtual Labs here: these tests cover the workspace itself (the proctored flow is tested in
// components/proctoring/*.test.tsx).
vi.mock('@/services/proctoringService', async (orig) => {
  const real = await orig<typeof import('@/services/proctoringService')>()
  const { proctorConfig } = await import('@/test/proctoring')
  return { ...real, proctoringService: { ...real.proctoringService, config: vi.fn(async () => proctorConfig(false, 'VIRTUAL_LAB')) } }
})

// jsdom has no camera/mic/worker.
vi.mock('@/lib/proctor/media', () => ({
  ProctorMedia: class {
    floorDb = -100
    async startCamera() { return {} }
    async startMic() { /* noop */ }
    async calibrateMic() { return -100 }
    async loadModels() { return 'cpu' }
    cameraLive() { return true }
    async analyse() { return null }
    micDb() { return null }
    stop() { /* noop */ }
  },
}))

const SIM_SRC = 'https://obj.diksha.gov.in/ntp-content-production/content/html/do_31356577898317414413160-latest/index.html'

function resource(over: Partial<LabResource>): LabResource {
  return {
    source: 'diksha', source_id: 'do_sim1', kind: 'resource', name: 'Simulation - Exothermic and endothermic', description: null, cover_url: null,
    primary_category: 'Learning Resource', content_type: 'Resource', mime_type: 'application/vnd.ekstep.html-archive', resource_type: 'interactive',
    boards: ['NCERT'], classes: [10], class_labels: ['Class 10'], subjects: ['Science'], mediums: ['English'],
    license: { name: 'CC BY-NC-SA 4.0', url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode' }, author: 'C-DAC Mumbai', creator: null,
    attributions: [], copyright: 'NCERT', copyright_year: null, organisation: ['NCERT'], leaf_count: null, size_bytes: null, duration: null, version: null,
    published_on: null, status: 'Live', official_url: 'https://diksha.gov.in/play/content/do_sim1',
    permissions: { license: 'CC BY-NC-SA 4.0', discover: true, link: true, embed: true, download: false, store_copy: false, redistribute: false,
      modify: true, review_required: false, eligible: true, notes: [] },
    access: { viewer: 'html', src: SIM_SRC, official_url: 'https://diksha.gov.in/play/content/do_sim1' },
    role: 'simulation', role_label: 'Simulation',
    ...over,
  }
}

const MANUAL = resource({ source_id: 'do_man1', name: 'Experiment_3', mime_type: 'application/pdf', resource_type: 'pdf', role: 'manual', role_label: 'Lab manual',
  license: { name: 'CC BY-NC-ND 4.0', url: null }, official_url: 'https://diksha.gov.in/play/content/do_man1',
  access: { viewer: 'official', src: null, official_url: 'https://diksha.gov.in/play/content/do_man1', reason: 'NonCommercial licence.' } })

const LAB: Lab = {
  lab_id: 'do_lab1', name: 'Change in temp. during reactions of exothermic or endothermic', position: 2, summary: 'To study exothermic and endothermic reactions.',
  keywords: ['exothermic'], roles: { simulation: 1, manual: 1 }, has_simulation: true, authors: ['C-DAC Mumbai'], licenses: ['CC BY-NC-SA 4.0'],
  resources: [resource({}), MANUAL],
  collection: { source_id: 'do_3135614393797099521445', name: 'Science Lab Manual', description: null, cover_url: null, classes: [10], subjects: ['Science'],
    mediums: ['English'], license: { name: 'CC BY-SA 4.0', url: null }, author: 'Creator', creator: null, attributions: [], copyright: null, copyright_year: null,
    organisation: ['NCERT'], official_url: 'https://diksha.gov.in/play/collection/do_3135614393797099521445', class_number: 10, medium: 'English', subject: 'Science', label: 'Science' },
}

const WS: Worksheet = {
  aim: 'To study exothermic and endothermic reactions.', materials: ['Thermometer'], steps: ['Note the temperature', 'Add NaOH'],
  observation_columns: ['Reaction', 'Change (°C)'], observation_rows: 2,
  questions: [{ id: 'q1', type: 'mcq', prompt: 'Dissolving NaOH is', options: ['Endothermic', 'Exothermic'], marks: 1 },
    { id: 'q2', type: 'short', prompt: 'Why does it get warm?', options: [], marks: 2 }],
  conclusion_prompt: 'What do you conclude?', record_marks: 4,
}

const ASSIGNMENT: LabAssignment = {
  assignment_id: 'a1', class_code: 'Grade-10-A', class_name: 'Grade 10 — Section A', subject_code: 'PHY101', subject_name: 'Physics', teacher_code: 'EMP1001',
  teacher_name: 'Priya Sharma', collection_id: 'do_3135614393797099521445', lab_id: 'do_lab1', title: 'Hot or cold?', instructions: 'Use the simulation twice.',
  max_marks: 7, min_minutes: 10, available_from: null, due_at: '2099-01-01T10:00:00Z', allow_late: true, status: 'active', created_at: '2026-10-28T09:00:00Z',
  window: { state: 'open', can_work: true }, lab_name: LAB.name, lab_class: 10, has_simulation: true, lab_roles: LAB.roles,
}

const attempt = (over = {}) => ({
  status: 'in_progress' as const, started_at: '2026-10-28T09:30:00Z', active_seconds: 650, launches: 0, steps_done: [], observations: [], answers: {},
  conclusion: null, submitted_at: null, is_late: false, returned_count: 0, updated_at: '2026-10-28T09:30:00Z', teacher_feedback: null, result: null,
  proctor_flag_count: 0, ...over,
})

function renderWorkspace() {
  return render(
    <MemoryRouter initialEntries={['/student/virtual-labs/a1']}>
      <Routes><Route path="/student/virtual-labs/:id" element={<VirtualLabWorkspace />} /></Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { vi.restoreAllMocks() })

describe('LabStage', () => {
  it('runs the simulation unmodified in a sandboxed frame and counts launches', () => {
    const onLaunch = vi.fn()
    render(<LabStage lab={LAB} onLaunch={onLaunch} />)
    const frame = screen.getByTitle('Exothermic and endothermic')
    expect(frame.tagName).toBe('IFRAME')
    expect(frame).toHaveAttribute('src', SIM_SRC)
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts')
    fireEvent.load(frame)
    expect(onLaunch).toHaveBeenLastCalledWith(expect.objectContaining({ source_id: 'do_sim1' }), true)
    // No redundant external-open control while the simulation already renders in-app.
    expect(screen.queryByRole('link', { name: /Open on DIKSHA/ })).not.toBeInTheDocument()
  })

  it('has no DIKSHA branding and only one, necessary external link when a licence forces it', () => {
    const onLaunch = vi.fn()
    render(<LabStage lab={LAB} onLaunch={onLaunch} />)
    fireEvent.click(screen.getByRole('tab', { name: /Lab manual/ }))
    // The functionality (a working link to the real source) is preserved — just not DIKSHA-branded, and not duplicated.
    const fallback = screen.getByTestId('official-fallback')
    expect(fallback).toBeInTheDocument()
    expect(screen.getByText('NonCommercial licence.')).toBeInTheDocument()
    // No DIKSHA branding in any discretionary copy: the fallback panel's own heading and button.
    expect(screen.queryByText('Open this resource on DIKSHA')).not.toBeInTheDocument()
    expect(screen.queryByText(/DIKSHA may ask you to sign in/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Open on DIKSHA/ })).not.toBeInTheDocument()
    // The one line that still names DIKSHA is the mandatory source/licence attribution (kept everywhere,
    // per DIKSHA's Terms of Use) — not platform branding, and not the external-navigation control.
    expect(screen.getByText('Source:')).toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: /Open resource/ })
    expect(links).toHaveLength(1)                                        // the old duplicate toolbar link is gone
    expect(links[0]).toHaveAttribute('href', 'https://diksha.gov.in/play/content/do_man1')
    expect(links[0]).toHaveAttribute('target', '_blank')
    // The tab strip marks it as external without naming the platform.
    expect(screen.getByText('· External')).toBeInTheDocument()
  })
})

describe('Student workspace', () => {
  it('starts the lab, keeps the record and submits it', async () => {
    svc.myLab.mockResolvedValue({ assignment: ASSIGNMENT, lab: LAB, worksheet: WS, attempt: null } as StudentLabView)
    svc.start.mockResolvedValue({ assignment: ASSIGNMENT, lab: LAB, worksheet: WS, attempt: attempt() } as StudentLabView)
    svc.submit.mockImplementation(async (_id, work) => ({ assignment: ASSIGNMENT, lab: LAB, attempt: attempt({ ...work, status: 'submitted', submitted_at: '2026-10-28T10:00:00Z',
      result: { auto_score: 1, auto_max: 1, suggested_marks: null, marks: null, reviewed_at: null,
        feedback: { engine: 'offline', mcq: [{ id: 'q1', correct: true, marks: 1, max: 1 }], questions: [], record: null, overall: null,
          checks: { rows_filled: 1, rows_expected: 2, steps_done: 1, steps_total: 2, answered: 2, questions: 2, conclusion_words: 3 } } } }),
      worksheet: { ...WS, questions: WS.questions.map((q) => (q.id === 'q1' ? { ...q, answer: 1, explanation: 'Heat is given out.' } : q)) } } as StudentLabView))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderWorkspace()
    expect(await screen.findByText(WS.aim)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Start the lab/ }))
    expect(await screen.findByTestId('lab-clock')).toHaveTextContent(/10:5\d/)
    expect(screen.getByTitle('Exothermic and endothermic')).toHaveAttribute('src', SIM_SRC)

    fireEvent.click(screen.getByRole('tab', { name: /Procedure/ }))
    fireEvent.click(screen.getByLabelText(/Add NaOH/))
    fireEvent.click(screen.getByRole('tab', { name: /Observations/ }))
    fireEvent.change(screen.getByLabelText('Row 1, Reaction'), { target: { value: 'NaOH in water' } })
    fireEvent.change(screen.getByLabelText('Row 1, Change (°C)'), { target: { value: '+6' } })
    fireEvent.click(screen.getByRole('tab', { name: /Viva/ }))
    fireEvent.click(screen.getByLabelText('Exothermic'))
    fireEvent.change(screen.getByLabelText(/Why does it get warm/), { target: { value: 'Heat is released.' } })
    fireEvent.click(screen.getByRole('tab', { name: /Conclude/ }))
    fireEvent.change(screen.getByLabelText('What do you conclude?'), { target: { value: 'NaOH dissolving is exothermic.' } })
    expect(screen.getByText(/Viva: 2 of 2 answered/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Submit lab/ }))

    await waitFor(() => expect(svc.submit).toHaveBeenCalled())
    expect(svc.submit.mock.calls[0][1]).toEqual({
      steps_done: [1], observations: [['NaOH in water', '+6'], ['', '']], answers: { q1: 1, q2: 'Heat is released.' }, conclusion: 'NaOH dissolving is exothermic.',
    })
    expect(window.confirm).not.toHaveBeenCalled()                        // nothing is entirely missing
    expect(await screen.findByText('Your lab record')).toBeInTheDocument()
    expect(screen.getByText('Heat is given out.')).toBeInTheDocument()   // explanation revealed after submitting
  })

  it('blocks submitting before the minimum time in the lab', async () => {
    svc.myLab.mockResolvedValue({ assignment: ASSIGNMENT, lab: LAB, worksheet: WS, attempt: attempt({ active_seconds: 30 }) } as StudentLabView)
    renderWorkspace()
    fireEvent.click(await screen.findByRole('tab', { name: /Conclude/ }))
    expect(screen.getByRole('button', { name: /Keep experimenting/ })).toBeDisabled()
  })
})

describe('AssignLabDialog', () => {
  it('drafts the worksheet with AI and assigns it to a matching class', async () => {
    svc.draftWorksheet.mockResolvedValue({ worksheet: { ...WS, questions: [{ id: 'q1', type: 'mcq', prompt: 'Dissolving NaOH is', options: ['Endothermic', 'Exothermic', ''], answer: 1, explanation: null, marks: 1 }] },
      engine: 'azure-gpt-4o', max_marks: 5 })
    svc.assign.mockResolvedValue({ assignment_id: 'a9', title: 'x', class_name: 'Grade 10 — Section A', student_count: 4, max_marks: 5 })
    const onAssigned = vi.fn()
    render(<AssignLabDialog lab={LAB} collection={LAB.collection!} onClose={vi.fn()} onAssigned={onAssigned} targets={[
      { class_code: 'Grade-9-B', class_name: 'Grade 9 — Section B', grade_number: 9, subject_code: 'PHY101', subject_name: 'Physics', student_count: 2 },
      { class_code: 'Grade-10-A', class_name: 'Grade 10 — Section A', grade_number: 10, subject_code: 'MATH-12', subject_name: 'Mathematics', student_count: 4 },
      { class_code: 'Grade-10-A', class_name: 'Grade 10 — Section A', grade_number: 10, subject_code: 'PHY101', subject_name: 'Physics', student_count: 4 },
    ]} />)
    expect(await screen.findByText(/Drafted by AI/)).toBeInTheDocument()
    const target = screen.getByLabelText('Class and subject') as HTMLSelectElement
    expect(target.value).toBe('Grade-10-A|PHY101')                       // Physics before Mathematics for a Science lab
    expect(within(target).getByRole('option', { name: /Grade 9/ })).toBeDisabled()
    expect(screen.getByTestId('ws-total')).toHaveTextContent('5')
    fireEvent.click(screen.getByRole('button', { name: /Assign \(5 marks\)/ }))
    await waitFor(() => expect(onAssigned).toHaveBeenCalled())
    const body = svc.assign.mock.calls[0][0]
    expect(body).toMatchObject({ collection_id: LAB.collection!.source_id, lab_id: 'do_lab1', class_code: 'Grade-10-A', subject_code: 'PHY101', min_minutes: 10 })
    expect(body.worksheet.questions[0].options).toEqual(['Endothermic', 'Exothermic'])   // blank option dropped
    expect(body.due_at).toMatch(/Z$/)
  })
})
