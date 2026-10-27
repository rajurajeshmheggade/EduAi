import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, CalendarRange, ChevronDown, GraduationCap, Hash, KeyRound, Loader2, LogOut, Mail, School, BookOpen } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label } from '@/components/ui/field'
import { api, errorMessage } from '@/services/apiClient'
import { cn, roleLabel } from '@/lib/utils'

/** Top-right profile button: account details, change password and sign out in one dropdown. */
export function ProfileMenu() {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  if (!user) return null
  const realEmail = !user.email.endsWith('.noemail.local')

  return (
    <div ref={box} className="relative">
      <button id="profile-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-transparent py-1 pl-1 pr-2 transition-colors hover:border-line hover:bg-ink-800">
        <Avatar name={user.full_name} />
        <div className="hidden text-left sm:block">
          <div className="max-w-40 truncate text-sm font-medium leading-tight text-fg">{user.full_name}</div>
          <div className="text-xs leading-tight text-ink-500">{roleLabel(user.role)}{user.role === 'superadmin' && <> · @{user.user_code}</>}</div>
        </div>
        <ChevronDown className={cn('h-4 w-4 text-ink-500 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div role="menu" aria-label="Profile" className="absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-2xl border border-line bg-ink-900 shadow-xl animate-fade-up">
          <div className="flex items-center gap-3 border-b border-line bg-ink-800 p-4">
            <Avatar name={user.full_name} size="lg" />
            <div className="min-w-0">
              <div className="truncate font-display font-semibold text-fg">{user.full_name}</div>
              <div className="text-xs text-ink-500">{roleLabel(user.role)}{user.role === 'superadmin' && <> · signs in as <b>{user.user_code}</b></>}</div>
            </div>
          </div>

          <dl className="space-y-2.5 p-4 text-sm">
            {realEmail && <Row icon={Mail} label="Email">{user.email}</Row>}
            <Row icon={Hash} label={user.role === 'student' ? 'Admission no.' : user.role === 'teacher' ? 'Employee code' : user.role === 'superadmin' ? 'Username' : 'User code'}>{user.user_code}</Row>
            <Row icon={Building2} label="Institution">{user.org_name ?? user.org_code}</Row>
            {user.role === 'student' && user.class_code && <Row icon={School} label="Class">{user.class_code}{user.roll_number ? ` · Roll ${user.roll_number}` : ''}</Row>}
            {user.year_code && <Row icon={CalendarRange} label="Academic year">{user.year_code} {user.cycle_code ?? ''}</Row>}
            {user.allowed_subjects.length > 0 && <Row icon={user.role === 'student' ? GraduationCap : BookOpen} label="Subjects">{user.allowed_subjects.join(', ')}</Row>}
          </dl>

          <div className="grid gap-1 border-t border-line p-2">
            <button role="menuitem" id="change-password-button" onClick={() => { setOpen(false); setPwOpen(true) }}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink-100 hover:bg-ink-800">
              <KeyRound className="h-4 w-4 text-ink-500" /> Change password
            </button>
            <button role="menuitem" id="logout-button" onClick={() => { logout(); nav('/login') }}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-bad hover:bg-bad/8">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </div>
      )}

      <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  )
}

function Avatar({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')
  return (
    <div className={cn('grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-rose-400 to-brand-500 font-semibold text-white',
      size === 'lg' ? 'h-11 w-11 text-base' : 'h-9 w-9 text-sm')}>{initials}</div>
  )
}

function Row({ icon: Icon, label, children }: { icon: typeof Mail; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" />
      <div className="min-w-0">
        <dt className="text-[11px] uppercase tracking-wide text-ink-500">{label}</dt>
        <dd className="break-words text-ink-100">{children}</dd>
      </div>
    </div>
  )
}

export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { refreshUser } = useAuth()
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (next !== confirm) { setMsg({ ok: false, text: 'New passwords do not match' }); return }
    setBusy(true); setMsg(null)
    try {
      await api.post('/api/v1/auth/change-password', { current_password: cur, new_password: next })
      setMsg({ ok: true, text: 'Password changed.' }); setCur(''); setNext(''); setConfirm('')
      void refreshUser().catch(() => {})
    } catch (err) { setMsg({ ok: false, text: errorMessage(err) }) } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onClose={() => { onClose(); setMsg(null) }} title="Change password" description="Use at least 8 characters.">
      <form onSubmit={submit} className="space-y-3">
        <div><Label htmlFor="pw-cur">Current password</Label><Input id="pw-cur" type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} /></div>
        <div><Label htmlFor="pw-new">New password</Label><Input id="pw-new" type="password" autoComplete="new-password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} /></div>
        <div><Label htmlFor="pw-confirm">Confirm new password</Label><Input id="pw-confirm" type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
        {msg && <p role="status" className={cn('text-sm', msg.ok ? 'text-ok' : 'text-bad')}>{msg.text}</p>}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Close</Button><Button type="submit" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Update password</Button></div>
      </form>
    </Dialog>
  )
}
