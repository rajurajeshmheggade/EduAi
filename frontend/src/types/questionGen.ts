/** AI Question Generator — the typed question model (mirrors backend/app/services/qgen/schema.py). */

export type QType =
  | 'MCQ' | 'MRQ' | 'TRUE_FALSE' | 'FILL_BLANK' | 'MATCH' | 'ONE_WORD' | 'SHORT_ANSWER' | 'LONG_ANSWER' | 'ESSAY'
  | 'ASSERTION_REASON' | 'CASE_BASED' | 'SCENARIO_BASED' | 'HOTS' | 'DIAGRAM' | 'PASSAGE' | 'NUMERICAL' | 'ORDERING'
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD'
export type Bloom = 'REMEMBER' | 'UNDERSTAND' | 'APPLY' | 'ANALYZE' | 'EVALUATE' | 'CREATE'
export type Origin = 'AI' | 'MANUAL' | 'BANK'
export type Lang = 'en' | 'hi' | 'kn' | 'ta'

export const COMPOSITE_TYPES: QType[] = ['CASE_BASED', 'SCENARIO_BASED', 'PASSAGE']
export const HIGHER_ORDER: Bloom[] = ['ANALYZE', 'EVALUATE', 'CREATE']

export interface Option { id: string; text: string }
export interface MrqOption extends Option { correct: boolean }
export interface Statement { id: string; text: string; answer: boolean }
export interface BlankRule { alternates: string[]; case_sensitive: boolean }
export interface Pair { id: string; left: string; right: string }
export interface MarkPoint { text: string; marks: number }
export interface OrderItem { id: string; text: string }
export interface MediaRef { media_id: string; caption: string }

export interface McqData { options: Option[]; correct: string; layout: 'list' | 'two' | 'four' }
export interface MrqData { options: MrqOption[]; partial_credit: boolean }
export interface TrueFalseData { statements: Statement[] }
export interface FillBlankData { blanks: BlankRule[]; word_bank: boolean; distractors: string[] }
export interface MatchData { pairs: Pair[]; right_order: string[]; per_pair_marks: boolean; left_title: string; right_title: string }
export interface OneWordData { answer: string; alternates: string[] }
export interface ShortAnswerData { model_answer: string; key_points: string[] }
export interface LongAnswerData { model_answer: string; marking_points: MarkPoint[] }
export interface EssayData { model_answer: string; rubric: MarkPoint[]; word_limit: number | null }
export interface AssertionReasonData { assertion: string; reason: string; answer: 'A' | 'B' | 'C' | 'D' }
export interface DiagramData { diagram_description: string; labels: string[]; model_answer: string; key_points: string[] }
export interface NumericalData { answer: number; unit: string; tolerance: number; solution: string }
export interface OrderingData { items: OrderItem[]; display_order: string[] }
export interface CompositeData { passage: string; passage_title: string; sub_questions: Question[]; numbering: 'alpha' | 'roman' }

export interface DataByType {
  MCQ: McqData; MRQ: MrqData; TRUE_FALSE: TrueFalseData; FILL_BLANK: FillBlankData; MATCH: MatchData; ONE_WORD: OneWordData
  SHORT_ANSWER: ShortAnswerData; LONG_ANSWER: LongAnswerData; ESSAY: EssayData; ASSERTION_REASON: AssertionReasonData
  CASE_BASED: CompositeData; SCENARIO_BASED: CompositeData; HOTS: ShortAnswerData; DIAGRAM: DiagramData
  PASSAGE: CompositeData; NUMERICAL: NumericalData; ORDERING: OrderingData
}

export interface QuestionOf<T extends QType> {
  id: string
  type: T
  /** Sanitised rich HTML (b/i/u/sub/sup/lists, `<span class="math" data-latex>` equations). */
  text: string
  marks: number
  difficulty: Difficulty
  bloom: Bloom
  topic: string
  hint: string
  explanation: string
  media: MediaRef[]
  source_refs: string[]
  origin: Origin
  bank_id?: string | null
  data: DataByType[T]
}
export type Question = { [K in QType]: QuestionOf<K> }[QType]

export interface Section { id: string; title: string; instructions: string }
export interface PaperHeader {
  institution_name: string
  logo_media_id: string | null
  exam_title: string
  academic_year: string
  exam_date: string
  duration_minutes: number | null
  general_instructions: string[]
  show_marks: boolean
  show_roll_no: boolean
}
export interface PaperItem { item_id: string | null; section_id: string; question: Question }
export interface MediaInfo { url: string; width: number; height: number }

export interface PaperSummary {
  paper_id: string
  family_id: string
  version: number
  parent_paper_id: string | null
  status: 'DRAFT' | 'PUBLISHED'
  revision: number
  title: string
  language: Lang
  class_code: string
  class_name: string
  subject_code: string
  subject_name: string
  nlp_class: string | null
  nlp_subject: string | null
  chapter: string | null
  header: PaperHeader
  sections: Section[]
  total_marks: number
  question_count: number
  published_at: string | null
  eval_test_id: string | null
  created_at: string
  updated_at: string
  institution_name: string
}
export interface Paper extends PaperSummary {
  items: PaperItem[]
  media: Record<string, MediaInfo>
}

export interface OptionSpec {
  label: string
  kind: 'int' | 'bool' | 'choice'
  min?: number
  max?: number
  default: number | boolean | string
  choices?: [string, string][]
}
export interface TypeMeta {
  code: QType
  label: string
  group: 'Objective' | 'Subjective' | 'Composite'
  default_marks: number
  auto_gradable: boolean
  description: string
  options: Record<string, OptionSpec>
}
export interface Coded { code: string; label: string }
export interface QgenSettings { ar_instruction: string; ar_codes: string[]; customised: boolean }
export interface QgenMeta {
  types: TypeMeta[]
  difficulties: { code: Difficulty; label: string }[]
  blooms: { code: Bloom; label: string }[]
  languages: { code: Lang; label: string }[]
  limits: Record<string, number>
  settings: QgenSettings
  rate_limit: { generations: number; window_seconds: number }
}

export interface MappedSubject {
  subject_code: string
  subject_name: string
  grade: number | null
  nlp_class: string | null
  nlp_subject: string | null
  mapping: 'auto' | 'override' | 'none'
  note: string | null
}
export interface TeacherClass {
  class_code: string
  class_name: string
  grade: number | null
  nlp_class: string | null
  subjects: MappedSubject[]
}
export interface TopicView { id: string; title: string; number: string | null; segment_count: number; word_count: number }
export interface SegmentView { id: string; title: string; word_count: number; keywords: string[]; preview: string }
export interface ContentPreview {
  topic: TopicView
  segments: { id: string; title: string; text: string }[]
  word_count: number
  truncated: boolean
  source: { class: string; subject: string; chapter: string; file: string }
}

export interface BlueprintRow {
  type: QType
  count: number
  difficulty: Difficulty
  bloom: Bloom
  marks: number | null
  options: Record<string, number | boolean | string>
}
export interface GenerateRequest {
  class_code: string
  subject_code: string
  chapter: string
  topic_id: string
  segment_ids: string[]
  language: Lang
  instructions: string
  blueprint: BlueprintRow[]
  paper_id?: string | null
}
export interface GenerateResult {
  items: Question[]
  warnings: string[]
  engine: string
  rows: { type: QType; requested: number; generated: number; from_ai: number }[]
  source: { class: string; subject: string; chapter: string; topic: string; segment_ids: string[] }
}

export interface BankItem {
  bank_id: string
  owner_code: string
  owner_name: string | null
  mine: boolean
  visibility: 'PRIVATE' | 'ORG'
  class_code: string | null
  subject_code: string | null
  nlp_class: string | null
  nlp_subject: string | null
  chapter: string | null
  topic: string | null
  qtype: QType
  difficulty: Difficulty
  bloom: Bloom
  marks: number
  language: Lang
  question: Question
  usage_count: number
  created_at: string
}
export interface BankSaveResult { saved: string[]; duplicates: { index: number; bank_id: string | null; similarity: number }[] }

export interface AssessmentResult {
  eval_test_id: string
  assessment_type: 'ONLINE_TEST' | 'ASSIGNMENT'
  items: number
  auto_graded_exactly: number
  ai_graded: number
  total_marks: number
  warnings: string[]
}

export interface SubjectMappingRow extends MappedSubject {
  class_code: string
  class_name: string | null
}
export interface MappingsResponse {
  mappings: SubjectMappingRow[]
  repository: { class_label: string; grade: number | null; subjects: string[] }[]
}
