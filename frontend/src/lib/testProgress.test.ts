import { describe, expect, it } from 'vitest'
import { describeNearCompletion, newlyNearCompletion } from './testProgress'
import type { NearCompletionStudent } from '@/types'

const student = (user_code: string, pct = 80): NearCompletionStudent =>
  ({ user_code, full_name: `Student ${user_code}`, roll_number: null, progress_percentage: pct, flagged_at: '2026-01-01T00:00:00Z' })

describe('newlyNearCompletion', () => {
  it('returns nobody when the current list is empty', () => {
    expect(newlyNearCompletion([], new Set())).toEqual([])
  })

  it('returns everyone the first time (nothing seen yet)', () => {
    const current = [student('A'), student('B')]
    expect(newlyNearCompletion(current, new Set())).toEqual(current)
  })

  it('returns only students not already in `seen` — the duplicate-prevention rule', () => {
    const current = [student('A'), student('B'), student('C')]
    const seen = new Set(['A', 'B'])
    expect(newlyNearCompletion(current, seen)).toEqual([student('C')])
  })

  it('returns nobody once every current student has already been seen (no repeat notification)', () => {
    const current = [student('A')]
    const seen = new Set(['A'])
    expect(newlyNearCompletion(current, seen)).toEqual([])
  })

  it('does not mutate the `seen` set', () => {
    const seen = new Set(['A'])
    newlyNearCompletion([student('A'), student('B')], seen)
    expect(seen).toEqual(new Set(['A']))
  })
})

describe('describeNearCompletion', () => {
  it('names the student and their exact server-computed percentage', () => {
    expect(describeNearCompletion(student('A', 83.5))).toBe('Student A has reached 83.5% completion')
  })
})
