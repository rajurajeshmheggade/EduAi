import { useState } from 'react'
import { Check, Copy, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { CreatedMember } from '@/types'

/** Shows a server-generated password exactly once, with copy. */
export function CredentialNotice({ member, onDismiss }: { member: Pick<CreatedMember, 'full_name' | 'user_code' | 'email' | 'temporary_password'>; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false)
  if (!member.temporary_password) return null
  const login = member.email.endsWith('.noemail.local') ? member.user_code : member.email
  const text = `Login: ${login}\nPassword: ${member.temporary_password}`

  return (
    <div role="status" className="rounded-xl border border-ok/30 bg-ok/10 p-4 text-sm">
      <div className="flex items-center gap-2 font-medium text-ok"><KeyRound className="h-4 w-4" /> Account created for {member.full_name}</div>
      <p className="mt-1 text-ink-300">Share these sign-in details now — the password is shown only once. They should change it after first login.</p>
      <div className="mt-3 grid gap-1 rounded-lg border border-line bg-ink-900 p-3 font-mono text-xs text-ink-100">
        <div>Login: <b>{login}</b></div>
        <div>Password: <b id="temp-password">{member.temporary_password}</b></div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => { void navigator.clipboard?.writeText(text); setCopied(true) }}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>Done</Button>
      </div>
    </div>
  )
}
