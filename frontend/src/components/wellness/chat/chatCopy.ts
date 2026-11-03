/* Aura Chat copy kept verbatim from MindAlign ChatCompanion / storage.getChatMessages. */
import type { ChatRole, Helpline } from '@/types/wellness'

export const QUICK_CHIPS = [
  'Feeling overwhelmed by syllabus load',
  'Just got a low score in a test',
  'I cannot concentrate today',
  'Family expectations are stressing me out',
  'What if I fail my exams?',
] as const

/** Shown when the conversation is empty (never stored on the server). */
export const AURA_GREETING =
  'Hi! I am Aura, your wellness companion. How are your studies going today? Feel free to share your thoughts, fears, or goals, and we will work through them together.'

/** Must stay crisis-safe: the server-side helpline guardrail can't run when the request fails. */
export const AURA_OFFLINE_REPLY =
  'Hey. I am having a little trouble connecting right now, but please take a deep breath. Focus on inhaling for 4 seconds, holding for 4, and exhaling for 4. If you feel unsafe or overwhelmed, please call Tele-MANAS at 14416 or KIRAN at 1800-599-0019, free and available 24x7. What is bothering you?'

/** The server references (and can focus) only the newest 12 written journals — the panel lists exactly those. */
export const AURA_JOURNAL_WINDOW = 12

/** A message as rendered in the chat (server history row, live reply or a local-only notice). */
export interface UiMessage {
  key: string
  role: ChatRole
  content: string
  timestamp: string
  channel?: 'chat' | 'live'
  guardrailType?: string | null
  aiSource?: string | null
  helplines?: Record<string, Helpline> | null
}

/** Friendly names for the server's guardrail tiers. */
export const GUARDRAIL_LABEL: Record<string, string> = {
  crisis_self_harm: 'Crisis support',
  medical_substance: 'Medical boundary',
  academic_catastrophizing: 'Perspective check',
  jailbreak_attempt: 'Safety boundary',
}
