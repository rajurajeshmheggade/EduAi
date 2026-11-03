import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { proctoringService, type StudentSession } from '@/services/proctoringService'
import { clientRules, proctorConfig } from '@/test/proctoring'
import { ProctorGate } from './ProctorGate'
import { useProctor } from './proctorContext'

vi.mock('@/services/proctoringService', async (orig) => {
  const real = await orig<typeof import('@/services/proctoringService')>()
  return {
    ...real,
    proctoringService: {
      config: vi.fn(), prepare: vi.fn(), start: vi.fn(), events: vi.fn(), heartbeat: vi.fn(), finish: vi.fn(async () => ({})), ackWarning: vi.fn(),
      finishOnUnload: vi.fn(),
    },
  }
})
// The window itself is tested in PreExamWindow.test.tsx: here it just reports passed checks.
vi.mock('./PreExamWindow', () => ({
  PreExamWindow: ({ onBegin, onCancel }: { onBegin: (r: unknown) => Promise<void>; onCancel: () => void }) => (
    <div data-testid="prep">
      <button onClick={() => void onBegin({ checks: { camera: true, face: true, microphone: false, fullscreen: true }, cameraLabel: 'Cam', micLabel: null, baseline: { yaw: 0, pitch: 0 } })}>BEGIN</button>
      <button onClick={onCancel}>CANCEL</button>
    </div>
  ),
}))
const svc = vi.mocked(proctoringService)

const SESSION: StudentSession = {
  session_id: 's1', module: 'ONLINE_TEST', ref_id: 't1', title: 'Quiz', status: 'PRECHECK', started_at: null, resumed: false, rules_version: '2026-11-v1',
  client_rules: clientRules(), last_seq: 0, end_reason: null,
}
const STATUS = { status: 'ACTIVE' as const, ended: false, end_reason: null, server_time: '', warnings: [] }

function Exam() {
  const p = useProctor()
  return <div><p>EXAM CONTENT</p><button onClick={() => void p.finish('submitted')}>HAND IN</button></div>
}

function mount(props: Partial<Parameters<typeof ProctorGate>[0]> = {}) {
  return render(
    <MemoryRouter>
      <ProctorGate module="ONLINE_TEST" refId="t1" title="Quiz" {...props}><Exam /></ProctorGate>
    </MemoryRouter>,
  )
}

afterEach(() => { vi.clearAllMocks() })

describe('ProctorGate', () => {
  it('opens the preparation window at once, starts the module and the session on Begin, and interrupts on leaving', async () => {
    svc.config.mockResolvedValue(proctorConfig(true))
    svc.prepare.mockResolvedValue(SESSION)
    svc.start.mockResolvedValue({ ...SESSION, status: 'ACTIVE', started_at: 'now', last_seq: 4 })
    svc.heartbeat.mockResolvedValue(STATUS)
    const onBegin = vi.fn(async () => {})
    const view = mount({ autoOpen: true, onBegin })
    expect(await screen.findByTestId('prep')).toBeInTheDocument()
    expect(svc.prepare).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('EXAM CONTENT')).not.toBeInTheDocument()     // nothing of the exam before Begin

    fireEvent.click(screen.getByText('BEGIN'))
    expect(await screen.findByText('EXAM CONTENT')).toBeInTheDocument()
    expect(onBegin).toHaveBeenCalled()
    expect(svc.start).toHaveBeenCalledWith('s1', expect.objectContaining({ acknowledged: true, rules_version: '2026-11-v1',
      checks: expect.objectContaining({ camera: true, face: true }) }))
    expect(screen.getByRole('button', { name: /Proctoring on|Check proctoring/ })).toBeInTheDocument()
    await waitFor(() => expect(svc.heartbeat).toHaveBeenCalled())

    view.unmount()
    await waitFor(() => expect(svc.finish).toHaveBeenCalledWith('s1', 'left'))   // after the flags still queued
  })

  it('closes the session as submitted when the exam is handed in (and not as "left" afterwards)', async () => {
    svc.config.mockResolvedValue(proctorConfig(true))
    svc.prepare.mockResolvedValue(SESSION)
    svc.start.mockResolvedValue({ ...SESSION, status: 'ACTIVE' })
    svc.heartbeat.mockResolvedValue(STATUS)
    const view = mount({ autoOpen: true })
    fireEvent.click(await screen.findByText('BEGIN'))
    fireEvent.click(await screen.findByText('HAND IN'))
    await waitFor(() => expect(svc.finish).toHaveBeenCalledWith('s1', 'submitted'))
    view.unmount()
    expect(svc.finish).toHaveBeenCalledTimes(1)
  })

  it('shows a teacher warning until the student acknowledges it', async () => {
    svc.config.mockResolvedValue(proctorConfig(true))
    svc.prepare.mockResolvedValue(SESSION)
    svc.start.mockResolvedValue({ ...SESSION, status: 'ACTIVE' })
    svc.heartbeat.mockResolvedValue({ ...STATUS, warnings: [{ action_id: 'w1', message: 'Please face the camera.', created_at: '' }] })
    svc.ackWarning.mockResolvedValue(undefined)
    mount({ autoOpen: true })
    fireEvent.click(await screen.findByText('BEGIN'))
    expect(await screen.findByText('Please face the camera.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'I understand' }))
    await waitFor(() => expect(svc.ackWarning).toHaveBeenCalledWith('s1', 'w1'))
    await waitFor(() => expect(screen.queryByText('Please face the camera.')).not.toBeInTheDocument())
  })

  it('stops and tells the student when a teacher ends the session', async () => {
    svc.config.mockResolvedValue(proctorConfig(true))
    svc.prepare.mockResolvedValue(SESSION)
    svc.start.mockResolvedValue({ ...SESSION, status: 'ACTIVE' })
    svc.heartbeat.mockResolvedValue({ ...STATUS, status: 'ENDED_BY_TEACHER', ended: true })
    const onEnded = vi.fn()
    const view = mount({ autoOpen: true, onEnded })
    fireEvent.click(await screen.findByText('BEGIN'))
    expect(await screen.findByText('Your teacher ended this session')).toBeInTheDocument()
    expect(screen.queryByText('EXAM CONTENT')).not.toBeInTheDocument()
    expect(onEnded).toHaveBeenCalled()
    view.unmount()
    expect(svc.finish).not.toHaveBeenCalled()                          // already ended by the server
  })

  it('closing the preparation window does not start anything', async () => {
    svc.config.mockResolvedValue(proctorConfig(true))
    svc.prepare.mockResolvedValue(SESSION)
    const onCancel = vi.fn()
    const onBegin = vi.fn()
    mount({ autoOpen: true, onCancel, onBegin })
    fireEvent.click(await screen.findByText('CANCEL'))
    expect(onCancel).toHaveBeenCalled()
    expect(onBegin).not.toHaveBeenCalled()
    expect(svc.start).not.toHaveBeenCalled()
    expect(svc.finish).toHaveBeenCalledWith('s1', 'left')               // the PRECHECK session is closed
  })

  it('without proctoring, resuming goes straight into the exam and starting asks only for the click', async () => {
    svc.config.mockResolvedValue(proctorConfig(false))
    const first = mount({ resume: true })
    expect(await screen.findByText('EXAM CONTENT')).toBeInTheDocument()
    first.unmount()
    const onBegin = vi.fn(async () => {})
    mount({ startLabel: 'Start test', onBegin })
    fireEvent.click(await screen.findByRole('button', { name: /Start test/ }))
    expect(await screen.findByText('EXAM CONTENT')).toBeInTheDocument()
    expect(onBegin).toHaveBeenCalled()
    expect(svc.prepare).not.toHaveBeenCalled()
  })
})
