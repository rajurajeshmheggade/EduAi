import { useState, type FormEvent } from 'react'
import axios from 'axios'
import { CheckCircle2, Loader2, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Label, Select, Textarea } from '@/components/ui/field'
import { errorMessage } from '@/services/apiClient'
import { cn } from '@/lib/utils'

const INTERESTS: [string, string][] = [
  ['attendance', 'Attendance'], ['timetable', 'Timetable'], ['homework', 'Homework'], ['online_tests', 'Online tests'],
  ['assignments', 'Assignments'], ['ai_evaluation', 'AI answer evaluation'], ['ai_tutor', 'AI tutor'],
  ['lesson_planner', 'Lesson planner'], ['admin_console', 'Admin console'],
]

/** Landing-page lead form -> POST /api/v1/public/demo-requests (super-admin inbox). */
export function DemoForm() {
  const [f, setF] = useState({ full_name: '', email: '', phone: '', institution_name: '', institution_type: 'school', role: '', city: '', student_count: '', message: '', website: '' })
  const [interests, setInterests] = useState<string[]>(['ai_evaluation', 'attendance'])
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await axios.post('/api/v1/public/demo-requests', {
        ...f, phone: f.phone || null, role: f.role || null, city: f.city || null, student_count: f.student_count || null,
        message: f.message || null, website: f.website || null, interests, consent,
      })
      setDone(true)
    } catch (err) { setError(errorMessage(err, 'Could not send your request')) } finally { setBusy(false) }
  }

  if (done) {
    return (
      <div role="status" className="grid min-h-80 place-items-center rounded-2xl border border-ok/30 bg-ok/8 p-8 text-center">
        <div>
          <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-ok" />
          <h3 className="font-display text-xl font-semibold">Thank you, {f.full_name.split(' ')[0]}!</h3>
          <p className="mt-1 text-sm text-ink-300">We’ve received your request for {f.institution_name}. Our team will contact you at {f.email} to schedule your demo.</p>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" aria-label="Request a demo">
      <div><Label htmlFor="d-name">Your name *</Label><Input id="d-name" required minLength={2} value={f.full_name} onChange={set('full_name')} autoComplete="name" /></div>
      <div><Label htmlFor="d-role">Your role</Label>
        <Select id="d-role" value={f.role} onChange={set('role')}>
          <option value="">Select…</option>{['Owner / Trustee', 'Principal / Director', 'Administrator', 'Teacher', 'IT head', 'Other'].map((r) => <option key={r}>{r}</option>)}
        </Select>
      </div>
      <div><Label htmlFor="d-email">Work email *</Label><Input id="d-email" type="email" required value={f.email} onChange={set('email')} autoComplete="email" /></div>
      <div><Label htmlFor="d-phone">Phone</Label><Input id="d-phone" type="tel" value={f.phone} onChange={set('phone')} autoComplete="tel" maxLength={32} /></div>
      <div className="sm:col-span-2"><Label htmlFor="d-inst">Institution name *</Label><Input id="d-inst" required minLength={2} value={f.institution_name} onChange={set('institution_name')} autoComplete="organization" /></div>
      <div><Label htmlFor="d-type">Institution type *</Label>
        <Select id="d-type" value={f.institution_type} onChange={set('institution_type')}>
          <option value="school">School (K–12)</option><option value="college">College / University</option><option value="coaching">Coaching centre</option>
        </Select>
      </div>
      <div><Label htmlFor="d-size">Number of students</Label>
        <Select id="d-size" value={f.student_count} onChange={set('student_count')}>
          <option value="">Select…</option><option value="<300">Under 300</option><option value="300-1000">300 – 1,000</option><option value="1000-3000">1,000 – 3,000</option><option value="3000+">3,000+</option>
        </Select>
      </div>
      <div className="sm:col-span-2"><Label htmlFor="d-city">City</Label><Input id="d-city" value={f.city} onChange={set('city')} maxLength={100} /></div>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-300">I’m interested in</legend>
        <div className="flex flex-wrap gap-1.5">
          {INTERESTS.map(([k, label]) => {
            const on = interests.includes(k)
            return (
              <button type="button" key={k} aria-pressed={on} onClick={() => setInterests(on ? interests.filter((x) => x !== k) : [...interests, k])}
                className={cn('cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors', on ? 'border-brand-400 bg-brand-500/10 font-medium text-brand-600' : 'border-line text-ink-300 hover:border-line-strong')}>
                {label}
              </button>
            )
          })}
        </div>
      </fieldset>
      <div className="sm:col-span-2"><Label htmlFor="d-msg">Anything we should know?</Label><Textarea id="d-msg" rows={3} maxLength={2000} value={f.message} onChange={set('message')} /></div>
      {/* honeypot — hidden from people, filled by bots */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} className="hidden" aria-hidden />
      <label className="flex cursor-pointer items-start gap-2 text-xs text-ink-300 sm:col-span-2">
        <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 accent-[var(--color-brand-500)]" />
        I agree to be contacted about a demo of EduAI. We use these details only to arrange your demo.
      </label>
      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad sm:col-span-2">{error}</p>}
      <Button type="submit" size="lg" className="sm:col-span-2" disabled={busy || !consent} id="demo-submit">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Request my free demo
      </Button>
    </form>
  )
}
