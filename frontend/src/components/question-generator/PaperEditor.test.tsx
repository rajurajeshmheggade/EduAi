import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { mixedPaper } from '@/lib/questionGen/exportFixture.testutil'
import metaFixture from '@/lib/questionGen/meta.fixture.json'
import type { Paper, QgenMeta } from '@/types/questionGen'
import { PaperEditor } from './PaperEditor'

const svc = vi.hoisted(() => ({ savePaper: vi.fn(), publish: vi.fn(), pdf: vi.fn(), addItems: vi.fn(), newVersion: vi.fn() }))
vi.mock('@/services/questionGenService', () => ({ questionGenService: svc, downloadBlob: vi.fn() }))

const meta = metaFixture as unknown as QgenMeta

function setup(paper: Paper = mixedPaper()) {
  const user = userEvent.setup()
  render(<MemoryRouter><PaperEditor initial={paper} meta={meta} onReload={() => {}} /></MemoryRouter>)
  return user
}

const order = () => screen.getAllByRole('listitem').filter((li) => li.querySelector('.qg-q'))
  .map((li) => li.querySelector('.qg-body')!.textContent!.slice(0, 18))

beforeEach(() => {
  Object.values(svc).forEach((f) => f.mockReset())
  svc.savePaper.mockImplementation(async (_id: string, body: Paper) => ({ ...mixedPaper(), ...body, revision: body.revision + 1 }))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('PaperEditor', () => {
  it('shows every question numbered across sections with the header totals', () => {
    setup()
    expect(screen.getByRole('heading', { name: 'Unit Test' })).toBeInTheDocument()
    expect(screen.getByText(/7 questions · 13 marks/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Section A' })).toBeInTheDocument()
    expect(order()).toHaveLength(7)
  })

  it('duplicates, reorders with buttons or the keyboard, deletes and saves the draft', async () => {
    const user = setup()
    const first = order()[0]
    await user.click(screen.getByRole('button', { name: 'Duplicate question 1' }))
    expect(order()).toHaveLength(8)
    expect(order()[1]).toBe(first)
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Move question 3 up' }))
    expect(order()[1]).not.toBe(first)
    const handle = screen.getByRole('button', { name: /Question 1: drag to reorder/ })
    fireEvent.keyDown(handle, { key: 'ArrowDown', altKey: true })
    expect(order()[0]).not.toBe(first)

    await user.click(screen.getByRole('button', { name: 'Delete question 8' }))
    expect(order()).toHaveLength(7)

    await user.click(screen.getByRole('button', { name: /save draft/i }))
    await waitFor(() => expect(svc.savePaper).toHaveBeenCalledTimes(1))
    const [, body] = svc.savePaper.mock.calls[0]
    expect(body.revision).toBe(3)
    expect(body.items).toHaveLength(7)
    expect(body.items.filter((i: { item_id: string | null }) => i.item_id === null)).toHaveLength(1)
  })

  it('drag and drop moves a question before the one it is dropped on', () => {
    setup()
    const items = screen.getAllByRole('listitem').filter((li) => li.querySelector('.qg-q'))
    const before = order()
    const handle = within(items[3]).getByRole('button', { name: /drag to reorder/ })
    fireEvent.dragStart(handle, { dataTransfer: { setData: () => {}, effectAllowed: '' } })
    fireEvent.dragOver(items[0])
    fireEvent.drop(items[0])
    expect(order()[0]).toBe(before[3])
  })

  it('a published paper is read-only', () => {
    setup(mixedPaper({ status: 'PUBLISHED', published_at: '2026-11-01T10:00:00Z' }))
    expect(screen.getByText(/this version is final/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /save draft/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Duplicate question 1' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new version/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create online test/i })).toBeInTheDocument()
  })

  it('opens the type-specific editor and blocks an invalid save', async () => {
    const user = setup()
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Options — choose the correct one/)).toBeInTheDocument()
    const marks = within(dialog).getByLabelText('Marks')
    await user.clear(marks)
    await user.type(marks, '0')
    await user.click(within(dialog).getByRole('button', { name: 'Save question' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Marks must be more than 0')
  })
})
