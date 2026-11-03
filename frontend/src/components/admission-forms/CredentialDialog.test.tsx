import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ACK_MESSAGE } from '@/lib/admissionForm'
import type { IssuedCredential } from '@/services/admissionFormService'
import { CredentialDialog } from './CredentialDialog'

const CRED: IssuedCredential = {
  credential_id: 'c1', application_id: 'a1', username: 'DEMO-K7QX3P9M', password: 'Kq7m-X3pz-9WrT', expires_at: '2026-12-01T10:00:00Z',
  purpose: 'new', application_name: 'Admissions 2027–28', application_path: '/apply/demo-admissions-2027-a1b2c3', school_name: 'Demo International School',
}

describe('CredentialDialog', () => {
  const writeText = vi.fn(async () => {})
  beforeEach(() => {
    writeText.mockClear()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  })

  it('shows the application, URL, username and temporary password with copy buttons', () => {
    render(<CredentialDialog credential={CRED} onClose={() => {}} onAcknowledge={async () => ({})} />)
    const d = within(screen.getByRole('dialog'))
    expect(d.getByRole('heading', { name: 'Admission application credentials' })).toBeInTheDocument()
    expect(d.getByText('Admissions 2027–28')).toBeInTheDocument()
    expect(d.getByText(`${window.location.origin}/apply/demo-admissions-2027-a1b2c3`)).toBeInTheDocument()
    expect(d.getByText('DEMO-K7QX3P9M')).toBeInTheDocument()
    expect(d.getByText('Kq7m-X3pz-9WrT')).toBeInTheDocument()
    for (const name of ['Copy Username', 'Copy Password', 'Copy All']) expect(d.getByRole('button', { name })).toBeInTheDocument()
    expect(d.getByRole('button', { name: /Acknowledge/ })).toBeDisabled()   // copy first
  })

  it('copies each item, records the acknowledgement and shows the exact message', async () => {
    const onAck = vi.fn(async () => ({ message: ACK_MESSAGE }))
    const onClose = vi.fn()
    render(<CredentialDialog credential={CRED} onClose={onClose} onAcknowledge={onAck} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy Username' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('DEMO-K7QX3P9M'))
    fireEvent.click(screen.getByRole('button', { name: 'Copy Password' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Kq7m-X3pz-9WrT'))
    fireEvent.click(screen.getByRole('button', { name: /Copy All/ }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(3))
    const all = (writeText.mock.calls[2] as unknown as [string])[0]
    expect(all).toContain('Username: DEMO-K7QX3P9M')
    expect(all).toContain('Temporary password: Kq7m-X3pz-9WrT')
    expect(all).toContain('/apply/demo-admissions-2027-a1b2c3')
    const ack = screen.getByRole('button', { name: /Acknowledge/ })
    expect(ack).toBeEnabled()
    fireEvent.click(ack)
    await waitFor(() => expect(onAck).toHaveBeenCalledWith(['username', 'password', 'all']))
    expect(await screen.findByTestId('ack-message')).toHaveTextContent(
      /^Admission application credentials have been copied successfully\. Please save these credentials securely\.$/)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('warns before closing without acknowledging, and reports a failed acknowledgement', async () => {
    const onClose = vi.fn()
    const onAck = vi.fn(async () => { throw new Error('Network down') })
    render(<CredentialDialog credential={CRED} onClose={onClose} onAcknowledge={onAck} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText(/will not be shown again/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy Username' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Acknowledge/ })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /Acknowledge/ }))
    expect(await screen.findByText('Network down')).toBeInTheDocument()
    expect(screen.queryByTestId('ack-message')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close anyway' }))
    expect(onClose).toHaveBeenCalled()
  })
})
