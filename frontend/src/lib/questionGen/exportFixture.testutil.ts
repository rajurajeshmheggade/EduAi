/* Test-only fixture: a small mixed-type paper and a minimal .docx (zip) reader. Not imported by app code. */
import type { Paper, Question } from '@/types/questionGen'

const common = { difficulty: 'MEDIUM' as const, bloom: 'UNDERSTAND' as const, topic: '', hint: '', explanation: '', media: [], source_refs: [], origin: 'MANUAL' as const, bank_id: null }

export function mixedPaper(overrides: Partial<Paper> = {}): Paper {
  const qs: Question[] = [
    { ...common, id: 'q1', type: 'MCQ', text: 'What is the SI unit of <b>current</b>?', marks: 1,
      data: { options: [{ id: 'a', text: 'Ampere' }, { id: 'b', text: 'Volt' }, { id: 'c', text: 'Ohm' }, { id: 'd', text: 'Watt' }], correct: 'a', layout: 'two' } },
    { ...common, id: 'q2', type: 'TRUE_FALSE', text: 'State True or False.', marks: 2,
      data: { statements: [{ id: 's1', text: 'Copper is a good conductor.', answer: true }, { id: 's2', text: 'Rubber conducts electricity.', answer: false }] } },
    { ...common, id: 'q3', type: 'MATCH', text: 'Match the following.', marks: 3,
      data: { pairs: [{ id: 'p1', left: 'Ammeter', right: 'measures current' }, { id: 'p2', left: 'Voltmeter', right: 'measures potential difference' }, { id: 'p3', left: 'Rheostat', right: 'varies resistance' }],
        right_order: ['p2', 'p3', 'p1'], per_pair_marks: true, left_title: 'Column I', right_title: 'Column II' } },
    { ...common, id: 'q4', type: 'ASSERTION_REASON', text: 'Assertion–Reason', marks: 1,
      data: { assertion: 'Metals conduct electricity.', reason: 'Metals have free electrons.', answer: 'A' } },
    { ...common, id: 'q5', type: 'ASSERTION_REASON', text: 'Assertion–Reason', marks: 1,
      data: { assertion: 'Glass is a conductor.', reason: 'Glass is transparent.', answer: 'D' } },
    { ...common, id: 'q6', type: 'PASSAGE', text: 'Read the passage given below and answer the questions that follow.', marks: 3,
      data: { passage: 'Electric current is the rate of flow of charge &amp; is measured in amperes.', passage_title: 'Current', numbering: 'roman',
        sub_questions: [
          { ...common, id: 's6a', type: 'ONE_WORD', text: 'Name the unit of current.', marks: 1, data: { answer: 'ampere', alternates: ['amp'] } },
          { ...common, id: 's6b', type: 'SHORT_ANSWER', text: 'Define electric current.', marks: 2, data: { model_answer: 'The rate of flow of charge.', key_points: ['rate', 'charge'] } },
        ] } },
    { ...common, id: 'q7', type: 'SHORT_ANSWER', text: 'Write Ohm’s law: <span class="math" data-latex="V = IR">V = IR</span> and simplify <span class="math" data-latex="\\frac{x^2}{2}">x</span>.', marks: 2,
      data: { model_answer: 'Potential difference is proportional to current, <span class="math" data-latex="V \\propto I">V</span>.', key_points: [] } },
  ]
  return {
    paper_id: 'p-1', family_id: 'p-1', version: 1, parent_paper_id: null, status: 'DRAFT', revision: 3, title: 'Unit Test',
    language: 'en', class_code: 'Grade-10-A', class_name: 'Grade 10 — Section A', subject_code: 'PHY101', subject_name: 'Physics',
    nlp_class: 'X', nlp_subject: 'General Science', chapter: 'electricity',
    header: { institution_name: 'Demo International School', logo_media_id: null, exam_title: 'Unit Test 2 — Electricity', academic_year: '2026-27',
      exam_date: '12 Nov 2026', duration_minutes: 90, general_instructions: ['All questions are compulsory.'], show_marks: true, show_roll_no: true },
    sections: [{ id: 'A', title: 'Section A', instructions: 'Objective questions.' }, { id: 'B', title: 'Section B', instructions: '' }],
    total_marks: 13, question_count: qs.length, published_at: null, eval_test_id: null, created_at: '', updated_at: '',
    institution_name: 'Demo International School',
    items: qs.map((q, i) => ({ item_id: `i${i}`, section_id: i < 5 ? 'A' : 'B', question: q })),
    media: {},
    ...overrides,
  }
}

/** Blob bytes via FileReader (jsdom's Blob has no arrayBuffer()/stream()). */
export function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer))
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(blob)
  })
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(data); c.close() } })
  const reader = source.pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader()
  const chunks: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.length }
  return out
}

/** Reads one entry of a zip (via the central directory; stored or deflated). */
export async function readZipEntry(blob: Blob, name: string): Promise<string | null> {
  const b = await blobBytes(blob)
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let eocd = -1
  for (let i = b.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) return null
  const count = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true)
  for (let k = 0; k < count; k++) {
    const method = dv.getUint16(p + 10, true)
    const size = dv.getUint32(p + 20, true)
    const nameLen = dv.getUint16(p + 28, true), extra = dv.getUint16(p + 30, true), comment = dv.getUint16(p + 32, true)
    const local = dv.getUint32(p + 42, true)
    const entry = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen))
    if (entry === name) {
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true)
      const raw = b.subarray(start, start + size)
      return new TextDecoder().decode(method === 0 ? raw : await inflateRaw(raw))
    }
    p += 46 + nameLen + extra + comment
  }
  return null
}
