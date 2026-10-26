import type { AIModule } from '@/types'

export const AI_MODULES: { id: AIModule; label: string }[] = [
  { id: 'rag_chatbot', label: 'AI doubt chatbot' },
  { id: 'ai_avatar_tutor', label: 'AI avatar tutor' },
  { id: 'ocr_evaluation', label: 'AI script evaluation' },
  { id: 'capability_analysis', label: 'Capability reports' },
]
