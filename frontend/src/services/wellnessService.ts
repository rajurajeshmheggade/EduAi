/* Student Wellness client (/ICMELive/api/v1/wellness). Identity always comes from the bearer token — no username
   is ever sent, and the server builds chat history + journal context itself. */
import { api } from './apiClient'
import type {
  AuraMemory, ChatMessage, ChatReply, ClientActivity, DailyTips, JournalEntry, QuizState, WellbeingClass,
  WellbeingOverview, WellbeingStudentDetail, WellnessMe, WellnessMeta, WellnessProfile, WellnessStats, XpResult,
} from '@/types/wellness'

const B = '/ICMELive/api/v1/wellness'

export const wellnessService = {
  async meta(): Promise<WellnessMeta> { return (await api.get<WellnessMeta>(`${B}/meta`)).data },
  async me(): Promise<WellnessMe> { return (await api.get<WellnessMe>(`${B}/me`)).data },
  async saveProfile(p: { examDate: string | null; avatar: string }): Promise<WellnessProfile> {
    return (await api.put<{ profile: WellnessProfile }>(`${B}/me/profile`, p)).data.profile
  },
  async tips(): Promise<DailyTips> { return (await api.post<DailyTips>(`${B}/me/tips`)).data },
  async quiz(): Promise<QuizState> { return (await api.get<QuizState>(`${B}/me/quiz`)).data },
  async answerQuiz(answerIdx: number) {
    return (await api.post<QuizState & { xpResult: XpResult }>(`${B}/me/quiz/answer`, { answerIdx })).data
  },
  async checkin(mood: number) {
    return (await api.post<{ entry: JournalEntry; xpResult: XpResult; stats: WellnessStats }>(`${B}/me/checkin`, { mood })).data
  },
  async analyzeJournal(text: string, currentStress: number) {
    return (await api.post<{ entry: JournalEntry; aiSource: string; helplines: WellnessMeta['helplines'] | null; xpResult: XpResult; stats: WellnessStats }>(
      `${B}/me/journals`, { text, currentStress })).data
  },
  async journals(limit = 50): Promise<JournalEntry[]> {
    return (await api.get<{ journals: JournalEntry[] }>(`${B}/me/journals`, { params: { limit } })).data.journals
  },
  async deleteJournal(id: string) { return (await api.delete<{ deleted: boolean; stats: WellnessStats }>(`${B}/me/journals/${encodeURIComponent(id)}`)).data },
  async coping(journalId: string, title: string, done: boolean) {
    return (await api.post<{ copingDone: string[]; xpResult: XpResult | null }>(`${B}/me/journals/${encodeURIComponent(journalId)}/coping`, { title, done })).data
  },
  async chat(message: string, opts: { focusJournalId?: string | null; channel?: 'chat' | 'live' } = {}): Promise<ChatReply> {
    return (await api.post<ChatReply>(`${B}/me/chat`, { message, focusJournalId: opts.focusJournalId ?? null, channel: opts.channel ?? 'chat' })).data
  },
  async chatHistory(limit = 60): Promise<ChatMessage[]> {
    return (await api.get<{ messages: ChatMessage[] }>(`${B}/me/chat`, { params: { limit } })).data.messages
  },
  async clearChat() { await api.delete(`${B}/me/chat`) },
  async memories(): Promise<AuraMemory[]> { return (await api.get<{ memories: AuraMemory[] }>(`${B}/me/memories`)).data.memories },
  async deleteMemory(id: number) { await api.delete(`${B}/me/memories/${id}`) },
  async activity(activity: ClientActivity, details?: string): Promise<XpResult> {
    return (await api.post<{ xpResult: XpResult }>(`${B}/me/activity`, { activity, details })).data.xpResult
  },
  /** Aura Live speech-to-text fallback. `audio` is a 16 kHz mono WAV (or another audio/* blob). */
  async transcribe(audio: Blob): Promise<string> {
    return (await api.post<{ text: string }>(`${B}/me/transcribe`, audio, { headers: { 'Content-Type': audio.type || 'audio/wav' } })).data.text
  },

  // ── teacher: Wellbeing & Mindset
  async classes(): Promise<WellbeingClass[]> { return (await api.get<{ classes: WellbeingClass[] }>(`${B}/classes`)).data.classes },
  async overview(classCode: string, days = 30): Promise<WellbeingOverview> {
    return (await api.get<WellbeingOverview>(`${B}/classes/${encodeURIComponent(classCode)}/overview`, { params: { days } })).data
  },
  async studentDetail(classCode: string, studentCode: string, days = 60): Promise<WellbeingStudentDetail> {
    return (await api.get<WellbeingStudentDetail>(`${B}/classes/${encodeURIComponent(classCode)}/students/${encodeURIComponent(studentCode)}`, { params: { days } })).data
  },
  async acknowledgeAlert(id: number) { await api.post(`${B}/alerts/${id}/acknowledge`) },
}
