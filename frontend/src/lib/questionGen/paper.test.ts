import { describe, expect, it } from 'vitest'
import type { PaperItem, Question, QType, Section } from '@/types/questionGen'
import {
  answerKey, arGroups, blankQuestion, blanksOf, cloneQuestion, derangement, duplicateAt, durationText, isComposite, matchColumns,
  moveItem, mrqScore, normaliseMarks, nudge, numberPaper, orderingDisplay, removeAt, shareMarks, subLabel, totalMarks, validateQuestion,
} from './paper'
import { paperHtml } from './render'
import { mixedPaper } from './exportFixture.testutil'

const ALL: QType[] = ['MCQ', 'MRQ', 'TRUE_FALSE', 'FILL_BLANK', 'MATCH', 'ONE_WORD', 'SHORT_ANSWER', 'LONG_ANSWER', 'ESSAY',
  'ASSERTION_REASON', 'CASE_BASED', 'SCENARIO_BASED', 'HOTS', 'DIAGRAM', 'PASSAGE', 'NUMERICAL', 'ORDERING']
const AR = ['Code A', 'Code B', 'Code C', 'Code D']

/** Fill a blank question of any type with valid content. */
function filled(type: QType): Question {
  const q = blankQuestion(type)
  q.text = 'A question about current?'
  switch (q.type) {
    case 'MCQ': q.data.options.forEach((o, i) => { o.text = `Option ${i}` }); break
    case 'MRQ': q.data.options.forEach((o, i) => { o.text = `Option ${i}` }); break
    case 'TRUE_FALSE': q.data.statements[0].text = 'Copper conducts.'; break
    case 'FILL_BLANK': q.text = 'Current is measured in [amperes].'; break
    case 'MATCH': q.data.pairs.forEach((p, i) => { p.left = `L${i}`; p.right = `R${i}` }); break
    case 'ONE_WORD': q.data.answer = 'ampere'; break
    case 'SHORT_ANSWER': case 'HOTS': case 'LONG_ANSWER': case 'ESSAY': q.data.model_answer = 'Because.'; break
    case 'ASSERTION_REASON': q.data.assertion = 'A'; q.data.reason = 'R'; break
    case 'DIAGRAM': q.data.model_answer = 'x'; q.data.diagram_description = 'A circuit'; break
    case 'NUMERICAL': q.data.answer = 2.5; q.data.unit = 'A'; break
    case 'ORDERING': q.data.items.forEach((x, i) => { x.text = `Step ${i}` }); break
    case 'CASE_BASED': case 'SCENARIO_BASED': case 'PASSAGE':
      q.data.passage = 'A passage.'
      q.data.sub_questions = [filled('ONE_WORD'), filled('SHORT_ANSWER')]
      break
  }
  return normaliseMarks(q)
}

describe('type schemas and validation', () => {
  it.each(ALL)('%s: a blank question is invalid, a filled one is valid', (t) => {
    if (t !== 'ASSERTION_REASON' && t !== 'NUMERICAL') expect(validateQuestion(blankQuestion(t)).length).toBeGreaterThan(0)
    expect(validateQuestion(filled(t))).toEqual([])
  })

  it('enforces the per-type rules', () => {
    const mcq = filled('MCQ') as Question & { type: 'MCQ' }
    expect(validateQuestion({ ...mcq, data: { ...mcq.data, correct: 'nope' } })).toContain('Choose the correct option')
    const mrq = filled('MRQ') as Question & { type: 'MRQ' }
    expect(validateQuestion({ ...mrq, data: { ...mrq.data, options: mrq.data.options.map((o, i) => ({ ...o, correct: i === 0 })) } }))
      .toContain('Mark at least two correct options')
    expect(validateQuestion({ ...filled('FILL_BLANK'), text: 'No blanks' })[0]).toMatch(/square brackets/)
    expect(validateQuestion({ ...filled('HOTS'), bloom: 'REMEMBER' })).toContain('A HOTS question must be at Bloom level Analyze, Evaluate or Create')
    const diagram = filled('DIAGRAM') as Question & { type: 'DIAGRAM' }
    expect(validateQuestion({ ...diagram, data: { ...diagram.data, diagram_description: '' } })).toContain('Upload the diagram or describe the diagram to draw')
    expect(validateQuestion({ ...filled('ONE_WORD'), marks: 0 })).toContain('Marks must be more than 0 and at most 100')
    expect(validateQuestion({ ...filled('SHORT_ANSWER'), text: 'x'.repeat(3001) })[0]).toMatch(/too long/)
  })

  it('composite marks are the sum of the sub-questions and sub-errors are labelled', () => {
    const c = filled('CASE_BASED') as Question & { type: 'CASE_BASED' }
    expect(c.marks).toBe(c.data.sub_questions.reduce((s, x) => s + x.marks, 0))
    const bad = { ...c, data: { ...c.data, sub_questions: [{ ...c.data.sub_questions[0], data: { answer: '', alternates: [] } }] } } as Question
    expect(validateQuestion(bad)).toContain('Sub-question (a): Answer is required')
    expect(isComposite('PASSAGE')).toBe(true)
  })

  it('reads fill-in-the-blank answers, ignoring equations', () => {
    expect(blanksOf('Water boils at [100] °C and <span class="math" data-latex="\\sqrt[3]{8}">x</span> is [two]')).toEqual(['100', 'two'])
  })

  it('scores multiple-response partially and splits marks', () => {
    expect(mrqScore(4, 2, 1, 2)).toBe(2)
    expect(mrqScore(4, 1, 2, 2)).toBe(0)
    expect(shareMarks(5, 3)).toEqual([1.66, 1.67, 1.67])
  })
})

describe('editor list operations', () => {
  const sections: Section[] = [{ id: 'A', title: 'A', instructions: '' }, { id: 'B', title: 'B', instructions: '' }]
  const item = (id: string, section: string): PaperItem => ({ item_id: id, section_id: section, question: { ...filled('ONE_WORD'), id } })

  it('moves, duplicates and removes', () => {
    expect(moveItem([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4])
    expect(moveItem([1, 2, 3, 4], 3, 0)).toEqual([4, 1, 2, 3])
    const items = [item('a', 'A'), item('b', 'A')]
    const dup = duplicateAt(items, 0)
    expect(dup).toHaveLength(3)
    expect(dup[1].item_id).toBeNull()
    expect(dup[1].question.id).not.toBe('a')
    expect(dup[1].question.origin).toBe('MANUAL')
    expect(dup[1].question.text).toBe(items[0].question.text)
    expect(removeAt(dup, 1).map((i) => i.item_id)).toEqual(['a', 'b'])
  })

  it('clones composite questions with fresh sub-question ids', () => {
    const c = filled('PASSAGE') as Question & { type: 'PASSAGE' }
    const copy = cloneQuestion(c) as Question & { type: 'PASSAGE' }
    expect(copy.data.sub_questions.map((s) => s.id)).not.toEqual(c.data.sub_questions.map((s) => s.id))
  })

  it('nudges in print order, crossing section boundaries (keyboard reorder)', () => {
    const items = [item('b1', 'B'), item('a1', 'A'), item('a2', 'A')]
    // print order: a1, a2 (A) then b1 (B)
    const down = nudge(sections, items, 2, 1)          // a2 is last of A → moves into B
    expect(down.find((i) => i.item_id === 'a2')!.section_id).toBe('B')
    const up = nudge(sections, items, 2, -1)            // a2 above a1
    expect(numberPaper(sections, up).flatMap((g) => g.rows.map((r) => r.item.item_id))).toEqual(['a2', 'a1', 'b1'])
    expect(nudge(sections, items, 1, -1)).toBe(items)   // first question cannot go up
  })
})

describe('paper numbering and answer key', () => {
  it('numbers continuously across sections and drops empty ones', () => {
    const p = mixedPaper()
    const groups = numberPaper(p.sections, p.items)
    expect(groups.map((g) => g.rows.map((r) => r.number))).toEqual([[1, 2, 3, 4, 5], [6, 7]])
    const orphan = numberPaper([{ id: 'X', title: '', instructions: '' }], p.items)
    expect(orphan[0].rows).toHaveLength(7)
    expect(numberPaper([...p.sections, { id: 'C', title: 'C', instructions: '' }], p.items, { keepEmpty: true })).toHaveLength(3)
  })

  it('groups consecutive assertion–reason questions under one heading', () => {
    const p = mixedPaper()
    const groups = arGroups(numberPaper(p.sections, p.items)[0].rows)
    expect(groups.map((g) => [g.isAr, g.rows.map((r) => r.number)])).toEqual([[false, [1]], [false, [2]], [false, [3]], [true, [4, 5]]])
    const html = paperHtml(p, { media: {}, arCodes: AR, arInstruction: 'Choose the code.', lang: 'en' })
    expect(html.match(/Choose the code\./g)).toHaveLength(1)
    expect(html).toContain('Q. 4–5')
  })

  it('builds answer keys per type', () => {
    const p = mixedPaper()
    const q = (id: string) => p.items.find((i) => i.question.id === id)!.question
    expect(answerKey(q('q1'), AR)[0].html).toContain('(a) Ampere')
    expect(answerKey(q('q2'), AR)[0].html).toBe('(i) True; (ii) False')
    const match = q('q3') as Question & { type: 'MATCH' }
    expect(matchColumns(match).right.map((r) => r.pair.id)).toEqual(['p2', 'p3', 'p1'])
    expect(answerKey(match, AR)[0].html).toBe('1 → (c), 2 → (a), 3 → (b)')
    expect(answerKey(q('q5'), AR)[0].html).toBe('(D) Code D')
    const ordering = filled('ORDERING') as Question & { type: 'ORDERING' }
    const shown = orderingDisplay(ordering).map((d) => d.letter + d.item.id)
    expect(shown).toHaveLength(3)
    expect(answerKey(ordering, AR)[0].html.split(' → ')).toHaveLength(3)
    const num = { ...filled('NUMERICAL'), explanation: 'Use I = Q/t.' } as Question
    expect(answerKey(num, AR).map((k) => k.label)).toEqual(['Answer', 'Explanation'])
    expect(answerKey(num, AR, 'hi')[0].label).toBe('उत्तर')
  })

  it('renders the answer-key paper with sub-question keys and the localised header', () => {
    const html = paperHtml(mixedPaper(), { media: {}, arCodes: AR, arInstruction: 'x', lang: 'en' }, { answerKey: true })
    expect(html).toContain('ANSWER KEY')
    expect(html).toContain('ampere')
    expect(html).not.toContain('Roll No.')
    const hi = paperHtml(mixedPaper({ language: 'hi' }), { media: {}, arCodes: AR, arInstruction: 'x', lang: 'hi' })
    expect(hi).toContain('अधिकतम अंक')
    expect(totalMarks(mixedPaper().items)).toBe(13)
    expect(durationText(90, 'en')).toBe('1 hour 30 minutes')
    expect(subLabel(2, 'roman')).toBe('(iii)')
  })

  it('shuffles deterministically without fixed points', () => {
    const ids = ['a', 'b', 'c', 'd']
    const one = derangement(ids, 'seed')
    expect(derangement(ids, 'seed')).toEqual(one)
    expect(one.every((x, i) => x !== ids[i])).toBe(true)
  })
})
