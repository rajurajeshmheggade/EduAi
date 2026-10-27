/* Product vocabulary for the Lesson Plan creator and Session Plan — verbatim from the Rapid console
   (lessonPlanData.js / SessionResources.jsx). These are constants, not data: no mock plans or chapters. */

export const BLOOMS = ['Remembering', 'Understanding', 'Applying', 'Analysing', 'Evaluating', 'Creating']

/** Assessment item types per ELO. The value is passed verbatim to the AI (`item(s) of type "<value>"`). */
export const ITEM_TYPES = [
  { v: 'MCQ', label: 'MCQ' },
  { v: 'Fill in the blank', label: 'Fill in the blank' },
  { v: 'Short description', label: 'Short description' },
  { v: 'Long description', label: 'Long description' },
  { v: 'Open Ended', label: 'Open Ended' },
  { v: 'Case Study', label: 'Case Study' },
]

/** Bloom's Taxonomy — Higher Order Thinking Skills (default selection in step 3). */
export const HOTS = [
  { label: 'Apply', icon: '🔧', desc: 'Use knowledge in new situations' },
  { label: 'Analyse', icon: '🔍', desc: 'Break down information into parts' },
  { label: 'Evaluate', icon: '⚖️', desc: 'Make judgments based on criteria' },
  { label: 'Create', icon: '🎨', desc: 'Produce new or original work' },
]

/** Custom-objective factor options ("Write & Save Objectives"). */
export const FACTOR_OPTIONS = ['Life Skill', 'Timeless Values', 'Relevance to life', 'Social Awareness', 'Environmental Consciousness']

/** Attitudes (default selection). */
export const ATTITUDES = ['Respect', 'Integrity', 'Courage', 'Empathy', 'Responsibility']

/** Instructional models — only 5E is enabled (product requirement); the rest are visible but disabled. */
export const LEARNING_MODELS = [
  { v: '5-Part', label: '5-Part', enabled: false },
  { v: '4-Part', label: '4-Part', enabled: false },
  { v: '5E', label: '5E', enabled: true },
  { v: 'Inquiry-Based', label: 'Inquiry-Based', enabled: false },
  { v: 'UDL', label: 'Universal design for Learning(UDL)', enabled: false },
]

/** Gardner's multiple intelligences — all selected by default. */
export const INTELLIGENCE_TYPES = ['Visual-spatial', 'Linguistic-verbal', 'Logical-mathematical', 'Body-kinesthetic', 'Musical', 'Interpersonal', 'Naturalistic']

/** 5E phases in source order, with the tint / colour used for phase pills and the combined view. */
export const FIVE_E_PHASES = [
  { key: 'Engage/Elicit', tint: '#FDECEC', color: '#DC2626' },
  { key: 'Explore', tint: '#EAF2FF', color: '#2563EB' },
  { key: 'Explain', tint: '#E9F9EF', color: '#16A34A' },
  { key: 'Elaborate', tint: '#FEF7DC', color: '#CA8A04' },
  { key: 'Evaluate', tint: '#F5EBFF', color: '#7C3AED' },
]

/** "Add Resources" palette for the 5E phase rows. */
export const LE_RESOURCES = [
  'Analogy', 'Assessment rubrics', 'Brainstorming sessions', 'Charts and graphic organizers', 'Concept explanations',
  'Concept maps', 'Create word wall', 'Debates and polls', 'Discrepant Events and Demonstrations',
  'Driving question on Pre-requisite', 'Driving question with Image(s)', 'Exit card', 'Experiments', 'Extended activities',
  'Extra information relevant to the topic', 'Flip learning', 'Grammar aspects', 'Hands-on Experiments',
  'Infographics or data visualizations', 'Interactive activities', 'Intriguing images or photos', 'Investigate scenarios',
  'Jigsaw activities', 'Peer evaluation', 'Personal anecdotes and stories', 'Phet simulations',
  'Place holders for files from teachers', 'Placeholder for simulations', 'Previous class quiz questions',
  'Problem scenarios or case studies', 'Provision to upload customized worksheets',
  'Provocative Questions and Discussions (open ended question)', 'Puzzles', 'Questions', 'Quiz', 'Real time examples',
  'Relevant object presentation', 'Scenario based', 'Short stories', 'Short videos or video clips', 'Showcase the ELO dealt',
  'Simple experiments', 'Story board', 'Story telling', 'Suggesting books to read', 'Think, pair, share',
  'Unexpected phenomena or magic tricks', 'Visual and Multimedia Resources', 'Word wall for introduction of new words',
  'Worksheet', 'Writing prompts',
]

/** The eight Resource Categories of a session (product vocabulary). */
export const STAGES = ['Opening', 'Explore the Concept (Stage 1)', 'Guided Learning (Stage 2)',
  'Independent Practice (Stage 3)', 'Wrap Up', 'Extended Activities', 'Do It Yourself', 'Challenge the Students']
export const SETTINGS = ['Select', 'Individual', 'Group', 'Whole Class', 'Pair']
export const STAGE_DESC: Record<string, string> = {
  'Opening': 'Attention getters and focusers, Statement of objectives,<br>Questions Asked:',
  'Explore the Concept (Stage 1)': 'Explanations, Lecture, Instructions, Mnemonics, Mind maps, Flow charts<br>Questions Asked:',
  'Guided Learning (Stage 2)': 'Examples, Demos, Exhibits, Modeling, Case Studies, Scenarios,<br>Questions Asked:',
  'Independent Practice (Stage 3)': 'Glossary, Summatives, Retention, Transfer, Closure<br>Questions Asked:',
  'Wrap Up': 'Check, Question-Answer Bank, Formatives, Puzzles, Crossword, Tryouts<br>Questions Asked:',
  'Extended Activities': 'Independent Practice, Remediation, Assignments,<br>Questions Asked:',
  'Do It Yourself': 'Questions Asked:',
  'Challenge the Students': 'Challenge the Students<br>Questions Asked:',
}
export const ASSET_TYPES = ['Resources', 'Tests', 'Questions', 'Activities', 'Video Catalogue'] as const
export const RESOURCE_TYPES = ['Video', 'Audio', 'PDF', 'Document', 'Presentation', 'Image', 'Activity', 'Link'] as const

/** Category → chip colours (Core Objectives). Tailwind classes on EduAI's palette. */
export const CAT_CLASS: Record<string, string> = {
  'Timeless values': 'bg-purple-500/12 text-purple-700', 'Timeless Values': 'bg-purple-500/12 text-purple-700',
  'Life skill': 'bg-brand-500/12 text-brand-600', 'Life Skill': 'bg-brand-500/12 text-brand-600',
  'Relevance to life': 'bg-ok/12 text-ok',
  'Social Awareness': 'bg-amber-400/15 text-amber-700', 'Environmental Consciousness': 'bg-emerald-500/12 text-emerald-700',
  'Conceptual Understanding': 'bg-brand-500/12 text-brand-600', 'Practical Application': 'bg-aqua-500/12 text-aqua-400',
  'Analytical Skills': 'bg-purple-500/12 text-purple-700', 'Experimental Skills': 'bg-amber-400/15 text-amber-700',
  'Problem Solving': 'bg-rose-400/12 text-rose-400',
}
export const catClass = (c?: string) => (c && CAT_CLASS[c]) || 'bg-ink-700 text-ink-300'

export const bloomIcon = (lv?: string) => {
  const s = String(lv || '').toLowerCase()
  if (s.includes('apply')) return '🔧'
  if (s.includes('analys') || s.includes('analyz')) return '🔍'
  if (s.includes('creat')) return '🎨'
  if (s.includes('evaluat')) return '⚖️'
  return '🧠'
}
export const bloomClass = (lv?: string) => {
  const s = String(lv || '').toLowerCase()
  if (s.includes('apply')) return 'bg-brand-500/12 text-brand-600'
  if (s.includes('analys') || s.includes('analyz')) return 'bg-purple-500/12 text-purple-700'
  if (s.includes('creat')) return 'bg-ok/12 text-ok'
  if (s.includes('evaluat')) return 'bg-amber-400/15 text-amber-700'
  return 'bg-ink-700 text-ink-300'
}
