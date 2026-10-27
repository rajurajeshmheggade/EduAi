import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ChapterTree } from './ChapterTree'
import { DikshaFilters } from './DikshaFilters'
import { EmptyState, ErrorState, LoadingState } from './LibraryStates'
import { ResourceViewer } from './ResourceViewer'
import { TextbookDetails } from './TextbookDetails'
import type { DikshaFilterOptions, DikshaItem, DikshaTextbook, DikshaUnit } from '@/services/dikshaService'

const OFFICIAL = 'https://diksha.gov.in/play/content/do_31310415723157913612322'

function item(over: Partial<DikshaItem> = {}): DikshaItem {
  return {
    source: 'diksha', source_id: 'do_31310415723157913612322', kind: 'resource', name: 'Double Entry System', description: null,
    cover_url: null, primary_category: 'Explanation Content', content_type: 'ExplanationResource', mime_type: 'video/mp4',
    resource_type: 'video', boards: ['CBSE'], classes: [11], class_labels: ['Class 11'], subjects: ['Accountancy'], mediums: ['English'],
    license: { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/legalcode' }, author: 'NIOS', creator: 'Creator',
    attributions: [], copyright: 'NCERT', copyright_year: null, organisation: ['NCERT'], leaf_count: null, size_bytes: null, duration: null,
    version: 3, published_on: null, status: 'Live', official_url: OFFICIAL,
    permissions: { license: 'CC BY-SA 4.0', discover: true, link: true, embed: true, download: false, store_copy: false, redistribute: false,
      modify: true, review_required: false, eligible: true, notes: [] },
    access: { viewer: 'video', src: 'https://obj.diksha.gov.in/ntp-content-production/content/assets/x/lec1.mp4', official_url: OFFICIAL },
    ...over,
  }
}

const unit = (id: string, name: string, resources: DikshaItem[] = [], units: DikshaUnit[] = []): DikshaUnit => ({
  id, name, index: null, units, resources, resource_count: resources.length + units.reduce((n, u) => n + u.resource_count, 0),
})

describe('ResourceViewer', () => {
  it('plays permitted video from the source host and shows attribution + licence link', () => {
    render(<ResourceViewer item={item()} />)
    const video = screen.getByLabelText('Double Entry System') as HTMLVideoElement
    expect(video.tagName).toBe('VIDEO')
    expect(video.getAttribute('src')).toMatch(/^https:\/\/obj\.diksha\.gov\.in\//)
    expect(screen.getByRole('link', { name: 'CC BY-SA 4.0' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/4.0/legalcode')
    expect(screen.getByText('NIOS')).toBeInTheDocument()
  })

  it('falls back to the official DIKSHA link when the file cannot play', () => {
    render(<ResourceViewer item={item()} />)
    fireEvent.error(screen.getByLabelText('Double Entry System'))
    expect(screen.getByTestId('official-fallback')).toBeInTheDocument()
    expect(screen.getByText('The file could not be played here.')).toBeInTheDocument()
  })

  it('never embeds what the licence does not allow', () => {
    const nc = item({
      resource_type: 'pdf', license: { name: 'CC BY-NC-ND 4.0', url: null },
      permissions: { ...item().permissions, embed: false, review_required: true, notes: ['NonCommercial licence: opens on DIKSHA until your institution approves in-app display.'] },
      access: { viewer: 'official', src: null, official_url: OFFICIAL, reason: 'NonCommercial licence: opens on DIKSHA until your institution approves in-app display.' },
    })
    const { container } = render(<ResourceViewer item={nc} />)
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('video')).toBeNull()
    const links = screen.getAllByRole('link', { name: /Open on DIKSHA/ })
    links.forEach((l) => { expect(l).toHaveAttribute('href', OFFICIAL); expect(l).toHaveAttribute('target', '_blank'); expect(l.getAttribute('rel')).toContain('noopener') })
  })

  it('uses YouTube’s own privacy-enhanced player for YouTube resources', () => {
    const yt = item({ resource_type: 'youtube', access: { viewer: 'youtube', src: 'https://www.youtube-nocookie.com/embed/jEbA7ZVKAz0', official_url: OFFICIAL } })
    const { container } = render(<ResourceViewer item={yt} />)
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/jEbA7ZVKAz0')
  })
})

describe('ChapterTree', () => {
  it('keeps source order, marks chapters without resources and selects on click', () => {
    const onSelect = vi.fn()
    const units = [unit('u1', '1-Introduction to Accounting', [item()]), unit('u2', '2. Listen and Narrate')]
    render(<ChapterTree units={units} selected={null} onSelect={onSelect} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons[0]).toHaveTextContent('1-Introduction to Accounting')
    expect(buttons[1]).toHaveTextContent('2. Listen and Narrate')
    expect(screen.getByTitle('No linked resources')).toHaveTextContent('—')
    fireEvent.click(buttons[1])
    expect(onSelect).toHaveBeenCalledWith(units[1])
  })

  it('says so when a textbook has no chapter structure', () => {
    render(<ChapterTree units={[]} selected={null} onSelect={() => {}} />)
    expect(screen.getByText(/no chapter structure/i)).toBeInTheDocument()
  })
})

describe('TextbookDetails', () => {
  const book = item({ source_id: 'do_31310347535505817611436', kind: 'textbook', name: '(NEW) Accountancy Financial Accounting - I',
    resource_type: 'collection', access: { viewer: 'official', src: null, official_url: OFFICIAL } })
  const tree: DikshaTextbook = { book, resources: [], resource_count: 1, empty_units: 1,
    units: [unit('u1', 'Chapter with video', [item()]), unit('u2', 'Chapter without resources')] }

  it('opens a chapter resource in the viewer and shows an empty state for chapters without resources', () => {
    render(<TextbookDetails tree={tree} />)
    expect(screen.getByRole('heading', { name: '(NEW) Accountancy Financial Accounting - I' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Double Entry System' }))
    expect(screen.getByLabelText('Double Entry System').tagName).toBe('VIDEO')
    fireEvent.click(screen.getByRole('button', { name: /Chapter without resources/ }))
    expect(screen.getByText('No resources are linked to this chapter on DIKSHA')).toBeInTheDocument()
  })

  it('lets a teacher select the textbook and eligible resources', () => {
    const toggleBook = vi.fn(); const toggleResource = vi.fn()
    render(<TextbookDetails tree={tree} selection={{ isSelected: () => false, toggleBook, toggleResource }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select whole textbook' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Double Entry System' }))
    expect(toggleBook).toHaveBeenCalled()
    expect(toggleResource).toHaveBeenCalledWith(expect.objectContaining({ source_id: 'do_31310415723157913612322' }))
  })
})

describe('DikshaFilters', () => {
  const options: DikshaFilterOptions = {
    total: 10,
    boards: [{ value: 'NCERT', label: 'NCERT', count: 5 }, { value: 'State (Karnataka)', label: 'Karnataka State Board', count: 5 }],
    classes: [{ value: 9, label: 'Class 9', count: 3 }],
    subjects: [{ value: 'mathematics', label: 'Mathematics', count: 2 }],
    mediums: [{ value: 'kannada', label: 'Kannada', count: 4 }],
    content_types: [{ value: 'Digital Textbook', label: 'Digital Textbook' }, { value: 'Explanation Content', label: 'Explanation Content' }],
  }

  it('changing the board resets subject and medium and returns to page 1', () => {
    const onChange = vi.fn()
    render(<DikshaFilters options={options} value={{ subject: 'mathematics', medium: 'kannada', page: 3, content_type: 'Digital Textbook' }} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Board'), { target: { value: 'State (Karnataka)' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ board: 'State (Karnataka)', subject: '', medium: '', page: 1 }))
    expect(screen.getByRole('option', { name: 'Karnataka State Board (5)' })).toBeInTheDocument()
  })

  it('clear restores the default textbook search', () => {
    const onChange = vi.fn()
    render(<DikshaFilters options={options} value={{ board: 'NCERT', class_number: 9, content_type: 'Digital Textbook' }} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(onChange).toHaveBeenCalledWith({ content_type: 'Digital Textbook', page: 1 })
  })
})

describe('Library states', () => {
  it('loading, empty and error states are accessible', () => {
    const retry = vi.fn()
    render(<><LoadingState rows={2} label="Loading DIKSHA" /><EmptyState title="Nothing here" /><ErrorState message="DIKSHA is unavailable right now." onRetry={retry} /></>)
    expect(screen.getByRole('status', { name: 'Loading DIKSHA' })).toBeInTheDocument()
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('DIKSHA is unavailable right now.')
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(retry).toHaveBeenCalled()
  })
})
