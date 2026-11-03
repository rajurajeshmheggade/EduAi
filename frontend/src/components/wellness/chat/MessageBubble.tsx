import { ShieldAlert, Video } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Helpline } from '@/types/wellness'
import { GUARDRAIL_LABEL, type UiMessage } from './chatCopy'
import { HelplineList } from './HelplineList'

const time = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** One chat bubble. Guardrail replies are highlighted; crisis replies carry the verified helplines. */
export function MessageBubble({ msg, crisisHelplines }: {
  msg: UiMessage
  /** Helplines for crisis replies loaded from history (the server returns them only on the live reply). */
  crisisHelplines: Record<string, Helpline> | null
}) {
  const isUser = msg.role === 'user'
  const guardrail = !isUser && msg.guardrailType ? msg.guardrailType : null
  const crisis = guardrail === 'crisis_self_harm'
  const helplines = !isUser ? (msg.helplines ?? (crisis ? crisisHelplines : null)) : null
  const stamp = time(msg.timestamp)

  return (
    <div className={cn('flex w-full animate-fade-up', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-3 text-[15px] leading-normal sm:max-w-[80%]',
          isUser
            ? 'rounded-br-md bg-gradient-to-br from-purple-600 to-rose-500 text-white shadow-[0_4px_15px_-4px_rgb(124_58_237/0.45)]'
            : guardrail
              ? cn('rounded-bl-md border text-ink-100', crisis ? 'border-rose-400/40 bg-rose-400/5' : 'border-warn/35 bg-warn/5')
              : 'rounded-bl-md border border-purple-500/15 bg-ink-900 text-ink-100',
        )}
      >
        <span className="sr-only">{isUser ? 'You said: ' : 'Aura said: '}</span>
        {guardrail && (
          <div className={cn('mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide', crisis ? 'text-rose-400' : 'text-warn')}>
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
            Safety response · {GUARDRAIL_LABEL[guardrail] ?? 'Guardrail'}
          </div>
        )}
        <p className="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{msg.content}</p>
        {helplines && <HelplineList helplines={helplines} compact className="mt-2.5" />}
        <div className={cn('mt-1.5 flex items-center justify-end gap-1.5 text-[10.5px]', isUser ? 'text-white/70' : 'text-ink-500')}>
          {msg.channel === 'live' && (
            <span className="flex items-center gap-1"><Video className="h-3 w-3" aria-hidden />via Aura Live ·</span>
          )}
          {stamp && <time dateTime={msg.timestamp}>{stamp}</time>}
        </div>
      </div>
    </div>
  )
}
