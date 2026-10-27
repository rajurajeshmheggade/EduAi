import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { AlertTriangle, Phone, Send, ShieldAlert, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/field'
import { cn } from '@/lib/utils'
import type { Caption } from './useAuraLive'
import type { VoiceState } from './voiceEngine'

const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const telHref = (number: string) => `tel:${number.replace(/[^\d+]/g, '')}`

function CaptionRow({ caption }: { caption: Caption }) {
  const user = caption.role === 'user'
  return (
    <li className={cn('flex max-w-[80%] flex-col animate-fade-up', user ? 'items-end self-end' : 'items-start self-start')}>
      <span className="mb-1 text-[0.7rem] text-ink-500">{caption.sender}</span>
      <div
        className={cn(
          'whitespace-pre-wrap rounded-2xl px-4 py-3 text-[0.85rem] leading-[1.45]',
          user
            ? 'rounded-br-[4px] bg-gradient-to-br from-purple-600 to-rose-400 text-white'
            : 'rounded-bl-[4px] border border-line bg-ink-900 text-ink-100',
          caption.guardrailType && 'border-rose-400/40',
        )}
      >
        {caption.text}
        {caption.guardrailType && (
          <div className="mt-2.5 border-t border-rose-400/20 pt-2">
            <p className="flex items-center gap-1.5 text-[0.7rem] font-semibold text-rose-400">
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden />Safety response from Aura's guardrails
            </p>
            {!!caption.helplines?.length && (
              <ul className="mt-1.5 grid gap-1" aria-label="Helplines">
                {caption.helplines.map((h) => (
                  <li key={`${h.name}-${h.number}`} className="text-[0.75rem] leading-snug text-ink-300">
                    <a href={telHref(h.number)} className="inline-flex items-center gap-1 font-semibold text-rose-400 underline-offset-2 hover:underline">
                      <Phone className="h-3 w-3" aria-hidden />{h.name}: {h.number}
                    </a>
                    {h.description && <span> · {h.description}</span>}
                    {h.toll_free && <span className="text-ink-500"> (toll free)</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

/** Closed captions + transcript of the live session, the live speaking buffer, and the typed fallback. */
export function Captions({ captions, voice, pauseProgressRef, speechSupported, onSendTyped }: {
  captions: Caption[]
  voice: VoiceState
  pauseProgressRef: RefObject<HTMLDivElement | null>
  speechSupported: boolean
  onSendTyped: (text: string) => boolean
}) {
  const { active, listening, hearingVoice, liveInterim, pausing, sendCountdown, transcribing, loading } = voice
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [draft, setDraft] = useState('')

  // Auto-scroll the transcript (only the panel, never the page)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion() ? 'auto' : 'smooth' })
    else el.scrollTop = el.scrollHeight
  }, [captions, liveInterim, loading, transcribing])

  const showBuffer = !!liveInterim || (listening && hearingVoice)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (onSendTyped(draft)) setDraft('')
  }

  return (
    <Card className="flex h-[520px] min-w-0 flex-col gap-4 p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-rose-400" aria-hidden />
          <h4 className="font-display text-base font-semibold text-fg">Interactive Live Transcripts</h4>
        </div>
        <Badge className="border-rose-400/30 bg-rose-400/10 text-rose-400">Aura Voice Guarded</Badge>
      </div>

      {!speechSupported && (
        <div className="flex gap-2 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-bad" aria-hidden />
          <p className="text-[0.8rem] leading-snug text-bad">
            <strong>Browser Compatibility Warning:</strong> Web Speech Recognition API is not supported in your current browser environment. We recommend using Google Chrome, Microsoft Edge, or Safari to speak aloud. You can still type to Aura below.
          </p>
        </div>
      )}

      <div ref={scrollRef} className="flex flex-1 flex-col gap-4 overflow-y-auto rounded-xl border border-line bg-ink-800/60 p-4">
        {captions.length === 0 && !liveInterim && (
          <p className="my-auto p-4 text-center text-[0.85rem] leading-relaxed text-ink-500">
            A live transcript of your spoken session will populate here. Click <strong className="text-ink-300">Start Live Session</strong> and speak naturally. Your words appear as you talk, and Aura replies after you pause for 3 seconds.
          </p>
        )}
        <ol role="log" aria-live="polite" aria-label="Live session transcript" className={cn('flex flex-col gap-4', !captions.length && 'hidden')}>
          {captions.map((c) => <CaptionRow key={c.id} caption={c} />)}
        </ol>

        {/* Real-time speaking buffer with pause countdown */}
        {showBuffer && (
          <div className="flex max-w-[80%] flex-col items-end self-end opacity-90">
            <span className="mb-1 flex items-center gap-1.5 text-[0.7rem] text-rose-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-current" aria-hidden />
              {pausing ? `Sending to Aura in ${sendCountdown}s...` : 'Speaking...'}
            </span>
            <div className="w-full rounded-2xl rounded-br-[4px] border border-dashed border-line-strong bg-ink-900/80 px-4 py-3 text-[0.85rem] leading-[1.45] text-ink-100">
              {liveInterim || <><span aria-hidden>🎙️ </span>Hearing you...</>}
              {pausing && (
                <span className="mt-1.5 block text-[0.75rem] text-brand-300">
                  <span aria-hidden>⏳ </span>Paused. Keep talking to add more, or wait and Aura will reply.
                </span>
              )}
              <div className="mt-2 h-[3px] overflow-hidden rounded-sm bg-ink-700" aria-hidden="true">
                <div ref={pauseProgressRef} className="h-full w-0 bg-brand-400 transition-[width] duration-100 ease-linear" />
              </div>
            </div>
          </div>
        )}

        {transcribing && (
          <div className="flex max-w-[80%] flex-col items-end self-end opacity-90">
            <span className="mb-1 text-[0.7rem] text-ink-500">Student</span>
            <div className="flex items-center gap-2 rounded-2xl rounded-br-[4px] border border-dashed border-line-strong bg-ink-900/80 px-4 py-3 text-[0.85rem] text-ink-100">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-400/30 border-t-brand-400" aria-hidden />
              <span>Transcribing your words...</span>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex max-w-[80%] flex-col items-start self-start">
            <span className="mb-1 text-[0.7rem] text-ink-500">Aura</span>
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-[4px] border border-line bg-ink-900 px-4 py-3 text-[0.85rem] text-ink-100">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-purple-500/30 border-t-purple-500" aria-hidden />
              <span>Translating thoughts...</span>
            </div>
          </div>
        )}
      </div>

      {/* Typed fallback: same session, Aura still answers aloud */}
      <form onSubmit={submit} className="flex items-center gap-2">
        <label htmlFor="aura-live-typed" className="sr-only">Type a message to Aura</label>
        <Input
          id="aura-live-typed"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={active ? 'Prefer typing? Write to Aura here...' : 'Start the live session to talk or type to Aura'}
          disabled={!active}
          maxLength={2000}
          autoComplete="off"
        />
        <Button type="submit" size="icon" className="h-10 w-10 shrink-0" aria-label="Send typed message to Aura"
          disabled={!active || !draft.trim() || loading || transcribing}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </Card>
  )
}
