import { Fragment, type ReactNode } from 'react'
import { Bot, Loader2, Sparkles } from 'lucide-react'
import { mdInline, renderRich } from '@/components/lesson-plan/Rich'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { SUBTITLE, TITLE } from './text'
import type { Msg } from './types'

/* Chat rendering for the Lesson Plan Assistant. Assistant text is Markdown; `---` rules, whole-line `_italic_` hints
   and sized headings are handled here, everything else (bold, bullets, numbered lists, tables) by renderRich. */

const HEADING: Record<number, string> = {
  1: 'mb-1 mt-3 font-display text-lg font-semibold text-fg first:mt-0',
  2: 'mb-1 mt-3 font-display text-[17px] font-semibold text-fg first:mt-0',
  3: 'mb-1 mt-3 font-display text-base font-semibold text-fg first:mt-0',
  4: 'mb-0.5 mt-2.5 text-[15px] font-semibold text-fg first:mt-0',
}

export function AssistantRich({ text }: { text: string }) {
  const out: ReactNode[] = []
  let buf: string[] = []
  const flush = () => {
    const chunk = buf.join('\n')
    if (chunk.trim()) out.push(<Fragment key={out.length}>{renderRich(chunk, 'base')}</Fragment>)
    buf = []
  }
  for (const ln of String(text).replace(/\r/g, '').split('\n')) {
    const t = ln.trim()
    if (/^(-{3,}|\*{3,})$/.test(t)) { flush(); out.push(<hr key={out.length} className="my-3 border-line" />); continue }
    const it = t.match(/^_(.+)_$/)
    if (it) { flush(); out.push(<p key={out.length} className="my-1.5 text-[14px] italic leading-relaxed text-ink-500">{mdInline(it[1])}</p>); continue }
    const h = t.match(/^(#{1,4})\s+(.*)$/)
    if (h) { flush(); out.push(<div key={out.length} className={HEADING[h[1].length]}>{mdInline(h[2])}</div>); continue }
    buf.push(ln)
  }
  flush()
  return <>{out}</>
}

export function BotAvatar({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <span aria-hidden className={cn('grid shrink-0 place-items-center bg-gradient-to-br from-brand-500 to-aqua-500 text-white',
      size === 'lg' ? 'h-14 w-14 rounded-2xl shadow-glow' : 'h-9 w-9 rounded-xl')}>
      <Bot className={size === 'lg' ? 'h-7 w-7' : 'h-[18px] w-[18px]'} />
    </span>
  )
}

export function MessageRow({ msg, initials }: { msg: Msg; initials: string }) {
  const user = msg.role === 'user'
  return (
    <div className={cn('flex items-start gap-3 animate-fade-up', user && 'flex-row-reverse')}>
      {user
        ? <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 text-xs font-semibold text-white">{initials}</span>
        : <BotAvatar />}
      <div className={cn('min-w-0 max-w-[85%] px-4 py-3 text-[15px] leading-relaxed',
        user
          ? 'whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-glow'
          : 'glass break-words rounded-2xl rounded-bl-md text-ink-100')}>
        <span className="sr-only">{user ? 'You: ' : 'Assistant: '}</span>
        {user ? msg.content : msg.busy
          ? <span className="inline-flex items-center gap-2 text-ink-300"><Loader2 className="h-4 w-4 animate-spin text-brand-400" />{msg.content}</span>
          : <AssistantRich text={msg.content} />}
      </div>
    </div>
  )
}

export function TypingRow() {
  return (
    <div className="flex items-start gap-3 animate-fade-up" role="status">
      <BotAvatar />
      <div className="glass inline-flex items-center gap-2 rounded-2xl rounded-bl-md px-4 py-3 text-sm text-ink-500">
        <Sparkles className="h-4 w-4 animate-pulse text-brand-400" />
        <span className="animate-pulse">Thinking…</span>
      </div>
    </div>
  )
}

/** Names this chat and flags it AI-assisted (Rapid's identity card). */
export function IdentityCard() {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-brand-400/20 bg-gradient-to-br from-brand-500/10 via-aqua-500/5 to-transparent px-5 py-4 shadow-glow">
      <BotAvatar size="lg" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="font-display text-xl font-semibold text-fg">{TITLE}</h1>
          <Badge tone="brand" className="tracking-wide"><Sparkles className="h-3 w-3" />AI-ASSISTED</Badge>
        </div>
        <p className="mt-0.5 text-sm text-ink-300">{SUBTITLE}</p>
      </div>
    </div>
  )
}
