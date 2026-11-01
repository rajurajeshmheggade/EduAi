import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Check, CheckCheck } from 'lucide-react'
import { notificationService } from '@/services/notificationService'
import { cn } from '@/lib/utils'
import type { AppNotification } from '@/types'

const POLL_MS = 60_000

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/** Shared in-app notification inbox (bell icon in the header), present for every signed-in role. Polls
 * every 60s for a fresh unread count; opening the dropdown always re-fetches the full list. */
export function NotificationBell() {
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[] | null>(null)
  const [unread, setUnread] = useState(0)
  const box = useRef<HTMLDivElement>(null)

  const refresh = useCallback(() => {
    notificationService.list().then((d) => { setItems(d.notifications); setUnread(d.unread) }).catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, POLL_MS)
    return () => clearInterval(id)
  }, [refresh])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  async function open1(n: AppNotification) {
    if (!n.is_read) { await notificationService.markRead(n.notification_id).catch(() => {}); refresh() }
    setOpen(false)
    if (n.link) nav(n.link)
  }

  async function markAll() {
    await notificationService.markAllRead().catch(() => {})
    refresh()
  }

  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen((v) => !v)} id="open-notifications" aria-haspopup="menu" aria-expanded={open} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        className="relative inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl text-ink-500 transition-colors hover:bg-ink-800 hover:text-fg">
        <Bell className="h-4.5 w-4.5" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-warn px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div role="menu" aria-label="Notifications" className="absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-2xl border border-line bg-ink-900 shadow-xl animate-fade-up">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="font-display text-sm font-semibold text-fg">Notifications</div>
            {unread > 0 && (
              <button onClick={markAll} className="flex cursor-pointer items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {!items ? (
              <div className="space-y-2 p-4"><div className="skeleton h-12" /><div className="skeleton h-12" /></div>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-300">You're all caught up.</p>
            ) : (
              <ul>
                {items.map((n) => (
                  <li key={n.notification_id}>
                    <button onClick={() => open1(n)}
                      className={cn('flex w-full cursor-pointer items-start gap-2 border-b border-line px-4 py-3 text-left transition-colors last:border-0 hover:bg-ink-800',
                        !n.is_read && 'bg-brand-500/5')}>
                      <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', n.is_read ? 'bg-transparent' : 'bg-brand-500')} />
                      <div className="min-w-0 flex-1">
                        <div className={cn('text-sm', n.is_read ? 'text-ink-300' : 'font-medium text-fg')}>{n.title}</div>
                        {n.body && <div className="mt-0.5 line-clamp-2 text-xs text-ink-500">{n.body}</div>}
                        <div className="mt-1 text-[11px] text-ink-500">{timeAgo(n.created_at)}</div>
                      </div>
                      {n.is_read && <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-500" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
