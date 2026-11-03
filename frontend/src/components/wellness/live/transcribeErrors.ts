import axios from 'axios'
import { errorMessage } from '@/services/apiClient'
import { SERVER_STT_UNAVAILABLE, TranscribeError } from './voiceEngine'

/** HTTP status of a failed backend call, when the server answered. */
export const httpStatus = (e: unknown): number | undefined => (axios.isAxiosError(e) ? e.response?.status : undefined)

/** Map `/me/transcribe` failures to MindAlign-style notices. 503 (no AI provider) and 429 (rate limited) pause
    hands-free listening, since retrying straight away would fail the same way. */
export function transcribeFailure(e: unknown): TranscribeError {
  switch (httpStatus(e)) {
    case 503:
      return new TranscribeError(SERVER_STT_UNAVAILABLE, true)
    case 413:
      return new TranscribeError('That turn was too long for Aura to transcribe. Please keep each turn under a minute, then keep talking.')
    case 429:
      return new TranscribeError('Aura has transcribed a lot of voice turns in the last few minutes. Wait a moment, then tap to speak, or type your message below.', true)
    case 502:
      return new TranscribeError("Aura couldn't transcribe that (the transcription service hiccuped). Please try again.")
    default:
      return new TranscribeError(`Aura couldn't transcribe that (${errorMessage(e, 'network error')}). Please try again.`)
  }
}
