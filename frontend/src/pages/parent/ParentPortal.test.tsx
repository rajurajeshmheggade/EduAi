import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setLanguage } from '@/i18n'
import ParentPortal from './ParentPortal'

const giveConsent = vi.fn()
vi.mock('@/services/admissionService', () => ({
  admissionService: {
    parentHome: vi.fn(async () => ({
      school: 'Demo International School', consent_version: 1, consent_languages: ['en', 'hi', 'kn', 'ta'], open_requests: 0,
      guardian: { guardian_id: 'g1', full_name: 'Sunita Verma', relationship: 'mother', preferred_language: 'hi' },
      children: [
        { applicant_id: 'a1', full_name: 'Aarav Verma', grade_applying: 6, status: 'enquiry', preferred_language: 'hi',
          consent: { decision: 'granted', version: 1, at: '2026-10-20T10:00:00Z', current: true } },
        { applicant_id: 'a2', full_name: 'Diya Verma', grade_applying: 9, status: 'enquiry', preferred_language: 'hi', consent: null },
      ],
    })),
    consentText: vi.fn(async (_id: string, lang: string) => ({
      child: { applicant_id: 'a2', full_name: 'Diya Verma', grade_applying: 9 }, version: 1, version_id: `v1-${lang}`, purposes: [],
      language: lang, requested_language: lang, title: 'सहमति', body: 'नोटिस का पाठ', draft_translation: lang !== 'en', current: null,
    })),
    giveConsent: (...a: unknown[]) => giveConsent(...a),
    parentRequests: vi.fn(async () => []),
    raiseRequest: vi.fn(),
    setParentLanguage: vi.fn(async () => ({})),
  },
}))

describe('ParentPortal', () => {
  beforeEach(async () => {
    giveConsent.mockReset().mockResolvedValue({ consent_id: 'c1', decision: 'granted', version: 1, at: '2026-10-27T10:00:00Z' })
    await act(() => setLanguage('hi'))
  })

  it('renders in Hindi and switches to Tamil', async () => {
    const { container } = render(<ParentPortal />)
    expect(await screen.findByRole('heading', { name: 'नमस्ते, Sunita Verma' })).toBeInTheDocument()
    expect(screen.getByText('कक्षा 9 के लिए आवेदन')).toBeInTheDocument()
    expect(screen.getByText('सहमति आवश्यक है')).toBeInTheDocument()
    expect(container.firstElementChild).toHaveAttribute('lang', 'hi')
    fireEvent.click(screen.getByRole('radio', { name: 'தமிழ்' }))
    expect(await screen.findByRole('heading', { name: 'வணக்கம், Sunita Verma' })).toBeInTheDocument()
    expect(container.firstElementChild).toHaveAttribute('lang', 'ta')
  })

  it('records consent only after the parent ticks the confirmation', async () => {
    render(<ParentPortal />)
    const buttons = await screen.findAllByRole('button', { name: /पढ़ें और सहमति दें/ })
    fireEvent.click(buttons[0])   // Diya (Aarav already consented → "सहमति देखें")
    expect(await screen.findByText('नोटिस का पाठ')).toBeInTheDocument()
    expect(screen.getByText(/यह अनुवाद प्रारूप है/)).toBeInTheDocument()            // draft-translation notice
    const dialog = within(screen.getByRole('dialog'))
    const submit = dialog.getByRole('button', { name: /सहमति दें$/ })
    expect(submit).toBeDisabled()
    fireEvent.click(dialog.getByRole('checkbox'))
    fireEvent.click(submit)
    await waitFor(() => expect(giveConsent).toHaveBeenCalledWith({ applicant_id: 'a2', version_id: 'v1-hi', decision: 'granted', confirm: true }))
    expect(await screen.findByText('धन्यवाद। आपकी सहमति दर्ज कर ली गई है।')).toBeInTheDocument()
  })
})
