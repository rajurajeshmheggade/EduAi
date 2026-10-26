import { Lock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

/**
 * Avatar tutor slot (right-top pane). Phase 2 ships the animated, idle avatar; Phase 3 wires
 * Azure Neural TTS viseme events to `mouth` so it speaks the lesson with lip-sync.
 */
export function AIAvatarCanvas({ speaking = false, caption }: { speaking?: boolean; caption?: string }) {
  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden p-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,hsl(258_90%_60%/0.25),transparent_62%)]" />
      <svg viewBox="0 0 200 220" className="relative h-full max-h-44 animate-float" role="img" aria-label="AI tutor avatar">
        <defs>
          <linearGradient id="skin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffd9bf" /><stop offset="1" stopColor="#f2b894" /></linearGradient>
          <linearGradient id="coat" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8b5cf6" /><stop offset="1" stopColor="#2dd4bf" /></linearGradient>
        </defs>
        <path d="M30 220c0-42 30-62 70-62s70 20 70 62z" fill="url(#coat)" />
        <rect x="88" y="128" width="24" height="26" rx="8" fill="url(#skin)" />
        <ellipse cx="100" cy="92" rx="48" ry="54" fill="url(#skin)" />
        <path d="M52 86c-4-40 24-58 50-58 30 0 52 20 46 58-10-22-30-30-50-30s-36 8-46 30z" fill="#2b2250" />
        <g className="origin-center [animation:blink_4s_infinite]">
          <ellipse cx="80" cy="94" rx="5" ry="6.5" fill="#1b1535" />
          <ellipse cx="120" cy="94" rx="5" ry="6.5" fill="#1b1535" />
        </g>
        <circle cx="82" cy="92" r="1.6" fill="#fff" /><circle cx="122" cy="92" r="1.6" fill="#fff" />
        <path d="M70 80q10-7 20-1M110 79q10-6 20 1" stroke="#2b2250" strokeWidth="3" strokeLinecap="round" fill="none" />
        <ellipse cx="100" cy="124" rx={speaking ? 10 : 11} ry={speaking ? 8 : 3.2} fill="#8a2f4b" className="transition-all duration-150">
          {speaking && <animate attributeName="ry" values="3;9;4;8;3" dur="0.6s" repeatCount="indefinite" />}
        </ellipse>
        <circle cx="66" cy="110" r="8" fill="#ff8fa3" opacity=".35" /><circle cx="134" cy="110" r="8" fill="#ff8fa3" opacity=".35" />
      </svg>
      <style>{`@keyframes blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}`}</style>
      <div className="relative mt-2 flex items-center gap-2 text-center">
        <Badge tone="brand"><Lock className="h-3 w-3" /> Voice lessons arrive in Phase 3</Badge>
      </div>
      {caption && <p className="relative mt-2 line-clamp-2 max-w-xs text-center text-xs text-ink-300">{caption}</p>}
    </div>
  )
}
