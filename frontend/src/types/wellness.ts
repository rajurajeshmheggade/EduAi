/* Student Wellness (MindAlign companion) — shapes returned by /ICMELive/api/v1/wellness. */

export interface XpState { xp: number; level: number; levelTitle: string; xpToNext: number; totalXp: number }
export interface XpResult extends XpState { awarded: number; leveledUp: boolean; capped: boolean }

export interface WellnessProfile extends XpState {
  /** Optional, self-set: when the student's next school exams start (feeds the countdown). */
  examDate: string | null
  avatar: string
  breathCycles: number
}
export interface MoodPoint { id: string; date: string; mood: number }
export interface WellnessStats { avgStress: number; journalsCount: number; moodTrend: MoodPoint[] }
/** Knowledge level bands from graded EduAI assessments (backend services/wellness/context.py). */
export type KnowledgeLevel = 'Advanced' | 'Proficient' | 'Developing' | 'Foundational' | 'Not yet assessed'
export interface SubjectKnowledge { subject: string; avgPct: number; level: KnowledgeLevel; assessments: number }
export interface KnowledgeSummary { level: KnowledgeLevel; avgPct: number | null; assessments: number }
export interface StudentKnowledge extends KnowledgeSummary {
  bySubject: SubjectKnowledge[]
  strongest: string | null
  needsSupport: string | null
}
export interface UpcomingWork { title: string; subject: string; kind: 'ONLINE_TEST' | 'ASSIGNMENT' | 'HOMEWORK' | string; kindLabel: string; date: string }
export interface Countdown { label: string; date: string; source: 'school' | 'self' }
/** The student's academic context — every prompt and screen is pitched at this instead of a chosen exam. */
export interface StudentContext {
  className: string
  gradeLabel: string
  grade: number | null
  section: string | null
  term: string | null
  subjects: string[]
  knowledge: StudentKnowledge
  upcoming: UpcomingWork[]
  countdown: Countdown | null
}
export interface WellnessMe {
  student: { name: string; code: string; classCode: string | null }
  context: StudentContext
  profile: WellnessProfile | null
  stats: WellnessStats | null
}

export interface Helpline { name: string; number: string; description: string; toll_free: boolean }
export interface CopingTechnique { name: string; protocol: string; scientific_basis: string }
export interface WellnessMeta {
  avatars: string[]
  knowledgeLevels: KnowledgeLevel[]
  helplines: Record<string, Helpline>
  coping: CopingTechnique[]
  guardrailLayers: string[]
  xpRules: Record<string, number>
  aiEnabled: boolean
}

export interface CopingStrategy { title: string; description: string }
export interface JournalAnalysis {
  mood_score: number
  primary_emotions: string[]
  triggers: string[]
  analysis_summary: string
  coping_strategies: CopingStrategy[]
  milestone_encouragement: string
}
export interface JournalEntry {
  id: string
  kind: 'journal' | 'checkin'
  date: string
  text: string
  stress_input: number
  analysis: JournalAnalysis
  copingDone: string[]
  aiSource: string
}

export interface DailyTips { focus_tip: string; relaxation_tip: string; affirmation: string; aiSource?: string; cached?: boolean }
export interface QuizState {
  question: string
  options: string[]
  answered: boolean
  answerIdx?: number
  correct?: boolean
  correctIdx?: number
  explanation?: string
}

export type ChatRole = 'user' | 'model'
export interface ChatMessage {
  id?: number
  role: ChatRole
  content: string
  channel?: 'chat' | 'live'
  guardrailType?: string | null
  aiSource?: string | null
  timestamp?: string
}
export interface ChatReply {
  reply: string
  guardrailTriggered: boolean
  guardrailType?: string
  aiSource: 'ai' | 'fallback' | 'guardrail'
  helplines?: Record<string, Helpline> | null
}
export interface AuraMemory { id: number; category: string; text: string; source: string; updatedAt: string }

export type ClientActivity = 'breathing_cycle' | 'pomodoro' | 'balloon_pop' | 'stress_quest'

// ───────────────────────────── teacher: Wellbeing & Mindset
export type RiskLevel = 'high' | 'watch' | 'ok' | 'inactive'
export interface WellbeingClass { classCode: string; className: string; isClassTeacher: boolean; students: number }
export interface WellbeingStudentRow {
  code: string
  name: string
  rollNumber: string | null
  hasProfile: boolean
  knowledge: KnowledgeSummary
  level: number
  levelTitle: string
  totalXp: number
  breathCycles: number
  entries: number
  checkins: number
  avgStress: number | null
  avgMood: number | null
  latestMood: number | null
  moodTrend: number[]
  lastEntry: string | null
  lastActivity: string | null
  crisisEvents: number
  openAlerts: number
  risk: RiskLevel
}
export interface WellbeingOverview {
  classCode: string
  className: string
  days: number
  summary: { students: number; onboarded: number; active: number; avgStress: number | null; high: number; watch: number; openAlerts: number }
  triggers: { trigger: string; count: number }[]
  students: WellbeingStudentRow[]
}
export interface WellbeingAlert {
  id: number
  type: 'crisis_self_harm' | 'medical_substance' | 'academic_catastrophizing' | 'jailbreak_attempt' | string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | string
  date: string
  acknowledgedAt: string | null
  acknowledgedBy: string | null
}
export interface WellbeingStudentDetail {
  student: { code: string; name: string; rollNumber: string | null }
  profile: WellnessProfile | null
  knowledge: StudentKnowledge
  series: { date: string; mood: number; stress: number; kind: 'journal' | 'checkin' }[]
  triggers: { trigger: string; count: number }[]
  activity: { activity: string; count: number; xp: number }[]
  alerts: WellbeingAlert[]
}
