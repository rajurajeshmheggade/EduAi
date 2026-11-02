import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VirtualLabWorkspace from '@/pages/student/VirtualLabWorkspace'
import { virtualLabService, type Lab, type LabAssignment, type LabResource, type StudentLabView, type VideoProgress, type VideoReport, type Worksheet } from '@/services/virtualLabService'
import { AssignLabDialog } from './AssignLabDialog'
import { LabStage } from './LabStage'

vi.mock('@/services/virtualLabService', () => ({
  virtualLabService: {
    myLab: vi.fn(), start: vi.fn(), activity: vi.fn(async () => ({ active_seconds: 700, launches: 1, min_seconds: 600 })),
    saveWork: vi.fn(async () => ({ saved_at: '2026-10-28T10:00:00Z' })), submit: vi.fn(), ask: vi.fn(),
    draftWorksheet: vi.fn(), assign: vi.fn(), proctorFlag: vi.fn(async () => ({ flag_count: 1 })), videoProgress: vi.fn(),
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
    published_on: null, status: 'Live',
    permissions: { license: 'CC BY-NC-SA 4.0', discover: true, embed: true, store_copy: false, redistribute: false,
      modify: true, review_required: false, eligible: true, notes: ['NonCommercial licence — shown in-app because your institution has approved it.'] },
    access: { viewer: 'html', src: SIM_SRC },
    role: 'simulation', role_label: 'Simulation',
    ...over,
  }
}

const MANUAL_SRC = 'https://obj.diksha.gov.in/ntp-content-production/content/assets/do_man1/experiment_3.pdf'
const MANUAL = resource({ source_id: 'do_man1', name: 'Experiment_3', mime_type: 'application/pdf', resource_type: 'pdf', role: 'manual', role_label: 'Lab manual',
  license: { name: 'CC BY-NC-ND 4.0', url: 'https://creativecommons.org/licenses/by-nc-nd/4.0/legalcode' }, access: { viewer: 'pdf', src: MANUAL_SRC } })
const VIDEO_SRC = 'https://obj.diksha.gov.in/ntp-content-production/content/assets/do_vid1/olab17englishexperiment.mp4'
const VIDEO = resource({ source_id: 'do_vid1', name: 'Video - Reactions of HCl', mime_type: 'video/mp4', resource_type: 'video', role: 'video',
  role_label: 'Animation / video', access: { viewer: 'video', src: VIDEO_SRC } })

const LAB: Lab = {
  lab_id: 'do_lab1', name: 'Change in temp. during reactions of exothermic or endothermic', position: 2, summary: 'To study exothermic and endothermic reactions.',
  keywords: ['exothermic'], roles: { simulation: 1, manual: 1 }, has_simulation: true, authors: ['C-DAC Mumbai'], licenses: ['CC BY-NC-SA 4.0'],
  resources: [resource({}), MANUAL],
  collection: { source_id: 'do_3135614393797099521445', name: 'Science Lab Manual', description: null, cover_url: null, classes: [10], subjects: ['Science'],
    mediums: ['English'], license: { name: 'CC BY-SA 4.0', url: null }, author: 'Creator', creator: null, attributions: [], copyright: null, copyright_year: null,
    organisation: ['NCERT'], class_number: 10, medium: 'English', subject: 'Science', label: 'Science' },
  video_ids: [],
}
const LAB_V: Lab = { ...LAB, roles: { simulation: 1, manual: 1, video: 1 }, resources: [resource({}), MANUAL, VIDEO], video_ids: ['do_vid1'] }

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
    expect(onLaunch).toHaveBeenLastCalledWith(expect.objectContaining({ source_id: 'do_sim1' }))
    // No redundant external-open control while the simulation already renders in-app.
    expect(screen.queryByRole('link', { name: /Open on DIKSHA/ })).not.toBeInTheDocument()
  })

  it('opens every resource inside the app: no links elsewhere, no source-platform branding', () => {
    const { container } = render(<LabStage lab={LAB_V} />)
    fireEvent.click(screen.getByRole('tab', { name: /Lab manual/ }))
    expect(container.querySelector('iframe')).toHaveAttribute('src', MANUAL_SRC)            // PDF in the in-app viewer
    fireEvent.click(screen.getByRole('tab', { name: /Animation/ }))
    const video = screen.getByLabelText('Reactions of HCl') as HTMLVideoElement
    expect(video.tagName).toBe('VIDEO')
    expect(video).toHaveAttribute('src', VIDEO_SRC)                                         // streamed into our own player
    expect(screen.getByTestId('credits')).toHaveTextContent('CC BY-NC-SA 4.0')
    const links = Array.from(container.querySelectorAll('a'))
    expect(links.every((a) => a.getAttribute('href')?.startsWith('https://creativecommons.org/'))).toBe(true)   // licence legal code only
    expect(container.textContent).not.toMatch(/diksha|external|open on|source:/i)
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

function setMedia(el: HTMLElement, props: Record<string, unknown>) {
  for (const [k, v] of Object.entries(props)) Object.defineProperty(el, k, { configurable: true, value: v })
}

/** Plays the <video> from `from` to `to` (seconds) with a `timeupdate` every 0.25 s. */
function playVideo(video: HTMLElement, from: number, to: number) {
  setMedia(video, { currentTime: from, paused: false, ended: false })
  fireEvent.play(video)
  for (let t = from + 0.25; t <= to + 1e-9; t += 0.25) { setMedia(video, { currentTime: Math.round(t * 100) / 100 }); fireEvent.timeUpdate(video) }
}

/** What the server would answer (coverage of the reported parts, complete = end reached and >= 90% played). */
function serverProgress(r: VideoReport): VideoProgress & { videos_done: number; videos_required: number } {
  const covered = r.segments.reduce((n, [a, b]) => n + b - a, 0)
  const coverage = Math.min(1, covered / r.duration)
  return { resource_id: r.resource_id, duration_seconds: r.duration, watched_seconds: covered, coverage, segments: r.segments, last_position: r.position,
    reached_end: r.ended, completed: r.ended && coverage >= 0.9, completed_at: null, videos_done: 0, videos_required: 1 }
}

const videoView = (progress: VideoProgress | null = null) => ({
  assignment: { ...ASSIGNMENT, videos_required: 1 }, lab: LAB_V, worksheet: WS,
  attempt: attempt({ videos: [{ resource_id: 'do_vid1', name: VIDEO.name, progress }] }),
}) as StudentLabView

describe('Lab video unlocks Submit', () => {
  beforeEach(() => { svc.videoProgress.mockImplementation(async (_id, r) => serverProgress(r)) })

  it('shows Submit only after the video was watched to the end', async () => {
    svc.myLab.mockResolvedValue(videoView())
    renderWorkspace()
    fireEvent.click(await screen.findByRole('tab', { name: /Conclude/ }))
    expect(screen.queryByRole('button', { name: /Submit lab/ })).not.toBeInTheDocument()
    expect(screen.getByTestId('video-gate')).toHaveTextContent('Watch the full video to unlock Submit')
    expect(screen.getByText('Video watched to the end')).toBeInTheDocument()            // checklist item, not yet ticked

    fireEvent.click(screen.getByRole('button', { name: 'Watch Video - Reactions of HCl' }))
    const video = screen.getByLabelText('Reactions of HCl')
    setMedia(video, { duration: 120 })
    fireEvent.loadedMetadata(video)
    playVideo(video, 0, 119.75)
    expect(screen.queryByRole('button', { name: /Submit lab/ })).not.toBeInTheDocument()
    setMedia(video, { currentTime: 120, ended: true, paused: true })
    fireEvent.ended(video)

    expect(await screen.findByRole('button', { name: /Submit lab/ })).toBeInTheDocument()
    expect(screen.queryByTestId('video-gate')).not.toBeInTheDocument()
    expect(screen.getByText('Watched to the end')).toBeInTheDocument()
    const last = svc.videoProgress.mock.calls.at(-1)![1]
    expect(last).toMatchObject({ resource_id: 'do_vid1', duration: 120, ended: true, segments: [[0, 120]] })
    expect(svc.videoProgress.mock.calls[0][1].segments).toEqual([])                          // first report when playback starts
  })

  it('does not count seeking to the end', async () => {
    svc.myLab.mockResolvedValue(videoView())
    renderWorkspace()
    fireEvent.click(await screen.findByRole('tab', { name: /Animation/ }))
    const video = screen.getByLabelText('Reactions of HCl')
    setMedia(video, { duration: 120 })
    fireEvent.loadedMetadata(video)
    playVideo(video, 0, 2)
    fireEvent.seeking(video)
    setMedia(video, { currentTime: 119 })
    fireEvent.timeUpdate(video)
    fireEvent.seeked(video)
    playVideo(video, 119, 119.75)
    setMedia(video, { currentTime: 120, ended: true, paused: true })
    fireEvent.ended(video)
    await waitFor(() => expect(svc.videoProgress.mock.calls.at(-1)![1].ended).toBe(true))
    expect(svc.videoProgress.mock.calls.at(-1)![1].segments).toEqual([[0, 2], [119, 120]])
    fireEvent.click(screen.getByRole('tab', { name: /Conclude/ }))
    expect(screen.getByTestId('video-gate')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Submit lab/ })).not.toBeInTheDocument()
  })

  it('keeps progress across a reload', async () => {
    const half: VideoProgress = { resource_id: 'do_vid1', duration_seconds: 120, watched_seconds: 60, coverage: 0.5, segments: [[0, 60]],
      last_position: 60, reached_end: false, completed: false, completed_at: null }
    svc.myLab.mockResolvedValue(videoView(half))
    const { unmount } = renderWorkspace()
    fireEvent.click(await screen.findByRole('tab', { name: /Conclude/ }))
    expect(within(screen.getByTestId('video-gate')).getByText('50%')).toBeInTheDocument()
    // carrying on from where it stopped completes it: the saved half counts, it is not watched again
    fireEvent.click(screen.getByRole('button', { name: 'Watch Video - Reactions of HCl' }))
    const video = screen.getByLabelText('Reactions of HCl')
    setMedia(video, { duration: 120 })
    fireEvent.loadedMetadata(video)
    playVideo(video, 60, 119.75)
    setMedia(video, { currentTime: 120, ended: true, paused: true })
    fireEvent.ended(video)
    expect(await screen.findByRole('button', { name: /Submit lab/ })).toBeInTheDocument()
    expect(svc.videoProgress.mock.calls.at(-1)![1].segments).toEqual([[0, 120]])
    unmount()

    // after a reload with the video completed, Submit is there straight away
    svc.myLab.mockResolvedValue(videoView({ ...half, watched_seconds: 120, coverage: 1, segments: [[0, 120]], reached_end: true, completed: true }))
    renderWorkspace()
    fireEvent.click(await screen.findByRole('tab', { name: /Conclude/ }))
    expect(screen.getByRole('button', { name: /Submit lab/ })).toBeInTheDocument()
    expect(screen.getByTestId('videos-status')).toHaveTextContent('All videos watched')
  })

  it('shows no source-platform wording anywhere in the lab, viva included', async () => {
    svc.myLab.mockResolvedValue(videoView())
    renderWorkspace()
    fireEvent.click(await screen.findByRole('tab', { name: /Viva/ }))
    expect(screen.getByText(/Dissolving NaOH is/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/diksha|source:|open on|external/i)
    expect(screen.getAllByTestId('credits').length).toBeGreaterThan(0)
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
