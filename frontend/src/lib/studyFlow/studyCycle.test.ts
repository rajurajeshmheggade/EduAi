import { describe, expect, it } from 'vitest'
import { BREAK_MINUTES, MINUTE_MS, STUDY_BLOCK_MINUTES, isExamPath, isStudentPortalPath, isStudyPath } from './config'
import { addStudyTime, checkBreak, finishBreak, newCycle, restoreCycle, rollDay, startBreak } from './studyCycle'

const DAY = '2026-11-02'
const T0 = new Date(2026, 10, 2, 10, 0).getTime()

describe('study cycle state machine', () => {
  it('is 25 minutes of study, then a 5-minute break', () => {
    expect(STUDY_BLOCK_MINUTES).toBe(25)
    expect(BREAK_MINUTES).toBe(5)
  })

  it('counts study time until the break is due, then stops counting', () => {
    let s = addStudyTime(newCycle(DAY), 24 * MINUTE_MS)
    expect(s).toMatchObject({ phase: 'studying', activeMs: 24 * MINUTE_MS })
    s = addStudyTime(s, 2 * MINUTE_MS)
    expect(s).toMatchObject({ phase: 'due', activeMs: 25 * MINUTE_MS })
    expect(addStudyTime(s, MINUTE_MS)).toBe(s)
    expect(addStudyTime(newCycle(DAY), 0)).toEqual(newCycle(DAY))
  })

  it('OK starts the break; it ends after 5 minutes; then a new block begins', () => {
    const due = addStudyTime(newCycle(DAY), 25 * MINUTE_MS)
    expect(startBreak(newCycle(DAY), T0)).toEqual(newCycle(DAY))                // nothing due yet
    const onBreak = startBreak(due, T0)
    expect(onBreak).toMatchObject({ phase: 'break', breakEndsAt: T0 + 5 * MINUTE_MS })
    expect(checkBreak(onBreak, T0 + 5 * MINUTE_MS - 1)).toBe(onBreak)
    const over = checkBreak(onBreak, T0 + 5 * MINUTE_MS)
    expect(over.phase).toBe('breakOver')
    expect(addStudyTime(over, MINUTE_MS)).toBe(over)                              // no study time counts during the break
    expect(finishBreak(over)).toEqual({ day: DAY, phase: 'studying', activeMs: 0, breakEndsAt: null, cycles: 1 })
  })

  it('starts over each day', () => {
    const s = addStudyTime(newCycle(DAY), 10 * MINUTE_MS)
    expect(rollDay(s, DAY)).toBe(s)
    expect(rollDay(s, '2026-11-03')).toEqual(newCycle('2026-11-03'))
  })

  it('restores today’s progress; yesterday’s, a damaged one and a long-finished break are not carried over', () => {
    const s = addStudyTime(newCycle(DAY), 12 * MINUTE_MS)
    expect(restoreCycle(JSON.parse(JSON.stringify(s)), T0)).toEqual(s)
    expect(restoreCycle({ ...s, day: '2026-11-01' }, T0)).toEqual(newCycle(DAY))
    expect(restoreCycle({ day: DAY, phase: 'nonsense', activeMs: -5 }, T0)).toEqual(newCycle(DAY))
    expect(restoreCycle(null, T0)).toEqual(newCycle(DAY))
    const onBreak = startBreak(addStudyTime(newCycle(DAY), 25 * MINUTE_MS), T0)
    expect(restoreCycle(onBreak, T0 + MINUTE_MS).phase).toBe('break')
    expect(restoreCycle(onBreak, T0 + 6 * MINUTE_MS).phase).toBe('breakOver')
    expect(restoreCycle(onBreak, T0 + 60 * MINUTE_MS)).toMatchObject({ phase: 'studying', activeMs: 0, cycles: 1 })
  })
})

describe('study-flow pages', () => {
  it('study pages: AI Classroom, Digital Library and readers, Virtual Labs, Homework', () => {
    for (const p of ['/student/classroom', '/student/classroom/textbook', '/student/classroom/nlp/10/Physics/Motion', '/student/library',
      '/library/read/b1', '/library/diksha/d1', '/student/virtual-labs', '/student/virtual-labs/v1', '/student/homework']) {
      expect(isStudyPath(p)).toBe(true)
    }
    for (const p of ['/student/dashboard', '/student/wellness', '/student/tests/t1/take', '/student/classroomx', '/teacher/library']) {
      expect(isStudyPath(p)).toBe(false)
    }
  })

  it('exam pages are never interrupted', () => {
    expect(isExamPath('/student/tests/t1/take')).toBe(true)
    expect(isExamPath('/admission/exam/s1')).toBe(true)
    expect(isExamPath('/student/tests/t1')).toBe(false)
    expect(isStudentPortalPath('/student/dashboard')).toBe(true)
    expect(isStudentPortalPath('/teacher/dashboard')).toBe(false)
  })
})
