import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LegacyLibraryRedirect from '@/pages/library/LegacyLibraryRedirect'
import { dikshaService, type DikshaFilterOptions, type DikshaItem, type DikshaTextbook, type DikshaUnit } from '@/services/dikshaService'
import { ChapterTree } from './ChapterTree'
import { Credits } from './Credits'
import { DikshaBrowser } from './DikshaBrowser'
import { DikshaFilters } from './DikshaFilters'
import { EmptyState, ErrorState, LoadingState } from './LibraryStates'
import { ResourceViewer } from './ResourceViewer'
import { TextbookDetails } from './TextbookDetails'

vi.mock('@/services/dikshaService', async (orig) => {
  const real = await orig<typeof import('@/services/dikshaService')>()
  return { ...real, dikshaService: { ...real.dikshaService, filters: vi.fn(), search: vi.fn(), textbook: vi.fn(), resource: vi.fn(), publish: vi.fn() } }
})
const svc = vi.mocked(dikshaService)

function item(over: Partial<DikshaItem> = {}): DikshaItem {
  return {
    source: 'diksha', source_id: 'do_31310415723157913612322', kind: 'resource', name: 'Double Entry System', description: null,
    cover_url: null, primary_category: 'Explanation Content', content_type: 'ExplanationResource', mime_type: 'video/mp4',
    resource_type: 'video', boards: ['CBSE'], classes: [11], class_labels: ['Class 11'], subjects: ['Accountancy'], mediums: ['English'],
    license: { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/legalcode' }, author: 'NIOS', creator: 'Creator',
    attributions: [], copyright: 'NCERT', copyright_year: 2020, organisation: ['NCERT'], leaf_count: null, size_bytes: null, duration: null,
    version: 3, published_on: null, status: 'Live',
    permissions: { license: 'CC BY-SA 4.0', discover: true, embed: true, store_copy: false, redistribute: false,
      modify: true, review_required: false, eligible: true, notes: [] },
    access: { viewer: 'video', src: 'https://obj.diksha.gov.in/ntp-content-production/content/assets/x/lec1.mp4' },
    ...over,
  }
}

const unit = (id: string, name: string, resources: DikshaItem[] = [], units: DikshaUnit[] = []): DikshaUnit => ({
  id, name, index: null, units, resources, resource_count: resources.length + units.reduce((n, u) => n + u.resource_count, 0),
})

/** Every link on the page: only licence legal codes are allowed to point outside the app. */
const externalLinks = (root: HTMLElement) => Array.from(root.querySelectorAll('a')).filter((a) => !a.getAttribute('href')?.startsWith('https://creativecommons.org/'))

beforeEach(() => { vi.clearAllMocks() })

describe('ResourceViewer', () => {
  it('plays permitted video from the source host, with the credits line (licence + author + copyright)', () => {
    const { container } = render(<ResourceViewer item={item()} />)
    const video = screen.getByLabelText('Double Entry System') as HTMLVideoElement
    expect(video.tagName).toBe('VIDEO')
    expect(video.getAttribute('src')).toMatch(/^https:\/\/obj\.diksha\.gov\.in\//)
    const credits = screen.getByTestId('credits')
    expect(within(credits).getByRole('link', { name: 'CC BY-SA 4.0' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/4.0/legalcode')
    expect(within(credits).getByText('NIOS')).toBeInTheDocument()
    expect(within(credits).getByText('© 2020 NCERT')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/diksha/i)
    expect(externalLinks(container)).toHaveLength(0)
  })

  it('offers a retry — never a link elsewhere — when the file cannot play', () => {
    const { container } = render(<ResourceViewer item={item()} />)
    fireEvent.error(screen.getByLabelText('Double Entry System'))
    expect(screen.getByTestId('unavailable')).toHaveTextContent('This file could not be played')
    expect(externalLinks(container)).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(screen.getByLabelText('Double Entry System').tagName).toBe('VIDEO')
  })

  it('never embeds or links out what cannot be shown in the app', () => {
    const nc = item({
      resource_type: 'pdf', license: { name: 'CC BY-NC-ND 4.0', url: null },
      permissions: { ...item().permissions, embed: false, review_required: true, notes: ['NonCommercial licence: not shown until your institution approves in-app display.'] },
      access: { viewer: 'none', src: null, reason: 'NonCommercial licence: not shown until your institution approves in-app display.' },
    })
    const { container } = render(<ResourceViewer item={nc} />)
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(screen.getByText('This resource can’t be shown here')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/diksha|open on/i)
  })

  it('uses YouTube’s own privacy-enhanced player, inside the page, for YouTube resources', () => {
    const yt = item({ resource_type: 'youtube', access: { viewer: 'youtube', src: 'https://www.youtube-nocookie.com/embed/jEbA7ZVKAz0', video_id: 'jEbA7ZVKAz0' } })
    const { container } = render(<ResourceViewer item={yt} />)
    expect(container.querySelector('iframe')?.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/jEbA7ZVKAz0')
    expect(externalLinks(container)).toHaveLength(0)
  })
})

describe('Credits', () => {
  it('shows copyright and licence always, the rest of the attribution on demand in the compact form', () => {
    render(<Credits compact item={{ author: 'C-DAC Mumbai', creator: 'Amrita', attributions: ['OLabs'], copyright: 'NCERT', copyright_year: 2024,
      organisation: ['NCERT'], license: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/legalcode' } }} />)
    expect(screen.getByText('Credits')).toBeInTheDocument()
    expect(screen.getByText('© 2024 NCERT')).toBeVisible()
    expect(screen.getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/legalcode')
    const more = screen.getByRole('button', { name: /C-DAC Mumbai \+3/ })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Amrita')).toBeVisible()
    expect(screen.getByText('OLabs')).toBeVisible()
    expect(screen.queryByText(/source:|diksha/i)).not.toBeInTheDocument()
  })

  it('says when a licence is missing instead of inventing one', () => {
    render(<Credits item={{ author: null, creator: null, attributions: [], copyright: null, copyright_year: null, organisation: [], license: { name: null, url: null } }} />)
    expect(screen.getByText('Licence not stated — needs review')).toBeInTheDocument()
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
    expect(screen.getByTitle('No resources')).toHaveTextContent('—')
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
    resource_type: 'collection', published_on: '2024-05-01T00:00:00Z', access: { viewer: 'none', src: null, reason: 'Textbooks open as a chapter list.' } })
  const tree: DikshaTextbook = { book, resources: [], resource_count: 1, empty_units: 1,
    units: [unit('u1', 'Chapter with video', [item()]), unit('u2', 'Chapter without resources')] }

  it('opens a chapter resource in the viewer and shows an empty state for chapters without resources', () => {
    const { container } = render(<TextbookDetails tree={tree} />)
    expect(screen.getByRole('heading', { name: '(NEW) Accountancy Financial Accounting - I' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Double Entry System' }))
    expect(screen.getByLabelText('Double Entry System').tagName).toBe('VIDEO')
    fireEvent.click(screen.getByRole('button', { name: /Chapter without resources/ }))
    expect(screen.getByText('No resources in this chapter')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/diksha/i)
    expect(externalLinks(container)).toHaveLength(0)
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

const TYPES: DikshaFilterOptions['content_types'] = [
  { value: 'textbook', label: 'Textbooks', count: 40 }, { value: 'video', label: 'Videos', count: 150 },
  { value: 'document', label: 'Documents (PDF)', count: 200 }, { value: 'interactive', label: 'Interactive', count: 15 },
  { value: 'audio', label: 'Audio', count: 0 },
]
const opts = (subjects: string[], over: Partial<DikshaFilterOptions> = {}): DikshaFilterOptions => ({
  total: 10, boards: [{ value: 'NCERT', label: 'NCERT', count: 5 }, { value: 'State (Karnataka)', label: 'Karnataka State Board', count: 5 }],
  classes: [{ value: 9, label: 'Class 9', count: 3 }], content_types: TYPES,
  subjects: subjects.map((s) => ({ value: s.toLowerCase(), label: s, count: 3 })), mediums: [{ value: 'english', label: 'English', count: 4 }], ...over,
})

describe('DikshaFilters', () => {
  it('changing the board resets subject and medium and returns to page 1', () => {
    const onChange = vi.fn()
    render(<DikshaFilters options={opts(['Mathematics'])} value={{ subject: 'mathematics', medium: 'english', page: 3, content_type: 'textbook' }} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Board'), { target: { value: 'State (Karnataka)' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ board: 'State (Karnataka)', subject: '', medium: '', page: 1 }))
    expect(screen.getByRole('option', { name: 'Karnataka State Board (5)' })).toBeInTheDocument()
  })

  it('offers content types with counts (empty ones disabled) and only subjects that have content of the type', () => {
    render(<DikshaFilters options={opts([], { subjects: [{ value: 'science', label: 'Science', count: 12 }, { value: 'history', label: 'History', count: 0 }] })}
      value={{ content_type: 'video' }} onChange={vi.fn()} />)
    const type = screen.getByLabelText('Content type')
    expect(within(type).getByRole('option', { name: 'Videos (150)' })).toBeInTheDocument()
    expect(within(type).getByRole('option', { name: 'Audio (0)' })).toBeDisabled()
    const subject = screen.getByLabelText('Subject')
    expect(within(subject).getAllByRole('option').map((o) => o.textContent)).toEqual(['All subjects', 'Science (12)'])
  })

  it('clear restores the default textbook search', () => {
    const onChange = vi.fn()
    render(<DikshaFilters options={opts([])} value={{ board: 'NCERT', class_number: 9, content_type: 'video' }} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(onChange).toHaveBeenCalledWith({ content_type: 'textbook', page: 1 })
  })
})

describe('DikshaBrowser: content type → subjects', () => {
  it('lists only subjects with content of the chosen type, drops a subject the new type lacks and keeps one it has', async () => {
    const byType: Record<string, string[]> = { textbook: ['English', 'Science'], video: ['Mathematics', 'Science'], document: ['Science'] }
    svc.filters.mockImplementation(async (f) => opts(byType[f.content_type ?? 'textbook']))
    svc.search.mockResolvedValue({ items: [item()], total: 1, page: 1, page_size: 24, window_exceeded: false })
    const { container } = render(<DikshaBrowser target={null} onPublished={vi.fn()} />)
    await waitFor(() => expect(within(screen.getByLabelText('Subject')).getAllByRole('option')).toHaveLength(3))
    expect(await screen.findByRole('article', { name: 'Double Entry System' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'english' } })
    await waitFor(() => expect(svc.search).toHaveBeenLastCalledWith(expect.objectContaining({ content_type: 'textbook', subject: 'english' })))

    // Videos: English has none -> dropped before searching; the list shows only subjects that have videos
    fireEvent.change(screen.getByLabelText('Content type'), { target: { value: 'video' } })
    await waitFor(() => expect(svc.search).toHaveBeenLastCalledWith(expect.objectContaining({ content_type: 'video', subject: '' })))
    expect(svc.search).not.toHaveBeenCalledWith(expect.objectContaining({ content_type: 'video', subject: 'english' }))
    const subject = screen.getByLabelText('Subject') as HTMLSelectElement
    expect(within(subject).getAllByRole('option').map((o) => o.textContent)).toEqual(['All subjects', 'Mathematics (3)', 'Science (3)'])
    expect(subject.value).toBe('')

    // Science has documents too -> kept when switching to documents
    fireEvent.change(subject, { target: { value: 'science' } })
    await waitFor(() => expect(svc.search).toHaveBeenLastCalledWith(expect.objectContaining({ content_type: 'video', subject: 'science' })))
    fireEvent.change(screen.getByLabelText('Content type'), { target: { value: 'document' } })
    await waitFor(() => expect(svc.search).toHaveBeenLastCalledWith(expect.objectContaining({ content_type: 'document', subject: 'science' })))
    expect(container.textContent).not.toMatch(/diksha/i)
  })
})

describe('Old reader URLs', () => {
  function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}{l.search}</p> }
  it('redirect /library/diksha/:id to /library/explore/:id with the same query', () => {
    render(
      <MemoryRouter initialEntries={['/library/diksha/do_3131?kind=resource&within=do_99&from=/student/library']}>
        <Routes>
          <Route path="/library/diksha/:sourceId" element={<LegacyLibraryRedirect />} />
          <Route path="/library/explore/:sourceId" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('where')).toHaveTextContent('/library/explore/do_3131?kind=resource&within=do_99&from=/student/library')
  })
})

describe('Library states', () => {
  it('loading, empty and error states are accessible', () => {
    const retry = vi.fn()
    render(<><LoadingState rows={2} label="Loading textbooks" /><EmptyState title="Nothing here" /><ErrorState message="The content catalogue is unavailable right now." onRetry={retry} /></>)
    expect(screen.getByRole('status', { name: 'Loading textbooks' })).toBeInTheDocument()
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('The content catalogue is unavailable right now.')
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(retry).toHaveBeenCalled()
  })
})
