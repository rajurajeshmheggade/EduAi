import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProctorMedia } from '@/lib/proctor/media'
import { proctorConfig } from '@/test/proctoring'
import { type BeginResult, PreExamWindow } from './PreExamWindow'

const CAMS = [{ deviceId: 'cam-a', kind: 'videoinput', label: 'Integrated Camera' }, { deviceId: 'cam-b', kind: 'videoinput', label: 'USB Camera' },
  { deviceId: 'mic-a', kind: 'audioinput', label: 'Built-in Mic' }]

/** A camera / microphone / detector that behave like a working laptop (jsdom has none). */
function fakeMedia(opts: { cameraError?: string } = {}) {
  let cam = 'cam-a'
  const track = { addEventListener: vi.fn(), getSettings: () => ({ deviceId: cam }) }
  const media = {
    camera: null as unknown, mic: null as unknown, cameraLabel: null as string | null, micLabel: 'Built-in Mic', floorDb: -100,
    startCamera: vi.fn(async (id?: string) => {
      if (opts.cameraError) throw Object.assign(new Error('denied'), { name: opts.cameraError })
      cam = id ?? 'cam-a'
      media.cameraLabel = cam === 'cam-a' ? 'Integrated Camera' : 'USB Camera'
      media.camera = { getVideoTracks: () => [track] }
      return media.camera
    }),
    cameraDeviceId: () => (media.camera ? cam : null),
    startMic: vi.fn(async () => { media.mic = { getAudioTracks: () => [track] } }),
    micDeviceId: () => (media.mic ? 'mic-a' : null),
    calibrateMic: vi.fn(async () => -60),
    micDb: () => -55,
    loadModels: vi.fn(async () => 'cpu'),
    analyse: vi.fn(async () => ({ faces: 1, pose: { yaw: 0, pitch: 0, roll: 0 }, luma: { mean: 120, std: 40 }, objects: [] })),
  }
  return media
}

beforeEach(() => {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })   // camera APIs need https (or localhost)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { enumerateDevices: vi.fn(async () => CAMS), addEventListener: vi.fn(), removeEventListener: vi.fn() },
  })
})
afterEach(() => { vi.restoreAllMocks() })

function open(media: ReturnType<typeof fakeMedia>, onBegin = vi.fn(async (_r: BeginResult) => {}), rules = {}) {
  const onCancel = vi.fn()
  render(<PreExamWindow config={proctorConfig(true, 'VIRTUAL_LAB', rules)} media={media as unknown as ProctorMedia} title="Hot or cold?" onCancel={onCancel} onBegin={onBegin} />)
  return { onBegin, onCancel }
}

describe('PreExamWindow', () => {
  it('shows every rule and the privacy notice, and continues only once the acknowledgement is ticked', () => {
    open(fakeMedia())
    const w = screen.getByTestId('pre-exam-window')
    expect(within(w).getByText('Keep your face visible throughout the examination.')).toBeInTheDocument()
    expect(within(w).getByText('No video, photos or images')).toBeInTheDocument()
    const next = screen.getByRole('button', { name: /Tick the box to continue/ })
    expect(next).toBeDisabled()
    fireEvent.click(screen.getByLabelText('I have read and understood all examination rules and instructions.'))
    expect(screen.getByRole('button', { name: /Continue to device check/ })).toBeEnabled()
  })

  it('runs the device checks, lets the student switch camera, and enables Begin only when all pass', async () => {
    const media = fakeMedia()
    const { onBegin } = open(media)
    fireEvent.click(screen.getByLabelText(/I have read and understood/))
    fireEvent.click(screen.getByRole('button', { name: /Continue to device check/ }))

    expect(screen.getByRole('button', { name: /Complete the checks/ })).toBeDisabled()
    await waitFor(() => expect(document.querySelector('[data-check="face"]')).toHaveAttribute('data-status', 'pass'), { timeout: 4000 })
    const begin = screen.getByRole('button', { name: /Begin exam/ })
    expect(begin).toBeEnabled()
    expect(media.startMic).not.toHaveBeenCalled()                    // the microphone is not required for labs: never opened

    const select = screen.getByLabelText('Camera') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.text)).toEqual(['Integrated Camera', 'USB Camera'])
    fireEvent.change(select, { target: { value: 'cam-b' } })
    await waitFor(() => expect(media.startCamera).toHaveBeenLastCalledWith('cam-b'))
    await waitFor(() => expect(document.querySelector('[data-check="face"]')).toHaveAttribute('data-status', 'pass'), { timeout: 4000 })

    fireEvent.click(screen.getByRole('button', { name: /Begin exam/ }))
    await waitFor(() => expect(onBegin).toHaveBeenCalled())
    expect(onBegin.mock.calls[0][0]).toMatchObject({ checks: { camera: true, face: true, microphone: false, fullscreen: true }, cameraLabel: 'USB Camera' })
  })

  it('requires and calibrates the microphone when the module needs it', async () => {
    const media = fakeMedia()
    open(media, undefined, { mic_required: true, detect_voice: true })
    fireEvent.click(screen.getByLabelText(/I have read and understood/))
    fireEvent.click(screen.getByRole('button', { name: /Continue to device check/ }))
    await waitFor(() => expect(document.querySelector('[data-check="microphone"]')).toHaveAttribute('data-status', 'pass'))
    expect(media.calibrateMic).toHaveBeenCalled()
    expect(screen.getByLabelText('Microphone')).toBeInTheDocument()
  })

  it('explains a blocked camera permission and keeps the exam locked', async () => {
    const media = fakeMedia({ cameraError: 'NotAllowedError' })
    open(media)
    fireEvent.click(screen.getByLabelText(/I have read and understood/))
    fireEvent.click(screen.getByRole('button', { name: /Continue to device check/ }))
    const help = await screen.findByRole('alert')
    expect(within(help).getByText('Camera permission was blocked')).toBeInTheDocument()
    expect(within(help).getByText(/address bar/)).toBeInTheDocument()
    expect(within(help).getByRole('button', { name: /Try again/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Complete the checks/ })).toBeDisabled()
    expect(media.analyse).not.toHaveBeenCalled()
  })

  it('can be closed without starting', () => {
    const { onCancel } = open(fakeMedia())
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
